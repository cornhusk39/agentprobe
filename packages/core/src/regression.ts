// Baseline and regression detection. This is the headline: given a saved
// baseline run and a candidate run, classify every metric and every case as a
// pass, a regression, or an improvement, and decide whether the build should
// fail. The comparison works on snapshots, a small committed projection of a
// run, so CI can diff against a baseline file without a database.

import { promises as fs } from "node:fs";
import { z } from "zod";
import type { RunReport } from "./runner.js";

// A snapshot is the minimal, serializable shape the diff needs. It is what gets
// committed as a baseline, so it deliberately excludes large blobs like full
// traces; those live in the database for the dashboard, not in the gate.
export interface CaseSnapshot {
  caseId: string;
  passed: boolean;
  judgeScore: number | null;
  costUsd: number;
  latencyMs: number;
  steps: number;
}

export interface RunSnapshot {
  suite: string;
  runUid: string;
  createdAt: string;
  cases: CaseSnapshot[];
  casesPassed: number;
  casesTotal: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  avgJudgeScore: number | null;
}

// Schema for safe reads of a committed baseline file, which is untrusted input
// from the engine's point of view (a human edited or an old version wrote it).
const caseSnapshotSchema = z.object({
  caseId: z.string(),
  passed: z.boolean(),
  judgeScore: z.number().nullable(),
  costUsd: z.number(),
  latencyMs: z.number(),
  steps: z.number(),
});

export const runSnapshotSchema = z.object({
  suite: z.string(),
  runUid: z.string(),
  createdAt: z.string(),
  cases: z.array(caseSnapshotSchema),
  casesPassed: z.number(),
  casesTotal: z.number(),
  totalCostUsd: z.number(),
  totalLatencyMs: z.number(),
  avgJudgeScore: z.number().nullable(),
});

export async function writeBaseline(file: string, snapshot: RunSnapshot): Promise<void> {
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

export async function readBaseline(file: string): Promise<RunSnapshot> {
  const raw = await fs.readFile(file, "utf8");
  return runSnapshotSchema.parse(JSON.parse(raw));
}

export function snapshotFromReport(report: RunReport): RunSnapshot {
  return {
    suite: report.suite,
    runUid: report.runUid,
    createdAt: report.createdAt,
    cases: report.cases.map((c) => ({
      caseId: c.caseId,
      passed: c.passed,
      judgeScore: c.judge?.score ?? null,
      costUsd: c.metrics.costUsd,
      latencyMs: c.metrics.latencyMs,
      steps: c.metrics.steps,
    })),
    casesPassed: report.casesPassed,
    casesTotal: report.casesTotal,
    totalCostUsd: report.totalCostUsd,
    totalLatencyMs: report.totalLatencyMs,
    avgJudgeScore: report.avgJudgeScore,
  };
}

// How much a metric may move before it counts as a regression. Defaults are
// deliberately a little generous so normal noise does not turn CI red, while a
// real degradation still trips. Override per project at the call site.
export interface RegressionThresholds {
  // Absolute drop in judge score (0..1) that counts as a regression.
  judgeScoreDropAbs: number;
  // Relative increase in cost that counts as a regression, e.g. 0.25 = 25%.
  costIncreasePct: number;
  // Relative increase in latency that counts as a regression.
  latencyIncreasePct: number;
}

export const DEFAULT_THRESHOLDS: RegressionThresholds = {
  judgeScoreDropAbs: 0.05,
  costIncreasePct: 0.25,
  latencyIncreasePct: 0.3,
};

export type CaseClassification = "pass" | "regress" | "improve" | "new" | "removed";

export interface CaseDiff {
  caseId: string;
  classification: CaseClassification;
  reasons: string[];
  deltas: {
    judgeScore: number | null;
    costUsd: number;
    latencyMs: number;
    steps: number;
  };
  baseline?: CaseSnapshot;
  candidate?: CaseSnapshot;
}

export interface RegressionReport {
  suite: string;
  baselineRunUid: string;
  candidateRunUid: string;
  cases: CaseDiff[];
  // The build-fail decision and the human-readable reasons behind it.
  regressed: boolean;
  reasons: string[];
  summary: {
    regressedCases: number;
    improvedCases: number;
    newCases: number;
    removedCases: number;
    newFailingCases: number;
  };
}

function pctIncrease(baseline: number, candidate: number): number {
  // A zero baseline cannot grow by a percentage; treat any positive candidate as
  // a full regression so a cost or latency that appears from nothing is caught.
  if (baseline <= 0) return candidate > 0 ? Infinity : 0;
  return (candidate - baseline) / baseline;
}

function diffCase(
  baseline: CaseSnapshot | undefined,
  candidate: CaseSnapshot | undefined,
  thresholds: RegressionThresholds,
): CaseDiff {
  if (baseline && !candidate) {
    return {
      caseId: baseline.caseId,
      classification: "removed",
      reasons: ["case is missing from the candidate run"],
      deltas: { judgeScore: null, costUsd: 0, latencyMs: 0, steps: 0 },
      baseline,
    };
  }
  if (candidate && !baseline) {
    return {
      caseId: candidate.caseId,
      classification: "new",
      reasons: candidate.passed ? ["new case (passing)"] : ["new case (failing)"],
      deltas: {
        judgeScore: candidate.judgeScore,
        costUsd: candidate.costUsd,
        latencyMs: candidate.latencyMs,
        steps: candidate.steps,
      },
      candidate,
    };
  }
  // Both present.
  const b = baseline!;
  const c = candidate!;
  const reasons: string[] = [];
  const deltas = {
    judgeScore: c.judgeScore !== null && b.judgeScore !== null ? c.judgeScore - b.judgeScore : null,
    costUsd: c.costUsd - b.costUsd,
    latencyMs: c.latencyMs - b.latencyMs,
    steps: c.steps - b.steps,
  };

  let classification: CaseClassification = "pass";

  // A pass-to-fail flip is the clearest regression and outranks metric noise.
  if (b.passed && !c.passed) {
    classification = "regress";
    reasons.push("case went from pass to fail");
  } else if (!b.passed && c.passed) {
    classification = "improve";
    reasons.push("case went from fail to pass");
  } else {
    // Same pass/fail status: weigh the metrics.
    const regressions: string[] = [];
    const improvements: string[] = [];

    if (deltas.judgeScore !== null) {
      if (-deltas.judgeScore > thresholds.judgeScoreDropAbs) {
        regressions.push(`judge score dropped ${(-deltas.judgeScore).toFixed(2)}`);
      } else if (deltas.judgeScore > thresholds.judgeScoreDropAbs) {
        improvements.push(`judge score rose ${deltas.judgeScore.toFixed(2)}`);
      }
    }
    if (pctIncrease(b.costUsd, c.costUsd) > thresholds.costIncreasePct) {
      regressions.push(`cost up ${(pctIncrease(b.costUsd, c.costUsd) * 100).toFixed(0)}%`);
    } else if (c.costUsd < b.costUsd) {
      improvements.push("cost down");
    }
    if (pctIncrease(b.latencyMs, c.latencyMs) > thresholds.latencyIncreasePct) {
      regressions.push(`latency up ${(pctIncrease(b.latencyMs, c.latencyMs) * 100).toFixed(0)}%`);
    } else if (c.latencyMs < b.latencyMs) {
      improvements.push("latency down");
    }

    if (regressions.length > 0) {
      classification = "regress";
      reasons.push(...regressions);
    } else if (improvements.length > 0) {
      classification = "improve";
      reasons.push(...improvements);
    }
  }

  return { caseId: c.caseId, classification, reasons, deltas, baseline: b, candidate: c };
}

export function diffRuns(
  baseline: RunSnapshot,
  candidate: RunSnapshot,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): RegressionReport {
  const ids = new Set<string>([...baseline.cases.map((c) => c.caseId), ...candidate.cases.map((c) => c.caseId)]);
  const byBaseline = new Map(baseline.cases.map((c) => [c.caseId, c]));
  const byCandidate = new Map(candidate.cases.map((c) => [c.caseId, c]));

  const cases: CaseDiff[] = [...ids]
    .sort()
    .map((id) => diffCase(byBaseline.get(id), byCandidate.get(id), thresholds));

  const regressedCases = cases.filter((c) => c.classification === "regress").length;
  const improvedCases = cases.filter((c) => c.classification === "improve").length;
  const newCases = cases.filter((c) => c.classification === "new").length;
  const removedCases = cases.filter((c) => c.classification === "removed").length;
  const newFailingCases = cases.filter(
    (c) => c.classification === "new" && c.candidate?.passed === false,
  ).length;

  const reasons: string[] = [];
  if (regressedCases > 0) reasons.push(`${regressedCases} case(s) regressed`);
  if (newFailingCases > 0) reasons.push(`${newFailingCases} new case(s) are failing`);
  if (removedCases > 0) reasons.push(`${removedCases} baseline case(s) are missing from the candidate`);

  // The build fails on a real regression, a new failing case, or a dropped
  // case. New passing cases and improvements never fail the build.
  const regressed = regressedCases > 0 || newFailingCases > 0 || removedCases > 0;

  return {
    suite: candidate.suite,
    baselineRunUid: baseline.runUid,
    candidateRunUid: candidate.runUid,
    cases,
    regressed,
    reasons,
    summary: { regressedCases, improvedCases, newCases, removedCases, newFailingCases },
  };
}

// Render a regression report as Markdown, for a CI step summary or a PR comment.
// Pure and deterministic so it can be tested and so the CLI can drop it into
// $GITHUB_STEP_SUMMARY unchanged. Only non-passing cases are tabled, since a
// wall of green rows buries the signal; a clean report says so in one line.
export function regressionMarkdown(report: RegressionReport): string {
  const fmtSigned = (n: number, unit: string, digits: number): string => {
    const s = n > 0 ? "+" : "";
    return `${s}${n.toFixed(digits)}${unit}`;
  };

  const lines: string[] = [];
  lines.push(`## AgentProbe regression check`);
  lines.push("");
  lines.push(
    `Suite \`${report.suite}\` — baseline \`${report.baselineRunUid}\` vs candidate \`${report.candidateRunUid}\`.`,
  );
  lines.push("");
  lines.push(
    report.regressed ? `❌ **FAIL** — ${report.reasons.join("; ")}` : `✅ **PASS** — no regressions against the baseline.`,
  );

  const s = report.summary;
  lines.push("");
  lines.push(
    `Regressed ${s.regressedCases} · Improved ${s.improvedCases} · New ${s.newCases} · Removed ${s.removedCases}`,
  );

  const notable = report.cases.filter((c) => c.classification !== "pass");
  if (notable.length > 0) {
    lines.push("");
    lines.push(`| Case | Change | Judge Δ | Cost Δ | Latency Δ | Why |`);
    lines.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const c of notable) {
      const judge = c.deltas.judgeScore === null ? "-" : fmtSigned(c.deltas.judgeScore, "", 2);
      const cost = fmtSigned(c.deltas.costUsd, "", 4);
      const latency = fmtSigned(Math.round(c.deltas.latencyMs), "ms", 0);
      lines.push(`| ${c.caseId} | ${c.classification} | ${judge} | ${cost} | ${latency} | ${c.reasons.join(", ")} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
