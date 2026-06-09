import { describe, it, expect } from "vitest";
import { diffRuns, regressionMarkdown, DEFAULT_THRESHOLDS, type RunSnapshot } from "./regression.js";

function snapshot(over: Partial<RunSnapshot> & { cases: RunSnapshot["cases"] }): RunSnapshot {
  const cases = over.cases;
  return {
    suite: "booking",
    runUid: over.runUid ?? "run",
    createdAt: "2026-06-08T10:00:00.000Z",
    cases,
    casesPassed: cases.filter((c) => c.passed).length,
    casesTotal: cases.length,
    totalCostUsd: cases.reduce((s, c) => s + c.costUsd, 0),
    totalLatencyMs: cases.reduce((s, c) => s + c.latencyMs, 0),
    avgJudgeScore: null,
  };
}

const baseline = snapshot({
  runUid: "baseline",
  cases: [
    { caseId: "happy", passed: true, judgeScore: 0.9, costUsd: 0.01, latencyMs: 700, steps: 3 },
    { caseId: "edge", passed: true, judgeScore: 0.8, costUsd: 0.012, latencyMs: 800, steps: 4 },
  ],
});

describe("diffRuns", () => {
  it("passes when the candidate matches the baseline", () => {
    const report = diffRuns(baseline, { ...baseline, runUid: "candidate" });
    expect(report.regressed).toBe(false);
    expect(report.cases.every((c) => c.classification === "pass")).toBe(true);
  });

  it("fails the build when a case flips from pass to fail (the injected regression)", () => {
    // This mirrors what the CI Action sees: a prompt or model change broke a
    // case, so the case that used to pass now fails.
    const candidate = snapshot({
      runUid: "candidate",
      cases: [
        { caseId: "happy", passed: false, judgeScore: 0.4, costUsd: 0.01, latencyMs: 700, steps: 3 },
        { caseId: "edge", passed: true, judgeScore: 0.8, costUsd: 0.012, latencyMs: 800, steps: 4 },
      ],
    });
    const report = diffRuns(baseline, candidate);
    expect(report.regressed).toBe(true);
    expect(report.summary.regressedCases).toBe(1);
    const happy = report.cases.find((c) => c.caseId === "happy")!;
    expect(happy.classification).toBe("regress");
    expect(happy.reasons).toContain("case went from pass to fail");
  });

  it("passes again once the regression is reverted", () => {
    // Reverting restores the baseline behavior, so the gate goes green.
    const reverted = snapshot({ runUid: "reverted", cases: baseline.cases });
    expect(diffRuns(baseline, reverted).regressed).toBe(false);
  });

  it("flags a cost blowup past the threshold even when the case still passes", () => {
    const candidate = snapshot({
      runUid: "candidate",
      cases: [
        // Same pass status, but cost tripled: a silent blowup the gate must catch.
        { caseId: "happy", passed: true, judgeScore: 0.9, costUsd: 0.03, latencyMs: 700, steps: 3 },
        { caseId: "edge", passed: true, judgeScore: 0.8, costUsd: 0.012, latencyMs: 800, steps: 4 },
      ],
    });
    const report = diffRuns(baseline, candidate);
    expect(report.regressed).toBe(true);
    expect(report.cases.find((c) => c.caseId === "happy")!.reasons.some((r) => r.includes("cost up"))).toBe(true);
  });

  it("treats a new failing case as a build failure but a new passing case as fine", () => {
    const withNewFailing = snapshot({
      runUid: "candidate",
      cases: [
        ...baseline.cases,
        { caseId: "brand-new", passed: false, judgeScore: 0.3, costUsd: 0.01, latencyMs: 600, steps: 2 },
      ],
    });
    expect(diffRuns(baseline, withNewFailing).regressed).toBe(true);

    const withNewPassing = snapshot({
      runUid: "candidate",
      cases: [
        ...baseline.cases,
        { caseId: "brand-new", passed: true, judgeScore: 0.85, costUsd: 0.01, latencyMs: 600, steps: 2 },
      ],
    });
    expect(diffRuns(baseline, withNewPassing).regressed).toBe(false);
  });

  it("renders a markdown report with a FAIL header and a row per notable case", () => {
    const candidate = snapshot({
      runUid: "candidate",
      cases: [
        { caseId: "happy", passed: false, judgeScore: 0.4, costUsd: 0.01, latencyMs: 700, steps: 3 },
        { caseId: "edge", passed: true, judgeScore: 0.8, costUsd: 0.012, latencyMs: 800, steps: 4 },
      ],
    });
    const md = regressionMarkdown(diffRuns(baseline, candidate));
    expect(md).toContain("## AgentProbe regression check");
    expect(md).toContain("**FAIL**");
    expect(md).toContain("| happy | regress |");
    // the passing case is not tabled
    expect(md).not.toContain("| edge |");
  });

  it("renders a clean PASS report with no case table", () => {
    const md = regressionMarkdown(diffRuns(baseline, { ...baseline, runUid: "candidate" }));
    expect(md).toContain("**PASS**");
    expect(md).not.toContain("| Case |");
  });

  it("does not fail on improvements", () => {
    const improved = snapshot({
      runUid: "candidate",
      cases: [
        { caseId: "happy", passed: true, judgeScore: 0.95, costUsd: 0.008, latencyMs: 600, steps: 3 },
        { caseId: "edge", passed: true, judgeScore: 0.85, costUsd: 0.01, latencyMs: 700, steps: 4 },
      ],
    });
    const report = diffRuns(improved.cases.length ? baseline : baseline, improved, DEFAULT_THRESHOLDS);
    expect(report.regressed).toBe(false);
    expect(report.summary.improvedCases).toBeGreaterThan(0);
  });
});
