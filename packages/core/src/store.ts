// Run persistence. Every suite run, with its per-case scores, traces, cost, and
// latency, lands in SQLite so the dashboard can render history and the
// regression diff can compare a run against a saved baseline. better-sqlite3 is
// synchronous, which keeps this code straight-line and the transactions simple.
//
// JSON-shaped fields (output, trace, assertions) are stored as TEXT and parsed
// on read. They are display and audit data, not something we query into, so a
// blob column is the right tradeoff over a wide normalized schema.

import Database from "better-sqlite3";

type DB = Database.Database;

export interface NewRun {
  runUid: string;
  suite: string;
  agent: string;
  mode: "record" | "replay";
  createdAt: string;
  gitSha?: string | null;
  casesTotal: number;
  casesPassed: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  avgJudgeScore: number | null;
}

export interface StoredRun extends NewRun {
  id: number;
  isBaseline: boolean;
  gitSha: string | null;
}

export interface NewCaseResult {
  caseId: string;
  passed: boolean;
  assertionsPassed: number;
  assertionsTotal: number;
  judgeScore: number | null;
  judgePass: boolean | null;
  judgeRationale: string | null;
  latencyMs: number;
  costUsd: number;
  steps: number;
  output: unknown;
  trace: unknown;
  assertions: unknown;
  error: string | null;
}

export interface StoredCaseResult extends Omit<NewCaseResult, "output" | "trace" | "assertions"> {
  id: number;
  runId: number;
  output: unknown;
  trace: unknown;
  assertions: unknown;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uid TEXT NOT NULL UNIQUE,
  suite TEXT NOT NULL,
  agent TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  git_sha TEXT,
  is_baseline INTEGER NOT NULL DEFAULT 0,
  cases_total INTEGER NOT NULL,
  cases_passed INTEGER NOT NULL,
  total_cost_usd REAL NOT NULL,
  total_latency_ms INTEGER NOT NULL,
  avg_judge_score REAL
);

CREATE TABLE IF NOT EXISTS case_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  assertions_passed INTEGER NOT NULL,
  assertions_total INTEGER NOT NULL,
  judge_score REAL,
  judge_pass INTEGER,
  judge_rationale TEXT,
  latency_ms INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  steps INTEGER NOT NULL,
  output_json TEXT NOT NULL,
  trace_json TEXT NOT NULL,
  assertions_json TEXT NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_suite ON runs(suite, created_at);
CREATE INDEX IF NOT EXISTS idx_case_results_run ON case_results(run_id);
`;

interface RunRow {
  id: number;
  run_uid: string;
  suite: string;
  agent: string;
  mode: string;
  created_at: string;
  git_sha: string | null;
  is_baseline: number;
  cases_total: number;
  cases_passed: number;
  total_cost_usd: number;
  total_latency_ms: number;
  avg_judge_score: number | null;
}

interface CaseRow {
  id: number;
  run_id: number;
  case_id: string;
  passed: number;
  assertions_passed: number;
  assertions_total: number;
  judge_score: number | null;
  judge_pass: number | null;
  judge_rationale: string | null;
  latency_ms: number;
  cost_usd: number;
  steps: number;
  output_json: string;
  trace_json: string;
  assertions_json: string;
  error: string | null;
}

function toStoredRun(row: RunRow): StoredRun {
  return {
    id: row.id,
    runUid: row.run_uid,
    suite: row.suite,
    agent: row.agent,
    mode: row.mode as "record" | "replay",
    createdAt: row.created_at,
    gitSha: row.git_sha,
    isBaseline: row.is_baseline === 1,
    casesTotal: row.cases_total,
    casesPassed: row.cases_passed,
    totalCostUsd: row.total_cost_usd,
    totalLatencyMs: row.total_latency_ms,
    avgJudgeScore: row.avg_judge_score,
  };
}

function toStoredCaseResult(row: CaseRow): StoredCaseResult {
  return {
    id: row.id,
    runId: row.run_id,
    caseId: row.case_id,
    passed: row.passed === 1,
    assertionsPassed: row.assertions_passed,
    assertionsTotal: row.assertions_total,
    judgeScore: row.judge_score,
    judgePass: row.judge_pass === null ? null : row.judge_pass === 1,
    judgeRationale: row.judge_rationale,
    latencyMs: row.latency_ms,
    costUsd: row.cost_usd,
    steps: row.steps,
    output: JSON.parse(row.output_json),
    trace: JSON.parse(row.trace_json),
    assertions: JSON.parse(row.assertions_json),
    error: row.error,
  };
}

export interface TrendPoint {
  runId: number;
  runUid: string;
  createdAt: string;
  casesPassed: number;
  casesTotal: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  avgJudgeScore: number | null;
}

export class Store {
  private db: DB;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // WAL keeps the dashboard's reads from blocking the CLI's writes.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  // Persist a run and its case results atomically. A half-written run would
  // corrupt every trend and diff that reads it, so it is all or nothing.
  saveRun(run: NewRun, caseResults: NewCaseResult[]): number {
    const insertRun = this.db.prepare(
      `INSERT INTO runs (run_uid, suite, agent, mode, created_at, git_sha, cases_total, cases_passed, total_cost_usd, total_latency_ms, avg_judge_score)
       VALUES (@runUid, @suite, @agent, @mode, @createdAt, @gitSha, @casesTotal, @casesPassed, @totalCostUsd, @totalLatencyMs, @avgJudgeScore)`,
    );
    const insertCase = this.db.prepare(
      `INSERT INTO case_results (run_id, case_id, passed, assertions_passed, assertions_total, judge_score, judge_pass, judge_rationale, latency_ms, cost_usd, steps, output_json, trace_json, assertions_json, error)
       VALUES (@runId, @caseId, @passed, @assertionsPassed, @assertionsTotal, @judgeScore, @judgePass, @judgeRationale, @latencyMs, @costUsd, @steps, @outputJson, @traceJson, @assertionsJson, @error)`,
    );

    const tx = this.db.transaction((r: NewRun, cases: NewCaseResult[]) => {
      const info = insertRun.run({
        runUid: r.runUid,
        suite: r.suite,
        agent: r.agent,
        mode: r.mode,
        createdAt: r.createdAt,
        gitSha: r.gitSha ?? null,
        casesTotal: r.casesTotal,
        casesPassed: r.casesPassed,
        totalCostUsd: r.totalCostUsd,
        totalLatencyMs: r.totalLatencyMs,
        avgJudgeScore: r.avgJudgeScore,
      });
      const runId = Number(info.lastInsertRowid);
      for (const c of cases) {
        insertCase.run({
          runId,
          caseId: c.caseId,
          passed: c.passed ? 1 : 0,
          assertionsPassed: c.assertionsPassed,
          assertionsTotal: c.assertionsTotal,
          judgeScore: c.judgeScore,
          judgePass: c.judgePass === null ? null : c.judgePass ? 1 : 0,
          judgeRationale: c.judgeRationale,
          latencyMs: c.latencyMs,
          costUsd: c.costUsd,
          steps: c.steps,
          outputJson: JSON.stringify(c.output ?? null),
          traceJson: JSON.stringify(c.trace ?? []),
          assertionsJson: JSON.stringify(c.assertions ?? []),
          error: c.error,
        });
      }
      return runId;
    });

    return tx(run, caseResults);
  }

  getRun(id: number): StoredRun | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    return row ? toStoredRun(row) : undefined;
  }

  getRunByUid(uid: string): StoredRun | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE run_uid = ?").get(uid) as RunRow | undefined;
    return row ? toStoredRun(row) : undefined;
  }

  listRuns(suite?: string, limit = 100): StoredRun[] {
    const rows = suite
      ? (this.db
          .prepare("SELECT * FROM runs WHERE suite = ? ORDER BY id DESC LIMIT ?")
          .all(suite, limit) as RunRow[])
      : (this.db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit) as RunRow[]);
    return rows.map(toStoredRun);
  }

  getCaseResults(runId: number): StoredCaseResult[] {
    const rows = this.db
      .prepare("SELECT * FROM case_results WHERE run_id = ? ORDER BY id ASC")
      .all(runId) as CaseRow[];
    return rows.map(toStoredCaseResult);
  }

  getCaseResult(runId: number, caseId: string): StoredCaseResult | undefined {
    const row = this.db
      .prepare("SELECT * FROM case_results WHERE run_id = ? AND case_id = ?")
      .get(runId, caseId) as CaseRow | undefined;
    return row ? toStoredCaseResult(row) : undefined;
  }

  // Mark one run as the baseline for its suite, clearing the flag from any prior
  // baseline so a suite has exactly one. Done in a transaction so there is never
  // a moment with zero or two baselines.
  markBaseline(runId: number): void {
    const run = this.getRun(runId);
    if (!run) throw new Error(`No run with id ${runId} to mark as baseline.`);
    const tx = this.db.transaction((suite: string, id: number) => {
      this.db.prepare("UPDATE runs SET is_baseline = 0 WHERE suite = ?").run(suite);
      this.db.prepare("UPDATE runs SET is_baseline = 1 WHERE id = ?").run(id);
    });
    tx(run.suite, runId);
  }

  getBaseline(suite: string): StoredRun | undefined {
    const row = this.db
      .prepare("SELECT * FROM runs WHERE suite = ? AND is_baseline = 1 ORDER BY id DESC LIMIT 1")
      .get(suite) as RunRow | undefined;
    return row ? toStoredRun(row) : undefined;
  }

  // Oldest-to-newest series for the trend charts.
  trends(suite: string, limit = 50): TrendPoint[] {
    const rows = this.db
      .prepare(
        "SELECT id, run_uid, created_at, cases_passed, cases_total, total_cost_usd, total_latency_ms, avg_judge_score FROM runs WHERE suite = ? ORDER BY id DESC LIMIT ?",
      )
      .all(suite, limit) as RunRow[];
    return rows
      .map((r) => ({
        runId: r.id,
        runUid: r.run_uid,
        createdAt: r.created_at,
        casesPassed: r.cases_passed,
        casesTotal: r.cases_total,
        totalCostUsd: r.total_cost_usd,
        totalLatencyMs: r.total_latency_ms,
        avgJudgeScore: r.avg_judge_score,
      }))
      .reverse();
  }

  close(): void {
    this.db.close();
  }
}
