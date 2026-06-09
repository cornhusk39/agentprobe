// Server-only access to the authored suite. The dashboard edits the SAME
// committed suite JSON that the CLI and CI read, so there is no second copy to
// drift. Writes validate the whole suite (via the engine's defineSuite) before
// touching disk, so an invalid case is rejected and a malformed import can never
// leave a half-applied suite.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { defineSuite, type Case, type Suite } from "@agentprobe/core";
import { suiteFilePath } from "./paths";

function read(): Suite {
  const file = suiteFilePath();
  if (!existsSync(file)) return { name: "suite", cases: [] };
  return defineSuite(JSON.parse(readFileSync(file, "utf8")));
}

// Validate the whole suite, then write it. Validation-before-write is what makes
// every edit and import all-or-nothing.
function write(suite: Suite): void {
  const parsed = defineSuite(suite);
  writeFileSync(suiteFilePath(), JSON.stringify(parsed, null, 2) + "\n", "utf8");
}

export function activeSuite(): string {
  return read().name;
}

export function listCases(): Case[] {
  return read().cases;
}

export function getCase(caseId: string): Case | undefined {
  return read().cases.find((c) => c.id === caseId);
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

// Parse and persist a single case authored as JSON in the editor (upsert by id).
// Returns a friendly error instead of throwing so the form can show it.
export function saveCaseFromJson(json: string): SaveResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${(err as Error).message}` };
  }
  try {
    const suite = read();
    const incoming = parsed as Case;
    // Replace in place to preserve ordering; append only when it is a new case.
    const exists = suite.cases.some((c) => c.id === incoming.id);
    const cases = exists ? suite.cases.map((c) => (c.id === incoming.id ? incoming : c)) : [...suite.cases, incoming];
    write({ name: suite.name, cases });
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
  const suite = read();
  write({ name: suite.name, cases: suite.cases.filter((c) => c.id !== caseId) });
}

// Serialize the authored suite to portable JSON.
export function exportSuiteJson(): string {
  return JSON.stringify(read(), null, 2);
}

// Import a suite from JSON, upserting each case by id (overwriting a matching
// case, adding new ones, leaving others in place). The merged suite is validated
// before anything is written, so a malformed import leaves the existing suite
// untouched. The active suite name is preserved.
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
    const existing = read();
    const byId = new Map(existing.cases.map((c) => [c.id, c]));
    for (const c of cases as Case[]) byId.set(c.id, c);
    write({ name: existing.name, cases: [...byId.values()] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatValidationError(err) };
  }
}
