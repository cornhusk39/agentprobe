"use server";

// Server actions that make the dashboard interactive. Running the suite goes
// through the engine in process (it materializes the authored suite from the
// database, replays the cassettes, and persists a run). Editing and deleting
// cases write through the suite store. Marking a baseline is a direct write.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markBaselineById } from "../lib/db";
import { runActiveSuite } from "../lib/engine";
import { saveCaseFromJson, deleteCase } from "../lib/suite";

export interface ActionResult {
  ok: boolean;
  message: string;
}

// Run the authored suite. Persists a new run that then appears in the dashboard
// with its regression verdict computed against the baseline.
export async function runSuiteAction(): Promise<ActionResult> {
  try {
    const { runId, passed, total } = await runActiveSuite();
    revalidatePath("/");
    revalidatePath("/suite");
    return { ok: passed === total, message: `run #${runId}: ${passed}/${total} cases passed` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function setBaselineAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("runId"));
  if (Number.isFinite(id)) {
    markBaselineById(id);
    revalidatePath("/");
    revalidatePath(`/runs/${id}`);
  }
}

export interface SaveState {
  error?: string;
}

// Save an edited or new case authored as JSON. On success it redirects back to
// the suite page; on a validation error it returns the message for the form.
export async function saveCaseAction(_prev: SaveState | null, formData: FormData): Promise<SaveState> {
  const json = String(formData.get("caseJson") ?? "");
  const result = saveCaseFromJson(json);
  if (!result.ok) return { error: result.error };
  revalidatePath("/suite");
  redirect("/suite");
}

export async function deleteCaseAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  if (caseId) {
    deleteCase(caseId);
    revalidatePath("/suite");
  }
}
