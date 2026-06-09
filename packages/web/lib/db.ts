// Server-only data access backed by the live SQLite database. This is what makes
// the dashboard interactive: it reads the same database the CLI and the server
// actions write to, so a run triggered from the browser shows up here on the
// next render. Only server components and server actions import this module; the
// engine's native dependency never reaches the client.
//
// The engine stores runs in a flat row shape; this layer rebuilds the richer
// view objects the pages already consume (the same shape the static seed used),
// and computes each run's regression verdict against the baseline on read.

import path from "node:path";
import {
  Store,
  snapshotFromReport,
  diffRuns,
  type CaseHistoryPoint,
  type RegressionReport,
  type StoredCaseResult,
  type StoredRun,
} from "@agentprobe/core";
import type { CaseClassification, RunRegression, SeedCase, SeedRun } from "./types";

let store: Store | null = null;

export function dbPath(): string {
  return process.env.AGENTPROBE_DB_PATH ?? path.join(process.cwd(), "data", "agentprobe.db");
}

function db(): Store {
  if (!store) {
    store = new Store(dbPath());
  }
  return store;
}

// Mark an existing run as the suite's baseline. A direct database write, used by
// the "set as baseline" action; no subprocess needed.
export function markBaselineById(id: number): void {
  db().markBaseline(id);
}

// Delete a run and its case results. Used by the "delete run" action.
export function deleteRunById(id: number): boolean {
  return db().deleteRun(id);
}

function toCase(c: StoredCaseResult): SeedCase {
  return {
    caseId: c.caseId,
    passed: c.passed,
    assertions: (c.assertions as SeedCase["assertions"]) ?? [],
    assertionsPassed: c.assertionsPassed,
    assertionsTotal: c.assertionsTotal,
    judge:
      c.judgeScore !== null
        ? {
            score: c.judgeScore,
            pass: c.judgePass ?? false,
            rationale: c.judgeRationale ?? "",
            // The engine does not persist the judge model on the row; the rubric
            // carries it. Label it generically here for display.
            model: "judge",
          }
        : undefined,
    metrics: { latencyMs: c.latencyMs, costUsd: c.costUsd, steps: c.steps },
    output: c.output,
    trace: c.trace as SeedCase["trace"],
    error: c.error ?? undefined,
  };
}

function toRun(run: StoredRun, cases: SeedCase[]): SeedRun {
  return {
    id: run.id,
    runUid: run.runUid,
    suite: run.suite,
    agent: run.agent,
    mode: run.mode,
    createdAt: run.createdAt,
    isBaseline: run.isBaseline,
    gitSha: run.gitSha ?? undefined,
    cases,
    casesPassed: run.casesPassed,
    casesTotal: run.casesTotal,
    totalCostUsd: run.totalCostUsd,
    totalLatencyMs: run.totalLatencyMs,
    avgJudgeScore: run.avgJudgeScore,
  };
}

function hydrate(run: StoredRun): SeedRun {
  return toRun(run, db().getCaseResults(run.id).map(toCase));
}

// The single suite the demo tracks. Multi-suite support is a later concern; for
// now the first suite seen is the active one.
function activeSuite(): string {
  const runs = db().listRuns(undefined, 1);
  return runs[0]?.suite ?? "home-service-booking";
}

export function suiteName(): string {
  return activeSuite();
}

function withRegression(run: SeedRun, baseline: SeedRun | undefined): SeedRun {
  if (!baseline || baseline.id === run.id) return run;
  const diff = diffRuns(snapshotFromReport(baseline), snapshotFromReport(run));
  const caseClassifications: Record<string, CaseClassification> = {};
  for (const c of diff.cases) caseClassifications[c.caseId] = c.classification;
  const regression: RunRegression = {
    regressed: diff.regressed,
    reasons: diff.reasons,
    caseClassifications,
  };
  return { ...run, regression };
}

export function getBaseline(): SeedRun | undefined {
  const b = db().getBaseline(activeSuite());
  return b ? hydrate(b) : undefined;
}

export function listRuns(): SeedRun[] {
  const baseline = getBaseline();
  return db()
    .listRuns(activeSuite())
    .map(hydrate)
    .map((r) => withRegression(r, baseline));
}

export function getRun(id: number): SeedRun | undefined {
  const run = db().getRun(id);
  if (!run) return undefined;
  return withRegression(hydrate(run), getBaseline());
}

export interface RunRef {
  id: number;
  runUid: string;
  createdAt: string;
  isBaseline: boolean;
  casesPassed: number;
  casesTotal: number;
}

// Lightweight list for the compare pickers, newest first.
export function runRefs(): RunRef[] {
  return db()
    .listRuns(activeSuite())
    .map((r) => ({
      id: r.id,
      runUid: r.runUid,
      createdAt: r.createdAt,
      isBaseline: r.isBaseline,
      casesPassed: r.casesPassed,
      casesTotal: r.casesTotal,
    }));
}

// One case's result across every run, oldest to newest, for the case history
// view.
export function caseHistory(caseId: string): CaseHistoryPoint[] {
  return db().caseHistory(activeSuite(), caseId);
}

// Diff any two runs against each other, base versus candidate. Returns null if
// either run is missing. This is what the interactive compare view renders.
export function compareRuns(baseId: number, candidateId: number): RegressionReport | null {
  const base = getRun(baseId);
  const candidate = getRun(candidateId);
  if (!base || !candidate) return null;
  return diffRuns(snapshotFromReport(base), snapshotFromReport(candidate));
}

export interface TrendSeries {
  passRate: number[];
  judge: number[];
  cost: number[];
  latency: number[];
  regressedRunIndices: number[];
  runIds: number[];
}

export function trendSeries(): TrendSeries {
  const baseline = getBaseline();
  // Oldest to newest for the charts.
  const runs = db()
    .listRuns(activeSuite())
    .map(hydrate)
    .map((r) => withRegression(r, baseline))
    .sort((a, b) => a.id - b.id);
  return {
    passRate: runs.map((r) => (r.casesTotal ? r.casesPassed / r.casesTotal : 0)),
    judge: runs.map((r) => r.avgJudgeScore ?? 0),
    cost: runs.map((r) => r.totalCostUsd),
    latency: runs.map((r) => r.totalLatencyMs),
    regressedRunIndices: runs.flatMap((r, i) => (r.regression?.regressed ? [i] : [])),
    runIds: runs.map((r) => r.id),
  };
}
