import { describe, it, expect } from "vitest";
import { redact, verifyRedaction } from "./redaction.js";

describe("redact", () => {
  it("removes provider keys, emails, and bearer tokens from strings", () => {
    const { value, hits } = redact({
      note: "contact jane.doe@example.com about key sk-ant-abcdefghijklmnopqrstuvwxyz12",
      header: "Authorization: Bearer abcdef0123456789abcdef0123456789",
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain("jane.doe@example.com");
    expect(serialized).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz12");
    expect(serialized).toContain("[REDACTED:email]");
    expect(serialized).toContain("[REDACTED:anthropic-key]");
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it("redacts whole values for sensitive key names regardless of content", () => {
    const { value } = redact({ api_key: "totally-custom-format-not-a-known-pattern" });
    expect((value as Record<string, unknown>).api_key).toBe("[REDACTED:key:api_key]");
  });

  it("recurses through arrays and nested objects without mutating input", () => {
    const input = { users: [{ email: "a@b.com" }, { email: "c@d.com" }] };
    const { value } = redact(input);
    expect(JSON.stringify(value)).not.toContain("@b.com");
    // input is untouched
    expect(input.users[0]!.email).toBe("a@b.com");
  });

  it("redacts digit-run PII even when glued to surrounding text", () => {
    const { value } = redact({
      a: "phone:5125550142x",
      b: "card 1234567890123456789", // 19 digits
      c: "ssn123-45-6789",
    });
    const s = JSON.stringify(value);
    expect(s).not.toContain("5125550142");
    expect(s).not.toContain("1234567890123456789");
    expect(s).not.toContain("123-45-6789");
  });

  it("leaves non-secret data alone", () => {
    const { value, hits } = redact({ city: "Austin", count: 3, ok: true });
    expect(value).toEqual({ city: "Austin", count: 3, ok: true });
    expect(hits).toHaveLength(0);
  });
});

describe("verifyRedaction", () => {
  it("passes when nothing forbidden remains", () => {
    const { value } = redact({ email: "x@y.com", key: "sk-ant-abcdefghijklmnopqrstuvwxyz12" });
    expect(verifyRedaction(value).ok).toBe(true);
  });

  it("fails closed when a forbidden shape survives", () => {
    // Simulate a secret that redaction did not transform (e.g. arrived in a
    // position the rules did not cover). The backstop must catch it.
    const check = verifyRedaction({ leaked: "sk-ant-abcdefghijklmnopqrstuvwxyz12" });
    expect(check.ok).toBe(false);
    expect(check.residual).toContain("anthropic-key");
  });
});
