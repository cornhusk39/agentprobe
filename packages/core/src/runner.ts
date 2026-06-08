// The runner ties the engine together: for each case in a suite it gets an
// agent (live or replay), runs it, scores the result with deterministic
// assertions and, when a rubric is present, the LLM judge, then aggregates the
// run. It is transport-agnostic by design; whether the agent is a live HTTP call
// or a replayed cassette is the caller's choice via agentFor. A run report is a
// plain data structure so it can be persisted, diffed, or printed unchanged.

import type { Agent } from "./agent.js";
import type { Suite, Case } from "./suite.js";
import type { Judge, JudgeVerdict } from "./judge.js";
import type { RunMetrics, TraceStep } from "./types.js";
import { evaluateAssertions, type AssertionResult } from "./assertions.js";
import type { NewCaseResult, NewRun, Store } from "./store.js";

export interface CaseReport {
  caseId: string;
  passed: boolean;
  assertions: AssertionResult[];
  assertionsPassed: number;
  assertionsTotal: number;
  judge?: JudgeVerdict;
  metrics: RunMetrics;
  output: unknown;
  trace: TraceStep[];
  // Set when the agent transport threw. An errored case is never a pass.
  error?: string;
}

export interface RunReport {
  runUid: string;
  suite: string;
  agent: string;
  mode: "record" | "replay";
  createdAt: string;
  gitSha?: string;
  cases: CaseReport[];
  casesPassed: number;
  casesTotal: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  avgJudgeScore: number | null;
}

export interface RunSuiteOptions {
  suite: Suite;
  // Resolves the agent for a case. In replay mode this comes from a ReplayStore;
  // in record mode it is a live adapter.
  agentFor: (c: Case) => Agent;
  judge?: Judge;
  mode: "record" | "replay";
  // Injected clock so run timestamps and ids are deterministic under test.
  now: () => number;
  runUid?: string;
  gitSha?: string;
  signal?: AbortSignal;
}

const ZERO_METRICS: RunMetrics = { latencyMs: 0, costUsd: 0, steps: 0 };

async function runCase(c: Case, agent: Agent, judge: Judge | undefined, now: () => number, signal?: AbortSignal): Promise<CaseReport> {
  const ctx = { now, signal };
  try {
    const result = await agent.run(c.input, ctx);
    const assertions = evaluateAssertions(result, c.assertions);
    const assertionsPassed = assertions.filter((a) => a.pass).length;

    let judgeVerdict: JudgeVerdict | undefined;
    if (c.rubric && judge) {
      judgeVerdict = await judge.evaluate({
        caseId: c.id,
        input: c.input,
        output: result.output,
        rubric: c.rubric,
      });
    }

    const assertionsOk = assertionsPassed === assertions.length;
    const judgeOk = judgeVerdict ? judgeVerdict.pass : true;

    return {
      caseId: c.id,
      passed: assertionsOk && judgeOk,
      assertions,
      assertionsPassed,
      assertionsTotal: assertions.length,
      judge: judgeVerdict,
      metrics: result.metrics,
      output: result.output,
      trace: result.trace,
    };
  } catch (err) {
    // A transport failure is a failed case, captured rather than thrown, so one
    // broken case does not abandon the rest of the suite.
    return {
      caseId: c.id,
      passed: false,
      assertions: [],
      assertionsPassed: 0,
      assertionsTotal: c.assertions.length,
      metrics: ZERO_METRICS,
      output: null,
      trace: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runSuite(options: RunSuiteOptions): Promise<RunReport> {
  const { suite, agentFor, judge, mode, now } = options;
  const createdAt = new Date(now()).toISOString();
  const runUid = options.runUid ?? `${suite.name}-${now()}`;

  const cases: CaseReport[] = [];
  let agentName = suite.name;
  for (const c of suite.cases) {
    const agent = agentFor(c);
    agentName = agent.name;
    cases.push(await runCase(c, agent, judge, now, options.signal));
  }

  const casesPassed = cases.filter((c) => c.passed).length;
  const totalCostUsd = cases.reduce((s, c) => s + c.metrics.costUsd, 0);
  const totalLatencyMs = cases.reduce((s, c) => s + c.metrics.latencyMs, 0);
  const judged = cases.filter((c) => c.judge);
  const avgJudgeScore =
    judged.length > 0 ? judged.reduce((s, c) => s + (c.judge?.score ?? 0), 0) / judged.length : null;

  return {
    runUid,
    suite: suite.name,
    agent: agentName,
    mode,
    createdAt,
    gitSha: options.gitSha,
    cases,
    casesPassed,
    casesTotal: cases.length,
    totalCostUsd,
    totalLatencyMs,
    avgJudgeScore,
  };
}

// Map a run report onto the persistence shapes and store it atomically. Kept
// separate from running so a caller can run without a database (CI dry runs,
// tests) and persist only when they want history.
export function persistRun(store: Store, report: RunReport): number {
  const run: NewRun = {
    runUid: report.runUid,
    suite: report.suite,
    agent: report.agent,
    mode: report.mode,
    createdAt: report.createdAt,
    gitSha: report.gitSha ?? null,
    casesTotal: report.casesTotal,
    casesPassed: report.casesPassed,
    totalCostUsd: report.totalCostUsd,
    totalLatencyMs: report.totalLatencyMs,
    avgJudgeScore: report.avgJudgeScore,
  };
  const caseResults: NewCaseResult[] = report.cases.map((c) => ({
    caseId: c.caseId,
    passed: c.passed,
    assertionsPassed: c.assertionsPassed,
    assertionsTotal: c.assertionsTotal,
    judgeScore: c.judge?.score ?? null,
    judgePass: c.judge ? c.judge.pass : null,
    judgeRationale: c.judge?.rationale ?? null,
    latencyMs: c.metrics.latencyMs,
    costUsd: c.metrics.costUsd,
    steps: c.metrics.steps,
    output: c.output,
    trace: c.trace,
    assertions: c.assertions,
    error: c.error ?? null,
  }));
  return store.saveRun(run, caseResults);
}
