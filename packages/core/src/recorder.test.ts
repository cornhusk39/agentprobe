import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineAgent } from "./agent.js";
import { record } from "./recorder.js";
import { readCassette, cassetteFileName } from "./cassette.js";
import { DEFAULT_RULES } from "./redaction.js";
import type { RunContext } from "./types.js";

const fixedCtx: RunContext = { now: () => 1_700_000_000_000 };

const bookingAgent = defineAgent("booking", (input) => ({
  // Deliberately echo a PII-bearing string into the output so the recorder has
  // something to redact end to end.
  output: `confirmation sent to ${(input as { email: string }).email}`,
  trace: [{ type: "tool_call", call: { name: "book", args: { slot: "tue-9am" } } }],
  metrics: { latencyMs: 42, costUsd: 0.003, steps: 1 },
}));

describe("record", () => {
  it("captures a run to a redacted cassette on disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-rec-"));
    try {
      const { cassette, result } = await record({
        agent: bookingAgent,
        caseId: "booking-happy",
        input: { email: "customer@example.com", q: "book me tuesday" },
        dir,
        ctx: fixedCtx,
      });

      // The live result still holds the real data; only the persisted cassette
      // is redacted.
      expect(result.output).toContain("customer@example.com");

      const onDisk = await readCassette(path.join(dir, cassetteFileName("booking-happy")));
      const serialized = JSON.stringify(onDisk);
      expect(serialized).not.toContain("customer@example.com");
      expect(serialized).toContain("[REDACTED:email]");
      expect(onDisk.recordedAt).toBe("2023-11-14T22:13:20.000Z");
      expect(cassette.agent).toBe("booking");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("builds a cassette without persisting when no dir is given", async () => {
    const { cassette } = await record({
      agent: bookingAgent,
      caseId: "no-dir",
      input: { email: "a@b.com" },
      ctx: fixedCtx,
    });
    expect(cassette.caseId).toBe("no-dir");
    expect(JSON.stringify(cassette)).not.toContain("a@b.com");
  });

  it("applies org-specific custom redaction rules on top of the defaults", async () => {
    // An agent that echoes an internal employee id the default rules do not know.
    const internalAgent = defineAgent("internal", (input) => ({
      output: `assigned to ${(input as { agent: string }).agent}, notify customer@example.com`,
      trace: [],
      metrics: { latencyMs: 1, costUsd: 0, steps: 0 },
    }));

    const { cassette } = await record({
      agent: internalAgent,
      caseId: "custom-rule",
      input: { agent: "EMP-90210" },
      ctx: fixedCtx,
      // Defaults plus an org pattern for employee ids.
      rules: [...DEFAULT_RULES, { name: "employee-id", pattern: /EMP-\d+/g }],
    });

    const serialized = JSON.stringify(cassette);
    // The custom pattern is redacted...
    expect(serialized).not.toContain("EMP-90210");
    expect(serialized).toContain("[REDACTED:employee-id]");
    // ...and the defaults still apply.
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).toContain("[REDACTED:email]");
  });
});
