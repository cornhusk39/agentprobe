import Link from "next/link";
import { listRuns, getBaseline, trendSeries } from "../lib/db";
import { LineChart } from "../components/LineChart";
import { RunControls } from "../components/RunControls";

// Reads the live database per request so a run triggered from the browser shows
// up immediately.
export const dynamic = "force-dynamic";

function day(iso: string): string {
  return iso.slice(0, 10);
}

export default function HomePage() {
  const runs = listRuns();
  const baseline = getBaseline();
  const t = trendSeries();

  return (
    <>
      <RunControls />

      <h2>Trends</h2>
      <div className="grid-charts">
        <LineChart
          label="Pass rate"
          values={t.passRate}
          regressedIndices={t.regressedRunIndices}
          min={0}
          max={1}
          format={(v) => `${Math.round(v * 100)}%`}
          color="#3fb950"
        />
        <LineChart
          label="Avg judge score"
          values={t.judge}
          regressedIndices={t.regressedRunIndices}
          min={0}
          max={1}
          format={(v) => v.toFixed(2)}
        />
        <LineChart
          label="Total cost"
          values={t.cost}
          regressedIndices={t.regressedRunIndices}
          format={(v) => `$${v.toFixed(4)}`}
          color="#d29922"
        />
        <LineChart
          label="Total latency"
          values={t.latency}
          regressedIndices={t.regressedRunIndices}
          format={(v) => `${Math.round(v)}ms`}
          color="#a371f7"
        />
      </div>
      <p className="meta" style={{ marginTop: 10 }}>
        Red markers are runs that regressed against the baseline
        {baseline ? ` (run #${baseline.id})` : ""}. The dip is a bad deploy where the booking flow
        stopped calling its tool; the recovery is the fix.
      </p>

      <h2>Runs</h2>
      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Date</th>
              <th>Result</th>
              <th>Judge</th>
              <th>Cost</th>
              <th>Latency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const allPass = r.casesPassed === r.casesTotal;
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/runs/${r.id}`}>#{r.id}</Link>
                  </td>
                  <td className="meta">{day(r.createdAt)}</td>
                  <td>
                    <span className={`pill ${allPass ? "pass" : "fail"}`}>
                      {r.casesPassed}/{r.casesTotal}
                    </span>
                  </td>
                  <td>{r.avgJudgeScore !== null ? r.avgJudgeScore.toFixed(2) : "-"}</td>
                  <td>${r.totalCostUsd.toFixed(4)}</td>
                  <td>{Math.round(r.totalLatencyMs)}ms</td>
                  <td>
                    {r.isBaseline ? (
                      <span className="pill muted">baseline</span>
                    ) : r.regression?.regressed ? (
                      <span className="pill fail">regressed</span>
                    ) : (
                      <span className="pill pass">ok</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
