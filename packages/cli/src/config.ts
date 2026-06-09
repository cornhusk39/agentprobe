// The config contract a project provides to the CLI. A project's
// agentprobe.config.ts default-exports one of these. It declares the suite, the
// paths for cassettes, the judge cache, the baseline, and the database, and (for
// record mode) how to build a live agent and which judge to use.

import type { Agent, Case, Judge, RedactionRule, RegressionThresholds } from "@agentprobe/core";

export interface AgentProbeConfig {
  // Path to the committed suite JSON. This is the single source of truth: the
  // CLI and CI read it, and the dashboard edits the same file, so the two never
  // drift. Author it by hand, with `agentprobe init`, or in the dashboard.
  suiteFile: string;
  // Directory holding the recorded cassettes, one per case. Committed.
  cassetteDir: string;
  // Committed JSON of cached judge verdicts, so replay and CI need no API key.
  judgeCacheFile: string;
  // Committed baseline snapshot the CI gate diffs against.
  baselineFile: string;
  // Local SQLite database for run history and the dashboard. Not committed.
  dbPath: string;
  // Builds the live agent for a case in record mode. Omitted projects can only
  // replay (for example a demo that ships cassettes and never records).
  liveAgent?: (c: Case) => Agent;
  // The judge used while recording. Defaults to the Anthropic judge; a demo can
  // supply a deterministic judge so seeding needs no key.
  recordJudge?: Judge;
  // Optional per-project regression thresholds; falls back to the defaults.
  thresholds?: Partial<RegressionThresholds>;
  // Optional redaction rules applied at record time. Usually the built-in
  // DEFAULT_RULES spread with org-specific patterns (internal key formats,
  // employee ids). Only the record command uses these; replay never redacts.
  redactionRules?: RedactionRule[];
}

// Identity helper that exists purely for editor types and a stable import the
// config files can depend on.
export function defineConfig(config: AgentProbeConfig): AgentProbeConfig {
  return config;
}
