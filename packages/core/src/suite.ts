// A suite is a typed set of cases. Cases are plain objects authored in a TS
// file and validated with Zod, so a malformed suite fails loudly at load rather
// than midway through a run. The shape stays close to JSON so a suite can be
// exported for portability; the one exception is the output-schema assertion,
// which holds a live Zod schema and is therefore TS-only.

import { promises as fs } from "node:fs";
import { z } from "zod";
import { assertionSchema } from "./assertions.js";

// The rubric drives the LLM judge (wired in M4). It lives here so the suite is
// the single schema authority for what a case declares; the judge imports this
// type rather than defining its own.
export const rubricSchema = z.object({
  // Plain-language description of what good looks like for this case. The judge
  // scores the agent's output against this, and only this.
  criteria: z.string(),
  // The minimum judge score (0..1) for the case to count as a pass.
  passThreshold: z.number().min(0).max(1).default(0.7),
  // Optional per-rubric model override; falls back to the configured default.
  model: z.string().optional(),
});
export type Rubric = z.infer<typeof rubricSchema>;

export const caseSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  input: z.unknown(),
  assertions: z.array(assertionSchema).default([]),
  rubric: rubricSchema.optional(),
});
export type Case = z.infer<typeof caseSchema>;

export const suiteSchema = z.object({
  name: z.string().min(1),
  // A suite may be transiently empty while it is being authored in the
  // dashboard (delete every case, then add). Running an empty suite is a no-op,
  // and the run paths guard against it, so the schema does not force min(1).
  cases: z.array(caseSchema),
});
export type Suite = z.infer<typeof suiteSchema>;

// Authoring helper. Validates eagerly and returns the parsed suite, so a typo in
// an assertion kind or a missing case id is caught the moment the file loads.
// Duplicate case ids are rejected here too, since they would collide as cassette
// filenames and database keys downstream.
export function defineSuite(suite: Suite): Suite {
  const parsed = suiteSchema.parse(suite);
  const ids = new Set<string>();
  // Cassette filenames sanitize the case id to a safe character set, so two ids
  // that differ only in sanitized-away characters (for example "a/b" and "a_b")
  // would collide on disk and silently overwrite each other. Reject both the raw
  // duplicate and the post-sanitization collision here, where every id is known.
  const fileNames = new Map<string, string>();
  for (const c of parsed.cases) {
    if (ids.has(c.id)) {
      throw new Error(`Duplicate case id "${c.id}" in suite "${parsed.name}".`);
    }
    ids.add(c.id);
    const safe = c.id.replace(/[^a-zA-Z0-9._-]/g, "_");
    const clash = fileNames.get(safe);
    if (clash) {
      throw new Error(
        `Case ids "${clash}" and "${c.id}" map to the same cassette filename in suite "${parsed.name}". Rename one.`,
      );
    }
    fileNames.set(safe, c.id);
  }
  return parsed;
}

// Load a suite from a committed JSON file and validate it. This is the single
// source of truth: the CLI and CI read the suite from here, and the dashboard
// edits the same file, so there is no second copy to drift. defineSuite is
// reused so the same duplicate-id and filename-collision checks apply.
export async function loadSuiteFile(file: string): Promise<Suite> {
  const raw = await fs.readFile(file, "utf8");
  return defineSuite(JSON.parse(raw));
}

// Write a suite back to its JSON file, validating first so a malformed suite is
// never persisted. Pretty-printed and newline-terminated so it diffs cleanly in
// review, which matters because it is a committed artifact.
export async function saveSuiteFile(file: string, suite: Suite): Promise<void> {
  const parsed = defineSuite(suite);
  await fs.writeFile(file, JSON.stringify(parsed, null, 2) + "\n", "utf8");
}
