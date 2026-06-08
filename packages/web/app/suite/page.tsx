import Link from "next/link";
import { listCases, activeSuite } from "../../lib/suite";
import { assertionSummary } from "../../lib/assertionSummary";
import { DeleteCaseButton } from "../../components/DeleteCaseButton";
import { RunControls } from "../../components/RunControls";

export const dynamic = "force-dynamic";

export default function SuitePage() {
  const cases = listCases();
  return (
    <>
      <p className="back">
        <Link href="/">&larr; dashboard</Link>
      </p>
      <div className="toolbar">
        <h2 style={{ marginTop: 8 }}>Suite: {activeSuite()}</h2>
        <Link className="btn small" href="/suite/new">
          + Add case
        </Link>
      </div>

      <RunControls />
      <p className="meta">
        Edit a case and run the suite to see the effect immediately. Runs replay the recorded
        cassettes, so changing an assertion changes pass or fail on the next run.
      </p>

      {cases.map((c) => (
        <div className="case" key={c.id}>
          <div className="head">
            <span className="title">{c.id}</span>
            <span className="actions-inline">
              <Link className="btn small ghost" href={`/suite/${encodeURIComponent(c.id)}`}>
                Edit
              </Link>
              <DeleteCaseButton caseId={c.id} />
            </span>
          </div>
          <div className="body">
            {c.description ? <div className="meta">{c.description}</div> : null}
            <div className="kv" style={{ marginTop: 8 }}>
              <span>
                assertions <b>{c.assertions.length}</b>
              </span>
              {c.rubric ? (
                <span>
                  rubric threshold <b>{c.rubric.passThreshold}</b>
                </span>
              ) : null}
            </div>
            <ul className="assertions">
              {c.assertions.map((a, i) => (
                <li key={i}>
                  <span className="mark">&bull;</span>
                  <span>
                    <b>{a.kind}</b> {assertionSummary(a)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </>
  );
}
