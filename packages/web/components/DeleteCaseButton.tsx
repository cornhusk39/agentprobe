"use client";

import { deleteCaseAction } from "../app/actions";

export function DeleteCaseButton({ caseId }: { caseId: string }) {
  return (
    <form action={deleteCaseAction}>
      <input type="hidden" name="caseId" value={caseId} />
      <button className="btn small danger" type="submit">
        Delete
      </button>
    </form>
  );
}
