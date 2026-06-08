// A suite is a typed set of cases. Cases are plain objects authored in a TS
// file and validated with Zod, so a malformed suite fails loudly at load rather
// than midway through a run. The shape stays close to JSON so a suite can be
// exported for portability; the one exception is the output-schema assertion,
// which holds a live Zod schema and is therefore TS-only.

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
  cases: z.array(caseSchema).min(1),
});
export type Suite = z.infer<typeof suiteSchema>;

// Authoring helper. Validates eagerly and returns the parsed suite, so a typo in
// an assertion kind or a missing case id is caught the moment the file loads.
// Duplicate case ids are rejected here too, since they would collide as cassette
// filenames and database keys downstream.
export function defineSuite(suite: Suite): Suite {
  const parsed = suiteSchema.parse(suite);
  const ids = new Set<string>();
  for (const c of parsed.cases) {
    if (ids.has(c.id)) {
      throw new Error(`Duplicate case id "${c.id}" in suite "${parsed.name}".`);
    }
    ids.add(c.id);
  }
  return parsed;
}
