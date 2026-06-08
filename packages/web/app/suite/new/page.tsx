import Link from "next/link";
import { CaseEditor } from "../../../components/CaseEditor";

// A starting template that already validates, so a new case runs as soon as it
// is saved (this one replays against the lists-availability cassette path).
const TEMPLATE = JSON.stringify(
  {
    id: "new-case",
    description: "Describe what this case checks.",
    input: { intent: "availability", day: "thursday" },
    assertions: [
      { kind: "tool-called", tool: "check_availability" },
      { kind: "output-field", path: "status", op: "equals", value: "info" },
      { kind: "latency-budget", maxMs: 600 },
    ],
    rubric: { criteria: "Lists the open slots for the requested day.", passThreshold: 0.7 },
  },
  null,
  2,
);

export default function NewCasePage() {
  return (
    <>
      <p className="back">
        <Link href="/suite">&larr; suite</Link>
      </p>
      <h2 style={{ marginTop: 8 }}>New case</h2>
      <p className="meta">
        A new case needs a recorded cassette for its id to be replayable. The reference cassette ids
        are books-available-slot, declines-when-no-availability, lists-availability, and
        reports-property-history.
      </p>
      <CaseEditor initialJson={TEMPLATE} />
    </>
  );
}
