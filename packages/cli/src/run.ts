// The shared machinery behind the CLI commands. Kept apart from argument parsing
// so it can be unit tested directly: each function takes a loaded config and
// returns data, with no process.exit or console formatting mixed in.

import path from "node:path";
import { promises as fs } from "node:fs";
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
  type Judge,
  type RunReport,
  type RegressionReport,
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
    await record({ agent: liveAgent(c), caseId: c.id, input: c.input, dir: config.cassetteDir, ctx: { now } });
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
      store.markBaseline(runId);
      store.close();
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
