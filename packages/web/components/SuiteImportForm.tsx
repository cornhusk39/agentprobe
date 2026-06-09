"use client";

// Imports a suite pasted as JSON. Validates on the server and reports any error
// here; on success it redirects to the suite page.

import { useActionState } from "react";
import { importSuiteAction, type SaveState } from "../app/actions";

export function SuiteImportForm() {
  const [state, action, pending] = useActionState<SaveState | null, FormData>(importSuiteAction, null);
  return (
    <form action={action}>
      <textarea
        name="suiteJson"
        className="editor"
        spellCheck={false}
        rows={20}
        placeholder='{ "name": "...", "cases": [ ... ] }'
      />
      {state?.error ? (
        <div className="banner fail" style={{ whiteSpace: "pre-wrap" }}>
          {state.error}
        </div>
      ) : null}
      <div className="run-controls">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import suite"}
        </button>
        <a className="back" href="/suite">
          Cancel
        </a>
      </div>
    </form>
  );
}
