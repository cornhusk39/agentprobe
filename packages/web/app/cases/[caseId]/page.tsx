import Link from "next/link";
import { caseHistory } from "../../../lib/db";
import { LineChart } from "../../../components/LineChart";

export const dynamic = "force-dynamic";

export default async function CaseHistoryPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const id = decodeURIComponent(caseId);
  const history = caseHistory(id);

  return (
    <>
      <p className="back">
        <Link href="/">&larr; dashboard</Link>
      </p>
      <h2 style={{ marginTop: 8 }}>Case history: {id}</h2>

      {history.length === 0 ? (
        <p className="meta">No recorded runs include this case yet.</p>
      ) : (
        <>
          <div className="grid-charts">
            <LineChart
              label="Judge score"
              values={history.map((h) => h.judgeScore ?? 0)}
              regressedIndices={history.flatMap((h, i) => (h.passed ? [] : [i]))}
              min={0}
              max={1}
              format={(v) => v.toFixed(2)}
            />
            <LineChart
              label="Cost"
              values={history.map((h) => h.costUsd)}
              regressedIndices={history.flatMap((h, i) => (h.passed ? [] : [i]))}
              format={(v) => `$${v.toFixed(4)}`}
              color="#d29922"
            />
            <LineChart
              label="Latency"
              values={history.map((h) => h.latencyMs)}
              regressedIndices={history.flatMap((h, i) => (h.passed ? [] : [i]))}
              format={(v) => `${Math.round(v)}ms`}
              color="#a371f7"
            />
          </div>
          <p className="meta" style={{ marginTop: 10 }}>
            Red markers are runs where this case failed.
          </p>

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
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((h) => (
                  <tr key={h.runId}>
                    <td>
                      <Link href={`/runs/${h.runId}`}>#{h.runId}</Link>
                    </td>
                    <td className="meta">{h.createdAt.slice(0, 10)}</td>
                    <td>
                      <span className={`pill ${h.passed ? "pass" : "fail"}`}>{h.passed ? "pass" : "fail"}</span>
                    </td>
                    <td>{h.judgeScore !== null ? h.judgeScore.toFixed(2) : "-"}</td>
                    <td>${h.costUsd.toFixed(4)}</td>
                    <td>{Math.round(h.latencyMs)}ms</td>
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
