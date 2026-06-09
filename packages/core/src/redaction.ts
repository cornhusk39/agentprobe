// Redaction runs at capture time, before a cassette ever touches disk. The rule
// in SPEC is strict: a cassette that fails the redaction check is not written.
// So this module does two things. First it transforms a value tree, replacing
// anything that looks like a secret or PII with a typed placeholder. Then it
// verifies the result: it rescans for a hard set of high-confidence secret
// shapes, and if any survived, the caller must refuse to write. Treat the
// verify pass as a fail-closed backstop, not the primary defense.

// A named pattern. `replace` controls how a match is rewritten; the default
// placeholder encodes the rule name so a reader of a cassette can see what was
// removed without seeing what it was.
export interface RedactionRule {
  name: string;
  pattern: RegExp;
}

export interface RedactionHit {
  rule: string;
  // The JSON-ish path where the match was found, for the redaction report.
  path: string;
}

export interface RedactionResult<T> {
  value: T;
  hits: RedactionHit[];
}

// Object keys whose values are sensitive regardless of content. If a key is
// named like a credential, the whole value goes, even if it does not match a
// content pattern. This catches custom token formats we cannot enumerate.
const SENSITIVE_KEY = /^(authorization|api[_-]?key|secret|password|passwd|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|bearer)$/i;

// Content patterns applied to every string. Ordered roughly by specificity.
// These are deliberately conservative: a false positive only over-redacts a
// cassette, which is safe, while a false negative could leak.
export const DEFAULT_RULES: RedactionRule[] = [
  // Provider API keys. Anthropic and OpenAI style, plus generic sk- prefixes.
  { name: "anthropic-key", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  { name: "openai-key", pattern: /sk-(?:proj-)?[a-zA-Z0-9_-]{20,}/g },
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  // A bearer token presented inline in a header-like string.
  { name: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  // JWTs: three base64url segments separated by dots.
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // PII. Emails, US phone numbers, SSNs, and long digit runs (card-length and
  // beyond). Digit patterns use lookarounds rather than \b so a number glued to
  // surrounding text (for example "phone:5125550142x") is still caught, and so a
  // 17 to 19 digit run cannot slip past a 16-digit upper bound.
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "ssn", pattern: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g },
  { name: "credit-card", pattern: /(?<![\d-])(?:\d[ -]?){13,19}(?![\d-])/g },
  { name: "us-phone", pattern: /(?<![\d.])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)/g },
];

// The hard backstop. After redaction, none of these may remain. This set is a
// strict subset of the rules above: only the shapes that are almost never a
// false positive, so a survivor here is a real leak, not noise. Card and phone
// patterns are intentionally excluded because synthetic demo data can resemble
// them; the email and key shapes are the ones that must never escape.
export const FORBIDDEN_RESIDUAL: RedactionRule[] = [
  { name: "anthropic-key", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: "openai-key", pattern: /sk-(?:proj-)?[a-zA-Z0-9_-]{20,}/ },
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
];

function placeholder(rule: string): string {
  return `[REDACTED:${rule}]`;
}

function redactString(input: string, rules: RedactionRule[], path: string, hits: RedactionHit[]): string {
  let out = input;
  for (const rule of rules) {
    // Reset lastIndex defensively; these are module-level global regexes.
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(out)) {
      hits.push({ rule: rule.name, path });
      rule.pattern.lastIndex = 0;
      out = out.replace(rule.pattern, placeholder(rule.name));
    }
  }
  return out;
}

// Recursively redact a value of unknown shape. Returns a new tree; the input is
// not mutated. Sensitive-named keys have their entire value replaced.
export function redact<T>(value: T, rules: RedactionRule[] = DEFAULT_RULES): RedactionResult<T> {
  const hits: RedactionHit[] = [];

  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === "string") {
      return redactString(node, rules, path, hits);
    }
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, `${path}[${i}]`));
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        if (SENSITIVE_KEY.test(key)) {
          hits.push({ rule: "sensitive-key", path: childPath });
          out[key] = placeholder(`key:${key.toLowerCase()}`);
        } else {
          out[key] = walk(val, childPath);
        }
      }
      return out;
    }
    // numbers, booleans, null, undefined: nothing to redact.
    return node;
  };

  return { value: walk(value, "") as T, hits };
}

export interface RedactionCheck {
  ok: boolean;
  // Which forbidden shapes survived, if any. Empty when ok.
  residual: string[];
}

// The fail-closed verification. Serialize the (already redacted) tree and scan
// for forbidden shapes. If any remain, the cassette must not be written.
export function verifyRedaction(value: unknown, forbidden: RedactionRule[] = FORBIDDEN_RESIDUAL): RedactionCheck {
  const serialized = JSON.stringify(value);
  const residual: string[] = [];
  for (const rule of forbidden) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(serialized)) {
      residual.push(rule.name);
    }
  }
  return { ok: residual.length === 0, residual };
}
