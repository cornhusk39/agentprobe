import Link from "next/link";
import { notFound } from "next/navigation";
import { getCase } from "../../../lib/suite";
import { CaseEditor } from "../../../components/CaseEditor";

export const dynamic = "force-dynamic";

export default async function EditCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const c = getCase(decodeURIComponent(caseId));
  if (!c) notFound();

  return (
    <>
      <p className="back">
        <Link href="/suite">&larr; suite</Link>
      </p>
      <h2 style={{ marginTop: 8 }}>Edit case: {c.id}</h2>
      <p className="meta">
        Assertions support: tool-called, tool-not-called, tool-args, tool-call-count, tool-call-order,
        output-field (exists / equals), latency-budget, cost-budget, step-budget. Save validates the
        shape before writing.
      </p>
      <CaseEditor initialJson={JSON.stringify(c, null, 2)} />
    </>
  );
}
