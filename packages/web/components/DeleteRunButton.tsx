"use client";

// Deletes a run from the run detail page. A small form posting the run id to the
// server action, which removes the run and redirects back to the run list.

import { useFormStatus } from "react-dom";
import { deleteRunAction } from "../app/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn small danger" disabled={pending}>
      {pending ? "Deleting…" : "Delete run"}
    </button>
  );
}

export function DeleteRunButton({ runId }: { runId: number }) {
  return (
    <form action={deleteRunAction}>
      <input type="hidden" name="runId" value={runId} />
      <Submit />
    </form>
  );
}
