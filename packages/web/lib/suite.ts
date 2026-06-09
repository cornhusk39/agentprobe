// Server-only access to the authored suite. The dashboard edits cases here and
// they persist to the same database the runs live in. Writes validate the case
// shape (via the engine's SuiteStore), so an invalid assertion is rejected
// before it is saved.

import { SuiteStore, type Case } from "@agentprobe/core";
import { dbPath, suiteName } from "./db";

let store: SuiteStore | null = null;
function ss(): SuiteStore {
  if (!store) store = new SuiteStore(dbPath());
  return store;
}

export function activeSuite(): string {
  return suiteName();
}

export function listCases(): Case[] {
  return ss().getCases(activeSuite());
}

export function getCase(caseId: string): Case | undefined {
  return ss().getCase(activeSuite(), caseId);
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

// Parse and persist a case authored as JSON in the editor. Returns a friendly
// error instead of throwing so the form can show it.
export function saveCaseFromJson(json: string): SaveResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${(err as Error).message}` };
  }
  try {
    const suite = activeSuite();
    ss().upsertSuite(suite, new Date().toISOString());
    ss().upsertCase(suite, parsed as Case);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatValidationError(err) };
  }
}

// Zod throws a structured error; turn its issues into readable lines rather than
// dumping the raw JSON at the author. Detected by shape so web need not depend
// on zod directly.
function formatValidationError(err: unknown): string {
  const issues = (err as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues;
  if (Array.isArray(issues)) {
    return issues
      .map((i) => {
        const where = i.path.length ? i.path.join(".") : "case";
        return `${where}: ${i.message}`;
      })
      .join("\n");
  }
  return (err as Error).message;
}

export function deleteCase(caseId: string): void {
  ss().deleteCase(activeSuite(), caseId);
}

// Serialize the authored suite to portable JSON: the suite name and its cases.
// This round-trips through importSuiteJson because authored cases use only the
// serializable assertion kinds.
export function exportSuiteJson(): string {
  return JSON.stringify({ name: activeSuite(), cases: listCases() }, null, 2);
}

// Import a suite from JSON, upserting each case (overwriting matching ids,
// adding new ones). Each case is validated on write, so a malformed import is
// rejected before anything is saved. Non-destructive: cases not in the import
// are left in place.
export function importSuiteJson(json: string): SaveResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${(err as Error).message}` };
  }
  const cases = (parsed as { cases?: unknown }).cases;
  if (!Array.isArray(cases)) {
    return { ok: false, error: 'Expected an object with a "cases" array.' };
  }
  try {
    const suite = activeSuite();
    ss().upsertSuite(suite, new Date().toISOString());
    // Atomic: every case is validated before any is written, so a malformed
    // import leaves the existing suite untouched.
    ss().upsertCases(suite, cases as Case[]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatValidationError(err) };
  }
}
