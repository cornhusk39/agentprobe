// Seeds a real SQLite database with run history for the interactive dashboard.
// Same story the static seed told (a healthy stretch, a regression, a fix), but
// persisted through the engine's Store so the app reads live data, not a fixture.
// Deterministic timestamps keep it reproducible. Run with: pnpm seed:db

import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ReplayStore,
  JudgeCache,
  cachedJudge,
  runSuite,
  redact,
  persistRun,
  loadSuiteFile,
  Store,
  type Agent,
  type Case,
  type Judge,
  type RunReport,
} from "@agentprobe/core";
import { regressedAgent } from "../../../examples/reference-agent/src/agent.js";
import { demoJudge } from "../../../examples/reference-agent/src/judge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(here, "../../../examples/reference-agent");
const dbPath = process.env.AGENTPROBE_DB_PATH ?? path.join(here, "..", "data", "agentprobe.db");

type Variant = "healthy" | "regressed";
interface RunSpec {
  dayOffset: number;
  variant: Variant;
  isBaseline?: boolean;
}

const SPECS: RunSpec[] = [
  { dayOffset: 0, variant: "healthy", isBaseline: true },
  { dayOffset: 1, variant: "healthy" },
  { dayOffset: 2, variant: "healthy" },
  { dayOffset: 3, variant: "regressed" },
  { dayOffset: 4, variant: "regressed" },
  { dayOffset: 5, variant: "healthy" },
  { dayOffset: 6, variant: "healthy" },
];

function jitter(dayOffset: number): number {
  return 1 + ((dayOffset * 7) % 6) / 100;
}

function applyJitterAndRedact(report: RunReport, factor: number): RunReport {
  const cases = report.cases.map((c) => ({
    ...c,
    output: redact(c.output).value,
    trace: redact(c.trace).value,
    metrics: {
      ...c.metrics,
      latencyMs: Math.round(c.metrics.latencyMs * factor),
      costUsd: Number((c.metrics.costUsd * factor).toFixed(4)),
    },
  }));
  return {
    ...report,
    cases,
    totalLatencyMs: cases.reduce((s, c) => s + c.metrics.latencyMs, 0),
    totalCostUsd: Number(cases.reduce((s, c) => s + c.metrics.costUsd, 0).toFixed(4)),
  };
}

async function main(): Promise<void> {
  // Start from a clean database so reseeding is idempotent.
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.rm(dbPath, { force: true });
  await fs.rm(`${dbPath}-wal`, { force: true });
  await fs.rm(`${dbPath}-shm`, { force: true });

  // The suite is the committed file the CLI and dashboard both use; the seed
  // only fabricates run history against it.
  const suite = await loadSuiteFile(path.join(exampleDir, "suite.json"));
  const store = await ReplayStore.fromDir(path.join(exampleDir, "cassettes"));
  const healthyCache = await JudgeCache.load(path.join(exampleDir, "judge-cache.json"));
  const healthyAgentFor = (c: Case): Agent => store.agentFor(c.id);
  const healthyJudge = cachedJudge(demoJudge, healthyCache, { offline: false });
  const regressedJudge: Judge = cachedJudge(demoJudge, new JudgeCache(), { offline: false });
  const regressedAgentFor = (c: Case): Agent =>
    c.input && (c.input as { intent?: string }).intent === "book" ? regressedAgent : store.agentFor(c.id);

  const db = new Store(dbPath);
  const ids: Array<{ runId: number; baseline: boolean }> = [];
  for (const spec of SPECS) {
    const createdAtMs = Date.UTC(2026, 5, 1 + spec.dayOffset, 14, 0, 0);
    const report = await runSuite({
      suite,
      agentFor: spec.variant === "healthy" ? healthyAgentFor : regressedAgentFor,
      judge: spec.variant === "healthy" ? healthyJudge : regressedJudge,
      mode: "replay",
      now: () => createdAtMs,
      runUid: `${suite.name}-day${spec.dayOffset}`,
    });
    const runId = persistRun(db, applyJitterAndRedact(report, jitter(spec.dayOffset)));
    ids.push({ runId, baseline: Boolean(spec.isBaseline) });
  }
  const baseline = ids.find((i) => i.baseline);
  if (baseline) db.markBaseline(baseline.runId);
  db.close();
  console.log(`seeded ${ids.length} runs into ${dbPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
