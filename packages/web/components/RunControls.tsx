"use client";

// The "run the suite now" control. It calls the server action, shows a pending
// state while the engine works, and reports the one-line result. The refreshed
// run list (revalidated by the action) is the real feedback; this line is just
// immediate acknowledgement.

import { useActionState } from "react";
import { runSuiteAction, type ActionResult } from "../app/actions";

export function RunControls() {
  const [state, formAction, pending] = useActionState<ActionResult | null>(
    async () => runSuiteAction(),
    null,
  );
  return (
    <form action={formAction} className="run-controls">
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Running suite…" : "Run suite now"}
      </button>
      {state ? (
        <span className={`run-result ${state.ok ? "ok" : "bad"}`}>{state.message}</span>
      ) : (
        <span className="meta">Replays the cassettes and records a new run.</span>
      )}
    </form>
  );
}
