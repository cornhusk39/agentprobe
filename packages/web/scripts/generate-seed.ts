// Generates the dashboard's seed from the reference agent's cassettes. It tells
// a story the trend charts can show: a healthy stretch, a bad deploy where the
// booking flow regresses, and a fix. Healthy runs replay the committed
// cassettes; the regressed runs swap in the broken agent. Everything is
// deterministic (fixed timestamps, fixed jitter), so the seed is reproducible
// and the demo needs no keys.

import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ReplayStore,
  JudgeCache,
  cachedJudge,
  runSuite,
  redact,
  snapshotFromReport,
  diffRuns,
  type Agent,
  type Case,
  type Judge,
  type RunReport,
} from "@agentprobe/core";
import { suite } from "../../../examples/reference-agent/src/suite.js";
import { regressedAgent } from "../../../examples/reference-agent/src/agent.js";
import { demoJudge } from "../../../examples/reference-agent/src/judge.js";
import type { CaseClassification, SeedFile, SeedRun } from "../lib/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(here, "../../../examples/reference-agent");

type Variant = "healthy" | "regressed";

interface RunSpec {
  dayOffset: number;
  variant: Variant;
  isBaseline?: boolean;
}

// Seven days: three healthy, a two-day regression, then a fix that holds.
const SPECS: RunSpec[] = [
  { dayOffset: 0, variant: "healthy", isBaseline: true },
  { dayOffset: 1, variant: "healthy" },
  { dayOffset: 2, variant: "healthy" },
  { dayOffset: 3, variant: "regressed" },
  { dayOffset: 4, variant: "regressed" },
  { dayOffset: 5, variant: "healthy" },
  { dayOffset: 6, variant: "healthy" },
];

// A small deterministic wobble so the cost and latency lines are not flat. Keyed
// to the day so the same seed regenerates identically.
function jitter(dayOffset: number): number {
  return 1 + ((dayOffset * 7) % 6) / 100;
}

function applyJitter(report: RunReport, factor: number): RunReport {
  const cases = report.cases.map((c) => ({
    ...c,
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
  const store = await ReplayStore.fromDir(path.join(exampleDir, "cassettes"));
  const healthyCache = await JudgeCache.load(path.join(exampleDir, "judge-cache.json"));

  // Healthy agent: replay the cassettes. Judge offline from the committed cache.
  const healthyAgentFor = (c: Case): Agent => store.agentFor(c.id);
  const healthyJudge = cachedJudge(demoJudge, healthyCache, { offline: false });

  // Regressed agent: the broken booking agent in process; everything else still
  // replays. A fresh cache lets the demo judge score the broken outputs live.
  const regressedJudge: Judge = cachedJudge(demoJudge, new JudgeCache(), { offline: false });
  const regressedAgentFor = (c: Case): Agent =>
    c.input && (c.input as { intent?: string }).intent === "book" ? regressedAgent : store.agentFor(c.id);

  const runs: SeedRun[] = [];
  let id = 1;
  for (const spec of SPECS) {
    const createdAtMs = Date.UTC(2026, 5, 1 + spec.dayOffset, 14, 0, 0);
    const now = () => createdAtMs;
    const report = await runSuite({
      suite,
      agentFor: spec.variant === "healthy" ? healthyAgentFor : regressedAgentFor,
      judge: spec.variant === "healthy" ? healthyJudge : regressedJudge,
      mode: "replay",
      now,
      runUid: `${suite.name}-day${spec.dayOffset}`,
    });
    const jittered = applyJitter(report, jitter(spec.dayOffset));
    // Redact every case's output and trace before they land in the committed
    // seed. Healthy runs replay already-redacted cassettes; this also covers the
    // regressed runs, whose traces come from the in-process agent. The data is
    // synthetic, but the demo should model the same posture everywhere.
    const redacted = {
      ...jittered,
      cases: jittered.cases.map((c) => ({
        ...c,
        output: redact(c.output).value,
        trace: redact(c.trace).value,
      })),
    };
    runs.push({ ...redacted, id: id++, isBaseline: Boolean(spec.isBaseline) });
  }

  // Precompute each run's regression verdict against the baseline, in Node,
  // where the engine runs. The dashboard then only reads the result and never
  // imports an engine value, keeping native dependencies out of the web bundle.
  const baseline = runs.find((r) => r.isBaseline) ?? runs[0]!;
  const baselineSnap = snapshotFromReport(baseline);
  for (const run of runs) {
    if (run.id === baseline.id) continue;
    const diff = diffRuns(baselineSnap, snapshotFromReport(run));
    const caseClassifications: Record<string, CaseClassification> = {};
    for (const c of diff.cases) caseClassifications[c.caseId] = c.classification;
    run.regression = { regressed: diff.regressed, reasons: diff.reasons, caseClassifications };
  }

  const seed: SeedFile = { suite: suite.name, runs };
  const outDir = path.join(here, "..", "seed");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "runs.json"), JSON.stringify(seed, null, 2) + "\n", "utf8");
  console.log(`wrote ${runs.length} seeded runs to seed/runs.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
