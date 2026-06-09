import Link from "next/link";
import { SuiteImportForm } from "../../../components/SuiteImportForm";

export const dynamic = "force-dynamic";

export default function ImportSuitePage() {
  return (
    <>
      <p className="back">
        <Link href="/suite">&larr; suite</Link>
      </p>
      <h2 style={{ marginTop: 8 }}>Import suite</h2>
      <p className="meta">
        Paste a suite JSON (as produced by Export). Each case is upserted by id, overwriting a
        matching case and adding new ones; cases not in the import are left in place. An invalid
        case is rejected before anything is saved.
      </p>
      <SuiteImportForm />
    </>
  );
}
