"use client";

// Sets a run as the suite's baseline. A tiny form posting the run id to the
// server action; the submit button shows a pending state via useFormStatus.

import { useFormStatus } from "react-dom";
import { setBaselineAction } from "../app/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn small" disabled={pending}>
      {pending ? "Setting…" : "Set as baseline"}
    </button>
  );
}

export function BaselineButton({ runId }: { runId: number }) {
  return (
    <form action={setBaselineAction}>
      <input type="hidden" name="runId" value={runId} />
      <Submit />
    </form>
  );
}
