import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineAgent } from "./agent.js";
import { defineSuite } from "./suite.js";
import { scriptedJudge } from "./judge.js";
import { runSuite, persistRun } from "./runner.js";
import { Store } from "./store.js";

const now = () => 1_700_000_000_000;

const suite = defineSuite({
  name: "booking",
  cases: [
    {
      id: "happy",
      input: { q: "book tuesday 9am" },
      assertions: [
        { kind: "tool-called", tool: "book_slot" },
        { kind: "latency-budget", maxMs: 1000 },
      ],
      rubric: { criteria: "confirms the booking", passThreshold: 0.7 },
    },
    {
      id: "wrong-tool",
      input: { q: "book tuesday 9am" },
      assertions: [{ kind: "tool-called", tool: "book_slot" }],
    },
  ],
});

// Two agents: one books correctly, one calls the wrong tool.
const goodAgent = defineAgent("booking-agent", () => ({
  output: { reply: "Booked, confirmation BK-1." },
  trace: [{ type: "tool_call", call: { name: "book_slot", args: { slot: "tue-9am" } } }],
  metrics: { latencyMs: 700, costUsd: 0.01, steps: 3 },
}));
const wrongToolAgent = defineAgent("booking-agent", () => ({
  output: { reply: "I looked something up." },
  trace: [{ type: "tool_call", call: { name: "search_web", args: {} } }],
  metrics: { latencyMs: 500, costUsd: 0.005, steps: 2 },
}));

const tmpDirs: string[] = [];
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe("runSuite", () => {
  it("scores each case with assertions and the judge, then aggregates", async () => {
    const report = await runSuite({
      suite,
      agentFor: (c) => (c.id === "happy" ? goodAgent : wrongToolAgent),
      judge: scriptedJudge(() => ({ score: 0.95, rationale: "clear confirmation" })),
      mode: "replay",
      now,
    });

    expect(report.casesTotal).toBe(2);
    // happy passes (assertions + judge), wrong-tool fails the tool assertion
    expect(report.casesPassed).toBe(1);
    const happy = report.cases.find((c) => c.caseId === "happy")!;
    expect(happy.passed).toBe(true);
    expect(happy.judge?.pass).toBe(true);
    const wrong = report.cases.find((c) => c.caseId === "wrong-tool")!;
    expect(wrong.passed).toBe(false);
    // aggregate metrics sum across cases
    expect(report.totalCostUsd).toBeCloseTo(0.015);
    expect(report.avgJudgeScore).toBeCloseTo(0.95);
  });

  it("records a failed case instead of throwing when an agent errors", async () => {
    const boom = defineAgent("booking-agent", () => {
      throw new Error("connection refused");
    });
    const report = await runSuite({
      suite: defineSuite({ name: "booking", cases: [{ id: "happy", input: {}, assertions: [] }] }),
      agentFor: () => boom,
      mode: "replay",
      now,
    });
    expect(report.cases[0]!.passed).toBe(false);
    expect(report.cases[0]!.error).toContain("connection refused");
  });

  it("persists a run to the store and reads it back", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-run-"));
    tmpDirs.push(dir);
    const store = new Store(path.join(dir, "runs.db"));
    const report = await runSuite({
      suite,
      agentFor: (c) => (c.id === "happy" ? goodAgent : wrongToolAgent),
      judge: scriptedJudge(() => ({ score: 0.95, rationale: "clear" })),
      mode: "replay",
      now,
      runUid: "fixed-run-1",
    });
    const id = persistRun(store, report);
    const stored = store.getRun(id);
    expect(stored?.runUid).toBe("fixed-run-1");
    expect(store.getCaseResults(id)).toHaveLength(2);
    store.close();
  });
});
