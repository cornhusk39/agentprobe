import { describe, it, expect } from "vitest";
import { defineAgent } from "../agent.js";
import { record } from "../recorder.js";
import { replayAgent, ReplayStore, CassetteInputDriftError } from "./replay.js";
import { evaluateAssertions, assertionsPassed } from "../assertions.js";
import type { Assertion } from "../assertions.js";
import type { RunContext } from "../types.js";

const ctx: RunContext = { now: () => 1_700_000_000_000 };

// An agent with a deliberately non-deterministic clock-based field. Recording it
// once and replaying proves replay returns the frozen result, not a fresh run.
let counter = 0;
const flaky = defineAgent("flaky", () => ({
  output: { attempt: ++counter },
  trace: [{ type: "tool_call", call: { name: "book_slot", args: { slot: "tue-9am" } } }],
  metrics: { latencyMs: 700, costUsd: 0.01, steps: 1 },
}));

describe("replay transport", () => {
  it("returns the recorded result deterministically across replays", async () => {
    const { cassette } = await record({
      agent: flaky,
      caseId: "deterministic",
      input: { q: "book tuesday" },
      ctx,
    });
    const replay = replayAgent(cassette);

    const a = await replay.run({ q: "book tuesday" }, ctx);
    const b = await replay.run({ q: "book tuesday" }, ctx);
    // Same frozen value both times, even though the live agent would increment.
    expect(a.output).toEqual(b.output);
    expect((a.output as { attempt: number }).attempt).toBe((cassette.result.output as { attempt: number }).attempt);
  });

  it("scores the same cassette offline and deterministically", async () => {
    const { cassette } = await record({
      agent: flaky,
      caseId: "scored",
      input: { q: "book tuesday" },
      ctx,
    });
    const assertions: Assertion[] = [
      { kind: "tool-called", tool: "book_slot" },
      { kind: "tool-args", tool: "book_slot", args: { slot: "tue-9am" }, match: "subset" },
      { kind: "latency-budget", maxMs: 1000 },
    ];
    const replay = replayAgent(cassette);
    const result = await replay.run(cassette.input, ctx);
    expect(assertionsPassed(evaluateAssertions(result, assertions))).toBe(true);
  });

  it("flags input drift when strictInput is on", async () => {
    const { cassette } = await record({ agent: flaky, caseId: "drift", input: { q: "a" }, ctx });
    const replay = replayAgent(cassette, { strictInput: true });
    await expect(replay.run({ q: "different" }, ctx)).rejects.toThrow(CassetteInputDriftError);
    // matching input still works
    await expect(replay.run({ q: "a" }, ctx)).resolves.toBeTruthy();
  });
});

describe("ReplayStore", () => {
  it("keys cassettes by case id and builds per-case replay agents", async () => {
    const { cassette: c1 } = await record({ agent: flaky, caseId: "one", input: {}, ctx });
    const { cassette: c2 } = await record({ agent: flaky, caseId: "two", input: {}, ctx });
    const store = new ReplayStore([c1, c2]);
    expect(store.caseIds().sort()).toEqual(["one", "two"]);
    expect(store.has("one")).toBe(true);
    const agent = store.agentFor("two");
    const r = await agent.run({}, ctx);
    expect(r.output).toEqual(c2.result.output);
    expect(() => store.agentFor("missing")).toThrow();
  });
});
