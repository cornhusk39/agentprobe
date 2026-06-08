import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "../../../lib/db";
import { TraceView } from "../../../components/TraceView";
import { BaselineButton } from "../../../components/BaselineButton";
import type { CaseClassification, SeedCase } from "../../../lib/types";

// Server-rendered per request against the live database.
export const dynamic = "force-dynamic";

function classPill(c: CaseClassification | undefined) {
  if (!c || c === "pass") return null;
  const cls = c === "improve" ? "pill warn" : "pill fail";
  return <span className={cls}>{c}</span>;
}

function CaseBlock({ c, classification }: { c: SeedCase; classification?: CaseClassification }) {
  const allPass = c.passed;
  return (
    <div className="case">
      <div className="head">
        <span className="title">
          {c.caseId} {classPill(classification)}
        </span>
        <span className={`pill ${allPass ? "pass" : "fail"}`}>{allPass ? "pass" : "fail"}</span>
      </div>
      <div className="body">
        <div className="kv">
          <span>
            assertions <b>{c.assertionsPassed}/{c.assertionsTotal}</b>
          </span>
          {c.judge ? (
            <span>
              judge <b>{c.judge.score.toFixed(2)}</b> {c.judge.pass ? "" : "(below threshold)"}
            </span>
          ) : null}
          <span>
            latency <b>{c.metrics.latencyMs}ms</b>
          </span>
          <span>
            cost <b>${c.metrics.costUsd.toFixed(4)}</b>
          </span>
          <span>
            steps <b>{c.metrics.steps}</b>
          </span>
        </div>

        {c.error ? <div className="banner fail">transport error: {c.error}</div> : null}

        <ul className="assertions">
          {c.assertions.map((a, i) => (
            <li key={i}>
              <span className="mark" style={{ color: a.pass ? "var(--pass)" : "var(--fail)" }}>
                {a.pass ? "✓" : "✗"}
              </span>
              <span>
                <b>{a.kind}</b> {a.label}: {a.message}
              </span>
            </li>
          ))}
        </ul>

        {c.judge ? (
          <div className="judge">
            <b>Judge ({c.judge.model}):</b> {c.judge.rationale}
          </div>
        ) : null}

        <TraceView trace={c.trace} />
      </div>
    </div>
  );
}

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(Number(id));
  if (!run) notFound();

  const regressed = run.regression?.regressed;

  return (
    <>
      <p className="back">
        <Link href="/">&larr; all runs</Link>
      </p>
      <div className="toolbar">
        <h2 style={{ marginTop: 8 }}>
          Run #{run.id} &middot; {run.runUid}
        </h2>
        {run.isBaseline ? (
          <span className="pill muted">current baseline</span>
        ) : (
          <BaselineButton runId={run.id} />
        )}
      </div>
      <div className="kv">
        <span>
          mode <b>{run.mode}</b>
        </span>
        <span>
          date <b>{run.createdAt.slice(0, 10)}</b>
        </span>
        <span>
          result <b>{run.casesPassed}/{run.casesTotal}</b> cases
        </span>
        {run.avgJudgeScore !== null ? (
          <span>
            avg judge <b>{run.avgJudgeScore.toFixed(2)}</b>
          </span>
        ) : null}
        {run.isBaseline ? <span className="pill muted">baseline</span> : null}
      </div>

      {regressed ? (
        <div className="banner fail">
          Regression against the baseline: {run.regression?.reasons.join("; ")}
        </div>
      ) : run.isBaseline ? null : (
        <div className="banner pass">No regressions against the baseline.</div>
      )}

      <h2>Cases</h2>
      {run.cases.map((c) => (
        <CaseBlock key={c.caseId} c={c} classification={run.regression?.caseClassifications[c.caseId]} />
      ))}
    </>
  );
}
