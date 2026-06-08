// Server-only data access for the dashboard. It reads the committed seed JSON
// once and answers the queries the pages need. There is no database here and no
// engine value import: the seed already holds everything, including precomputed
// regression verdicts, so the web bundle stays free of native dependencies.

import fs from "node:fs";
import path from "node:path";
import type { SeedFile, SeedRun } from "./types";

let cache: SeedFile | null = null;

function load(): SeedFile {
  if (!cache) {
    const file = path.join(process.cwd(), "seed", "runs.json");
    cache = JSON.parse(fs.readFileSync(file, "utf8")) as SeedFile;
  }
  return cache;
}

export function suiteName(): string {
  return load().suite;
}

// Runs newest first, the order a list wants.
export function listRuns(): SeedRun[] {
  return [...load().runs].sort((a, b) => b.id - a.id);
}

// Runs oldest to newest, the order a trend wants.
export function runsChronological(): SeedRun[] {
  return [...load().runs].sort((a, b) => a.id - b.id);
}

export function getRun(id: number): SeedRun | undefined {
  return load().runs.find((r) => r.id === id);
}

export function getBaseline(): SeedRun | undefined {
  return load().runs.find((r) => r.isBaseline);
}

export interface TrendSeries {
  passRate: number[];
  judge: number[];
  cost: number[];
  latency: number[];
  regressedRunIndices: number[];
  runIds: number[];
}

// Build the parallel arrays the trend charts plot, in chronological order, with
// the indices of regressed runs called out so the charts can mark them.
export function trendSeries(): TrendSeries {
  const runs = runsChronological();
  return {
    passRate: runs.map((r) => (r.casesTotal ? r.casesPassed / r.casesTotal : 0)),
    judge: runs.map((r) => r.avgJudgeScore ?? 0),
    cost: runs.map((r) => r.totalCostUsd),
    latency: runs.map((r) => r.totalLatencyMs),
    regressedRunIndices: runs.flatMap((r, i) => (r.regression?.regressed ? [i] : [])),
    runIds: runs.map((r) => r.id),
  };
}
