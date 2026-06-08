import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCassette,
  writeCassette,
  readCassette,
  cassetteFileName,
  RedactionFailedError,
} from "./cassette.js";

const baseResult = {
  output: "booked",
  trace: [{ type: "tool_call" as const, call: { name: "book", args: { when: "tue" } } }],
  metrics: { latencyMs: 100, costUsd: 0.01, steps: 1 },
};

describe("buildCassette", () => {
  it("redacts secrets in input and output before producing a cassette", () => {
    const { cassette } = buildCassette({
      caseId: "c1",
      agent: "demo",
      recordedAt: "2023-11-14T22:13:20.000Z",
      input: { user: "reach me at john@example.com" },
      result: { ...baseResult, output: "confirmation sent to john@example.com" },
    });
    const serialized = JSON.stringify(cassette);
    expect(serialized).not.toContain("john@example.com");
    expect(serialized).toContain("[REDACTED:email]");
    expect(cassette.redaction?.hits.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses to build when a secret survives a weakened rule set", () => {
    // Simulate misconfiguration: redaction rules are emptied, so the email is
    // not transformed. The fixed fail-closed backstop must still refuse.
    expect(() =>
      buildCassette(
        {
          caseId: "c2",
          agent: "demo",
          recordedAt: "2023-11-14T22:13:20.000Z",
          input: { contact: "leak@example.com" },
          result: baseResult,
        },
        [],
      ),
    ).toThrow(RedactionFailedError);
  });
});

describe("writeCassette / readCassette", () => {
  it("round-trips a cassette through disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-"));
    try {
      const written = await writeCassette(dir, {
        caseId: "round/trip",
        agent: "demo",
        recordedAt: "2023-11-14T22:13:20.000Z",
        input: { q: "availability" },
        result: baseResult,
      });
      // caseId with a slash must be sanitized into the filename.
      const file = path.join(dir, cassetteFileName("round/trip"));
      expect(file.endsWith("round_trip.json")).toBe(true);
      const read = await readCassette(file);
      expect(read).toEqual(written);
      expect(read.result.output).toBe("booked");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
