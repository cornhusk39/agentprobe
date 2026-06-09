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
  Store,
  SuiteStore,
  type Agent,
  type Case,
  type Judge,
  type RunReport,
} from "@agentprobe/core";
import { suite } from "../../../examples/reference-agent/src/suite.js";
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

  // Seed the authorable suite: a serializable mirror of the reference suite's
  // cases, using output-field checks in place of the code-only Zod schemas so
  // they can be edited in the dashboard.
  seedAuthorableSuite();
  console.log(`seeded ${ids.length} runs and the authorable suite into ${dbPath}`);
}

const AUTHORED_CASES: Case[] = [
  {
    id: "books-available-slot",
    description: "Books the first open slot on a day that has availability.",
    input: { intent: "book", day: "tuesday", service: "plumbing", customer: { name: "Pat Rivera", phone: "512-555-0142" } },
    assertions: [
      { kind: "tool-called", tool: "crm_upsert_customer" },
      { kind: "tool-called", tool: "create_booking" },
      { kind: "tool-call-order", tools: ["crm_upsert_customer", "check_availability", "create_booking"] },
      { kind: "tool-args", tool: "create_booking", args: { service: "plumbing" }, match: "subset" },
      { kind: "output-field", path: "status", op: "equals", value: "booked" },
      { kind: "output-field", path: "confirmationId", op: "exists" },
      { kind: "cost-budget", maxUsd: 0.02 },
      { kind: "step-budget", maxSteps: 6 },
    ],
    rubric: { criteria: "Completes the booking and returns a confirmation reference.", passThreshold: 0.7 },
  },
  {
    id: "declines-when-no-availability",
    description: "On a fully booked day, declines without booking and offers an alternative.",
    input: { intent: "book", day: "wednesday", service: "hvac", customer: { name: "Sam Lee", phone: "512-555-0199" } },
    assertions: [
      { kind: "tool-called", tool: "check_availability" },
      { kind: "tool-not-called", tool: "create_booking" },
      { kind: "output-field", path: "status", op: "equals", value: "unavailable" },
      { kind: "cost-budget", maxUsd: 0.02 },
    ],
    rubric: { criteria: "Declines gracefully without booking and suggests the next open day.", passThreshold: 0.7 },
  },
  {
    id: "lists-availability",
    description: "Answers an availability query with the open slots.",
    input: { intent: "availability", day: "tuesday" },
    assertions: [
      { kind: "tool-called", tool: "check_availability" },
      { kind: "output-field", path: "status", op: "equals", value: "info" },
      { kind: "output-field", path: "slots", op: "exists" },
      { kind: "latency-budget", maxMs: 600 },
    ],
    rubric: { criteria: "Lists the open slots for the requested day.", passThreshold: 0.7 },
  },
  {
    id: "reports-property-history",
    description: "Looks up a property and reports its type and last service date.",
    input: { intent: "property", address: "12 Oak St" },
    assertions: [
      { kind: "tool-called", tool: "lookup_property" },
      { kind: "output-field", path: "property.type", op: "exists" },
      { kind: "output-field", path: "property.lastService", op: "exists" },
      { kind: "cost-budget", maxUsd: 0.02 },
    ],
    rubric: { criteria: "Reports the property type and its last service date.", passThreshold: 0.7 },
  },
];

function seedAuthorableSuite(): void {
  const suiteStore = new SuiteStore(dbPath);
  suiteStore.upsertSuite(suite.name, new Date(Date.UTC(2026, 5, 1)).toISOString());
  AUTHORED_CASES.forEach((c, i) => suiteStore.upsertCase(suite.name, c, i));
  suiteStore.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
