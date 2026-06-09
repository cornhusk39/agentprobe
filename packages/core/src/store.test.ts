import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, flipCount, type NewRun, type NewCaseResult } from "./store.js";

const tmpFiles: string[] = [];
async function tmpDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-db-"));
  const file = path.join(dir, "test.db");
  tmpFiles.push(dir);
  return file;
}
afterEach(async () => {
  for (const dir of tmpFiles.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

function makeRun(uid: string, passed: number): { run: NewRun; cases: NewCaseResult[] } {
  const run: NewRun = {
    runUid: uid,
    suite: "booking",
    agent: "booking-agent",
    mode: "replay",
    createdAt: "2026-06-08T10:00:00.000Z",
    casesTotal: 2,
    casesPassed: passed,
    totalCostUsd: 0.03,
    totalLatencyMs: 1500,
    avgJudgeScore: 0.82,
  };
  const cases: NewCaseResult[] = [
    {
      caseId: "happy",
      passed: true,
      assertionsPassed: 2,
      assertionsTotal: 2,
      judgeScore: 0.9,
      judgePass: true,
      judgeRationale: "clear",
      latencyMs: 700,
      costUsd: 0.01,
      steps: 3,
      output: { confirmationId: "BK-1" },
      trace: [{ type: "tool_call", call: { name: "book_slot", args: { slot: "tue-9am" } } }],
      assertions: [{ kind: "tool-called", label: "book_slot", pass: true, message: "ok" }],
      error: null,
    },
    {
      caseId: "edge",
      passed: passed === 2,
      assertionsPassed: passed === 2 ? 1 : 0,
      assertionsTotal: 1,
      judgeScore: 0.74,
      judgePass: true,
      judgeRationale: "fine",
      latencyMs: 800,
      costUsd: 0.02,
      steps: 4,
      output: { confirmationId: "BK-2" },
      trace: [],
      assertions: [],
      error: null,
    },
  ];
  return { run, cases };
}

describe("Store", () => {
  it("saves a run with case results and reads them back with JSON intact", async () => {
    const store = new Store(await tmpDb());
    const { run, cases } = makeRun("run-1", 2);
    const id = store.saveRun(run, cases);

    const stored = store.getRun(id);
    expect(stored?.runUid).toBe("run-1");
    expect(stored?.casesPassed).toBe(2);
    expect(stored?.isBaseline).toBe(false);

    const results = store.getCaseResults(id);
    expect(results).toHaveLength(2);
    expect(results[0]!.output).toEqual({ confirmationId: "BK-1" });
    expect((results[0]!.trace as unknown[]).length).toBe(1);
    expect(results[0]!.judgePass).toBe(true);
    store.close();
  });

  it("keeps exactly one baseline per suite", async () => {
    const store = new Store(await tmpDb());
    const a = store.saveRun(...Object.values(makeRun("run-a", 2)) as [NewRun, NewCaseResult[]]);
    const b = store.saveRun(...Object.values(makeRun("run-b", 1)) as [NewRun, NewCaseResult[]]);

    store.markBaseline(a);
    expect(store.getBaseline("booking")?.id).toBe(a);
    // moving the baseline clears the previous one
    store.markBaseline(b);
    expect(store.getBaseline("booking")?.id).toBe(b);
    expect(store.getRun(a)?.isBaseline).toBe(false);
    store.close();
  });

  it("deletes a run and cascades to its case results", async () => {
    const store = new Store(await tmpDb());
    const a = store.saveRun(...(Object.values(makeRun("run-a", 2)) as [NewRun, NewCaseResult[]]));
    const b = store.saveRun(...(Object.values(makeRun("run-b", 1)) as [NewRun, NewCaseResult[]]));

    expect(store.getCaseResults(a)).toHaveLength(2);
    expect(store.deleteRun(a)).toBe(true);
    expect(store.getRun(a)).toBeUndefined();
    // case results for the deleted run are gone, the other run is untouched
    expect(store.getCaseResults(a)).toHaveLength(0);
    expect(store.getRun(b)?.runUid).toBe("run-b");
    // deleting a missing run reports no change
    expect(store.deleteRun(9999)).toBe(false);
    store.close();
  });

  it("returns trend points oldest to newest", async () => {
    const store = new Store(await tmpDb());
    store.saveRun(...Object.values(makeRun("run-1", 2)) as [NewRun, NewCaseResult[]]);
    store.saveRun(...Object.values(makeRun("run-2", 1)) as [NewRun, NewCaseResult[]]);
    const trend = store.trends("booking");
    expect(trend.map((t) => t.runUid)).toEqual(["run-1", "run-2"]);
    store.close();
  });

  it("flipCount counts pass/fail status changes", () => {
    expect(flipCount([])).toBe(0);
    expect(flipCount([true, true, true])).toBe(0);
    // pass,pass,pass,fail,fail,pass,pass -> two flips (regression then recovery)
    expect(flipCount([true, true, true, false, false, true, true])).toBe(2);
    // alternating is maximally flaky
    expect(flipCount([true, false, true, false])).toBe(3);
  });

  it("lists distinct case ids across a suite's runs", async () => {
    const store = new Store(await tmpDb());
    store.saveRun(...(Object.values(makeRun("run-1", 2)) as [NewRun, NewCaseResult[]]));
    store.saveRun(...(Object.values(makeRun("run-2", 1)) as [NewRun, NewCaseResult[]]));
    expect(store.caseIds("booking")).toEqual(["edge", "happy"]);
    expect(store.caseIds("other-suite")).toEqual([]);
    store.close();
  });

  it("returns one case's history across runs, oldest to newest", async () => {
    const store = new Store(await tmpDb());
    store.saveRun(...(Object.values(makeRun("run-1", 2)) as [NewRun, NewCaseResult[]]));
    store.saveRun(...(Object.values(makeRun("run-2", 1)) as [NewRun, NewCaseResult[]]));

    // The "edge" case passes in run-1 (passed=2) and fails in run-2 (passed=1).
    const edge = store.caseHistory("booking", "edge");
    expect(edge.map((p) => p.runUid)).toEqual(["run-1", "run-2"]);
    expect(edge.map((p) => p.passed)).toEqual([true, false]);
    expect(edge[0]!.judgeScore).toBe(0.74);

    // The "happy" case is present in both runs.
    expect(store.caseHistory("booking", "happy")).toHaveLength(2);
    // An unknown case has no history.
    expect(store.caseHistory("booking", "nope")).toHaveLength(0);
    store.close();
  });
});
