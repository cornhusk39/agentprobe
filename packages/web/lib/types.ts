// The shape of a seeded run as the dashboard consumes it. It is a run report
// (the same structure core produces) plus what persistence and the diff add: a
// numeric id, the baseline flag, and a precomputed regression verdict against
// the baseline. Everything here is imported as types only, so none of the
// engine's runtime (and none of its native dependencies) reaches the web bundle.
// The dashboard reads JSON, never SQLite, and never imports an engine value.

import type { RunReport } from "@agentprobe/core";

export type SeedCase = RunReport["cases"][number];

export type CaseClassification = "pass" | "regress" | "improve" | "new" | "removed";

export interface RunRegression {
  regressed: boolean;
  reasons: string[];
  // Per-case verdict against the baseline, for highlighting in the run detail.
  caseClassifications: Record<string, CaseClassification>;
}

export type SeedRun = RunReport & {
  id: number;
  isBaseline: boolean;
  // Absent on the baseline run itself; present on every run compared to it.
  regression?: RunRegression;
};

export interface SeedFile {
  suite: string;
  runs: SeedRun[];
}
