// The shape of a run as the dashboard consumes it. It is a run report (the same
// structure core produces) plus what persistence and the diff add: a numeric id,
// the baseline flag, and a precomputed regression verdict against the baseline.
// This module imports types only. Runtime database access (better-sqlite3) is
// confined to the server-only modules under lib/ (db.ts, suite.ts, engine.ts),
// so the engine's native dependency never reaches a client component.

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
