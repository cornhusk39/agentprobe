// The shared machinery behind the CLI commands. Kept apart from argument parsing
// so it can be unit tested directly: each function takes a loaded config and
// returns data, with no process.exit or console formatting mixed in.

import path from "node:path";
import { promises as fs, existsSync } from "node:fs";
import {
  ReplayStore,
  JudgeCache,
  cachedJudge,
  anthropicJudge,
  scriptedJudge,
  record,
  runSuite,
  persistRun,
  snapshotFromReport,
  writeBaseline,
  readBaseline,
  diffRuns,
  DEFAULT_THRESHOLDS,
  Store,
  flipCount,
  type Judge,
  type RunReport,
  type RegressionReport,
  type StoredRun,
} from "@agentprobe/core";
import type { AgentProbeConfig } from "./config.js";

function nowClock(): () => number {
  return () => Date.now();
}

// In offline scoring the cache must already hold every verdict, so the inner
// judge should never be called. If it is, that is a real error (a missing
// verdict), not something to paper over with a live call.
const offlineInner: Judge = scriptedJudge(() => {
  throw new Error("offline judge inner called; a verdict is missing from the cache");
});

// Record a fresh cassette per case from the live agent, then score the run with
// a live (or demo) judge, persisting both the judge cache and the run. This is
// the only command that may reach the network or the model.
export async function recordCommand(config: AgentProbeConfig): Promise<RunReport> {
  if (!config.liveAgent) {
    throw new Error("This config has no liveAgent, so it can only replay. Nothing to record.");
  }
  const liveAgent = config.liveAgent;

  await fs.mkdir(config.cassetteDir, { recursive: true });
  const now = nowClock();
  for (const c of config.suite.cases) {
    await record({
      agent: liveAgent(c),
      caseId: c.id,
      input: c.input,
      dir: config.cassetteDir,
      ctx: { now },
      rules: config.redactionRules,
    });
  }

  const store = await ReplayStore.fromDir(config.cassetteDir);
  const cache = await JudgeCache.load(config.judgeCacheFile);
  const judge = cachedJudge(config.recordJudge ?? anthropicJudge(), cache, { offline: false });

  const report = await runSuite({
    suite: config.suite,
    agentFor: (c) => store.agentFor(c.id),
    judge,
    mode: "record",
    now,
  });

  await cache.save(config.judgeCacheFile);
  await persistToDb(config, report);
  return report;
}

// Replay every cassette offline and score it. Deterministic, key-free. Used by
// the dashboard data path and as the basis for baseline and check.
export async function replayReport(config: AgentProbeConfig): Promise<RunReport> {
  const store = await ReplayStore.fromDir(config.cassetteDir);
  const cache = await JudgeCache.load(config.judgeCacheFile);
  const judge = cachedJudge(offlineInner, cache, { offline: true });
  return runSuite({
    suite: config.suite,
    agentFor: (c) => store.agentFor(c.id),
    judge,
    mode: "replay",
    now: nowClock(),
  });
}

export async function replayCommand(config: AgentProbeConfig): Promise<RunReport> {
  const report = await replayReport(config);
  await persistToDb(config, report);
  return report;
}

// Set the current replayed run as the suite's baseline: write the committed
// snapshot the gate diffs against and mark it in the database.
export async function baselineCommand(config: AgentProbeConfig): Promise<RunReport> {
  const report = await replayReport(config);
  await writeBaseline(config.baselineFile, snapshotFromReport(report));
  const runId = await persistToDb(config, report);
  if (runId !== null) {
    const store = openStore(config);
    if (store) {
      // Close even if markBaseline throws, so the SQLite handle and WAL lock are
      // never leaked.
      try {
        store.markBaseline(runId);
      } finally {
        store.close();
      }
    }
  }
  return report;
}

export interface CheckResult {
  report: RunReport;
  regression: RegressionReport;
}

// The CI gate. Replay, diff against the committed baseline, and report. The
// caller decides the exit code from regression.regressed.
export async function checkCommand(config: AgentProbeConfig): Promise<CheckResult> {
  if (!existsSync(config.baselineFile)) {
    throw new Error(
      `No baseline found at ${config.baselineFile}. Run 'agentprobe baseline' to set one first.`,
    );
  }
  const report = await replayReport(config);
  const baseline = await readBaseline(config.baselineFile);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
  const regression = diffRuns(baseline, snapshotFromReport(report), thresholds);
  return { report, regression };
}

function openStore(config: AgentProbeConfig): Store | null {
  if (!config.dbPath) return null;
  return new Store(config.dbPath);
}

async function persistToDb(config: AgentProbeConfig, report: RunReport): Promise<number | null> {
  if (!config.dbPath) return null;
  // Ensure the parent directory exists before sqlite tries to create the file.
  await fs.mkdir(path.dirname(config.dbPath), { recursive: true });
  const store = openStore(config);
  if (!store) return null;
  const id = persistRun(store, report);
  store.close();
  return id;
}

const CONFIG_TEMPLATE = `import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@agentprobe/cli";
import { httpAgent, anthropicJudge } from "@agentprobe/core";
import { suite } from "./suite.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  suite,
  cassetteDir: path.join(here, "cassettes"),
  judgeCacheFile: path.join(here, "judge-cache.json"),
  baselineFile: path.join(here, "baseline.json"),
  dbPath: process.env.AGENTPROBE_DB_PATH ?? path.join(here, "data", "agentprobe.db"),
  // The live agent used by 'record'. Point it at your agent's HTTP endpoint. The
  // bearer token is read from env at call time, never committed.
  liveAgent: () =>
    httpAgent({
      name: "my-agent",
      url: process.env.MY_AGENT_URL ?? "http://localhost:8080/run",
      allowlist: ["localhost"],
      bearerEnvVar: "AGENT_BEARER_TOKEN",
      retries: 2,
    }),
  // The judge used while recording. Needs ANTHROPIC_API_KEY. Replace with a
  // deterministic judge if you want a fully offline demo.
  recordJudge: anthropicJudge(),
});
`;

const SUITE_TEMPLATE = `import { defineSuite } from "@agentprobe/core";

export const suite = defineSuite({
  name: "my-suite",
  cases: [
    {
      id: "example",
      description: "Describe what this case checks.",
      input: { question: "What are your hours?" },
      assertions: [
        // See the assertion catalog: tool-called, tool-not-called, tool-args,
        // tool-call-count, tool-call-order, output-field, output-schema,
        // latency-budget, cost-budget, step-budget.
        { kind: "latency-budget", maxMs: 5000 },
      ],
      rubric: { criteria: "Answers the question helpfully and accurately.", passThreshold: 0.7 },
    },
  ],
});
`;

// Scaffold a starter project: a config and a sample suite in the target
// directory. Refuses to overwrite an existing config so a real project is never
// clobbered. Returns the paths it created.
export async function initCommand(dir: string): Promise<string[]> {
  const configPath = path.join(dir, "agentprobe.config.ts");
  const suitePath = path.join(dir, "suite.ts");
  if (existsSync(configPath)) {
    throw new Error(`agentprobe.config.ts already exists in ${dir}. Refusing to overwrite.`);
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, CONFIG_TEMPLATE, "utf8");
  // Do not clobber a suite the user may already have.
  const created = [configPath];
  if (!existsSync(suitePath)) {
    await fs.writeFile(suitePath, SUITE_TEMPLATE, "utf8");
    created.push(suitePath);
  }
  return created;
}

// Read the stored run history for this suite, newest first. Lets the run log be
// inspected from the terminal, without the dashboard.
export function listRunsCommand(config: AgentProbeConfig, limit = 20): StoredRun[] {
  // No database file means nothing has been recorded yet; that is an empty
  // history, not an error. Avoids creating a stray database just to read it.
  if (!config.dbPath || !existsSync(config.dbPath)) return [];
  const store = openStore(config);
  if (!store) return [];
  try {
    return store.listRuns(config.suite.name, limit);
  } finally {
    store.close();
  }
}

export interface SuiteStats {
  suite: string;
  runs: number;
  // Pass rate of the most recent run, 0..1, or null when there are no runs.
  latestPassRate: number | null;
  // Mean of the runs' average judge scores, ignoring runs that were not judged.
  avgJudge: number | null;
  avgCostUsd: number;
  avgLatencyMs: number;
  // Cases whose pass/fail status changed at least once across the history.
  flakyCases: number;
  baselineRunUid: string | null;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Aggregate health stats for the suite, for an at-a-glance terminal or CI
// summary. Empty (zeroed) when nothing has been recorded.
export function statsCommand(config: AgentProbeConfig): SuiteStats {
  const empty: SuiteStats = {
    suite: config.suite.name,
    runs: 0,
    latestPassRate: null,
    avgJudge: null,
    avgCostUsd: 0,
    avgLatencyMs: 0,
    flakyCases: 0,
    baselineRunUid: null,
  };
  if (!config.dbPath || !existsSync(config.dbPath)) return empty;
  const store = openStore(config);
  if (!store) return empty;
  try {
    const suite = config.suite.name;
    const runs = store.listRuns(suite, 1000);
    if (runs.length === 0) return empty;

    const latest = runs[0]!;
    const judged = runs.filter((r) => r.avgJudgeScore !== null).map((r) => r.avgJudgeScore as number);
    let flaky = 0;
    for (const caseId of store.caseIds(suite)) {
      if (flipCount(store.caseHistory(suite, caseId).map((h) => h.passed)) > 0) flaky++;
    }
    return {
      suite,
      runs: runs.length,
      latestPassRate: latest.casesTotal ? latest.casesPassed / latest.casesTotal : null,
      avgJudge: judged.length ? mean(judged) : null,
      avgCostUsd: mean(runs.map((r) => r.totalCostUsd)),
      avgLatencyMs: mean(runs.map((r) => r.totalLatencyMs)),
      flakyCases: flaky,
      baselineRunUid: store.getBaseline(suite)?.runUid ?? null,
    };
  } finally {
    store.close();
  }
}
