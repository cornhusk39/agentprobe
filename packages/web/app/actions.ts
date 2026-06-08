"use server";

// Server actions that make the dashboard interactive. Running the suite goes
// through the real CLI as a child process: it reuses the exact, tested
// orchestration and keeps the engine's work off the request thread, writing to
// the same database the dashboard reads (shared via AGENTPROBE_DB_PATH). Marking
// a baseline is a direct database write, since it needs no suite or cassettes.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { dbPath, markBaselineById } from "../lib/db";

const run = promisify(execFile);

// The repo root, two levels up from this package's working directory, so the
// pnpm filter resolves the reference agent.
function repoRoot(): string {
  return path.resolve(process.cwd(), "..", "..");
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

// Replay the reference suite. This persists a new run to the shared database,
// which then appears in the dashboard with its regression verdict computed
// against the baseline.
export async function runSuiteAction(): Promise<ActionResult> {
  const env = { ...process.env, AGENTPROBE_DB_PATH: dbPath() };
  try {
    const { stdout } = await run(
      "pnpm",
      ["--filter", "@agentprobe/example-reference-agent", "replay"],
      { cwd: repoRoot(), env, timeout: 60_000 },
    );
    revalidatePath("/");
    const summary = stdout.split("\n").filter((l) => l.includes("cases passed")).pop() ?? "run complete";
    return { ok: true, message: summary.trim() };
  } catch (err) {
    // A non-zero exit means cases failed, which is a valid outcome to show, not a
    // crash. Surface whatever the CLI printed.
    const e = err as { stdout?: string; message?: string };
    revalidatePath("/");
    const summary = (e.stdout ?? "").split("\n").filter((l) => l.includes("cases passed")).pop();
    return { ok: false, message: summary?.trim() ?? e.message ?? "run failed" };
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
