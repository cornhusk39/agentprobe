"use client";

// Edits a case as JSON. A validated textarea is deliberate: the assertion model
// is open (any serializable kind), so a structured form would constrain it more
// than it helps. The server action validates on save and reports any error
// here; on success it redirects back to the suite.

import { useActionState } from "react";
import { saveCaseAction, type SaveState } from "../app/actions";

export function CaseEditor({ initialJson }: { initialJson: string }) {
  const [state, action, pending] = useActionState<SaveState | null, FormData>(saveCaseAction, null);
  return (
    <form action={action}>
      <textarea
        name="caseJson"
        defaultValue={initialJson}
        className="editor"
        spellCheck={false}
        rows={26}
      />
      {state?.error ? (
        <div className="banner fail" style={{ whiteSpace: "pre-wrap" }}>
          {state.error}
        </div>
      ) : null}
      <div className="run-controls">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save case"}
        </button>
        <a className="back" href="/suite">
          Cancel
        </a>
      </div>
    </form>
  );
}
