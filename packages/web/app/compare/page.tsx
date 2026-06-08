import Link from "next/link";
import { runRefs, compareRuns } from "../../lib/db";
import type { CaseClassification } from "../../lib/types";

export const dynamic = "force-dynamic";

function classPill(c: CaseClassification) {
  const cls =
    c === "regress" ? "pill fail" : c === "improve" ? "pill warn" : c === "pass" ? "pill pass" : "pill muted";
  return <span className={cls}>{c}</span>;
}

// A signed delta with directional color: for cost and latency an increase is
// bad (red); for the judge score an increase is good (green). Near-zero is muted.
function Delta({ value, fmt, higherIsBetter }: { value: number | null; fmt: (n: number) => string; higherIsBetter: boolean }) {
  if (value === null) return <span className="meta">-</span>;
  const eps = 1e-9;
  const good = higherIsBetter ? value > eps : value < -eps;
  const bad = higherIsBetter ? value < -eps : value > eps;
  const color = good ? "var(--pass)" : bad ? "var(--fail)" : "var(--muted)";
  const sign = value > eps ? "+" : "";
  return <span style={{ color, fontVariantNumeric: "tabular-nums" }}>{sign}{fmt(value)}</span>;
}

function RunPicker({ refs, base, candidate }: { refs: ReturnType<typeof runRefs>; base: number; candidate: number }) {
  const opt = (r: (typeof refs)[number]) =>
    `#${r.id} · ${r.createdAt.slice(0, 10)} · ${r.casesPassed}/${r.casesTotal}${r.isBaseline ? " · baseline" : ""}`;
  return (
    <form method="get" className="run-controls" style={{ flexWrap: "wrap" }}>
      <label className="meta">
        Baseline{" "}
        <select name="base" defaultValue={base} className="select">
          {refs.map((r) => (
            <option key={r.id} value={r.id}>
              {opt(r)}
            </option>
          ))}
        </select>
      </label>
      <label className="meta">
        Candidate{" "}
        <select name="candidate" defaultValue={candidate} className="select">
          {refs.map((r) => (
            <option key={r.id} value={r.id}>
              {opt(r)}
            </option>
          ))}
        </select>
      </label>
      <button className="btn small" type="submit">
        Compare
      </button>
    </form>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ base?: string; candidate?: string }>;
}) {
  const sp = await searchParams;
  const refs = runRefs();
  if (refs.length === 0) {
    return <p className="meta">No runs yet.</p>;
  }
  const baseline = refs.find((r) => r.isBaseline) ?? refs[refs.length - 1]!;
  const latest = refs[0]!;
  const base = sp.base ? Number(sp.base) : baseline.id;
  const candidate = sp.candidate ? Number(sp.candidate) : latest.id;

  const diff = compareRuns(base, candidate);

  return (
    <>
      <p className="back">
        <Link href="/">&larr; dashboard</Link>
      </p>
      <h2 style={{ marginTop: 8 }}>Compare runs</h2>
      <RunPicker refs={refs} base={base} candidate={candidate} />

      {!diff ? (
        <p className="meta">Pick two runs to compare.</p>
      ) : (
        <>
          <div className={`banner ${diff.regressed ? "fail" : "pass"}`}>
            {diff.regressed ? `Regression: ${diff.reasons.join("; ")}` : "No regressions: candidate holds up against the baseline."}
            {"  "}
            <span className="meta">
              ({diff.summary.regressedCases} regressed, {diff.summary.improvedCases} improved,{" "}
              {diff.summary.newCases} new, {diff.summary.removedCases} removed)
            </span>
          </div>

          <div className="panel" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Change</th>
                  <th>Pass</th>
                  <th>Judge Δ</th>
                  <th>Cost Δ</th>
                  <th>Latency Δ</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {diff.cases.map((c) => (
                  <tr key={c.caseId}>
                    <td>
                      <Link href={`/runs/${candidate}`}>{c.caseId}</Link>
                    </td>
                    <td>{classPill(c.classification)}</td>
                    <td className="meta">
                      {c.baseline ? (c.baseline.passed ? "pass" : "fail") : "-"} &rarr;{" "}
                      {c.candidate ? (c.candidate.passed ? "pass" : "fail") : "-"}
                    </td>
                    <td>
                      <Delta value={c.deltas.judgeScore} fmt={(n) => n.toFixed(2)} higherIsBetter />
                    </td>
                    <td>
                      <Delta value={c.deltas.costUsd} fmt={(n) => `$${n.toFixed(4)}`} higherIsBetter={false} />
                    </td>
                    <td>
                      <Delta value={c.deltas.latencyMs} fmt={(n) => `${Math.round(n)}ms`} higherIsBetter={false} />
                    </td>
                    <td className="meta">{c.reasons.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
