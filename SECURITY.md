# Security Policy

AgentProbe records agent runs and is meant to run in CI, so it takes a few
deliberate precautions. If you find a vulnerability, please do not open a public
issue; email the maintainer or use GitHub's private "Report a vulnerability"
flow under the Security tab.

## How AgentProbe protects secrets and PII

- **Redaction at capture time.** Cassettes are redacted before they are written
  to disk, covering provider API keys, tokens, JWTs, emails, and other PII. A
  fail-closed backstop refuses to write a cassette that still contains a known
  secret shape, and a project can extend the rule set with its own patterns.
- **Secrets live in env only.** `.env` is gitignored, `.env.example` is
  committed, a gitleaks pre-commit hook runs on every commit, and CI runs a
  server-side gitleaks scan of the full history.
- **The HTTP adapter is defensive about untrusted endpoints.** It enforces an
  endpoint allowlist, reads the bearer token from env at call time, applies a
  response timeout and a hard size cap, and never follows redirects.
- **The LLM judge treats agent output as data, not instructions.** Output is
  JSON-encoded inside delimiters and the judge is constrained to a fixed-schema
  tool call, so a prompt-injection attempt in the output cannot steer the score.

## Supported versions

This is a pre-1.0 project; fixes land on `main`.
