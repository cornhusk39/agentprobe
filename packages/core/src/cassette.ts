// A cassette is the recorded trace of one agent run, frozen to disk so it can be
// replayed deterministically forever after. It is the heart of the harness: the
// recorder writes them, the replay transport reads them, and the demo ships
// nothing but them. Because cassettes are committed and the repo is destined to
// be public, redaction is enforced at write time here, not left to callers.

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { agentRunResultSchema } from "./types.js";
import {
  redact,
  verifyRedaction,
  DEFAULT_RULES,
  type RedactionHit,
  type RedactionRule,
} from "./redaction.js";

export const CASSETTE_VERSION = 1 as const;

export const cassetteSchema = z.object({
  version: z.literal(CASSETTE_VERSION),
  // Ties the cassette back to the suite case it was recorded for.
  caseId: z.string(),
  // Which agent produced it, for attribution in the dashboard.
  agent: z.string(),
  // ISO timestamp. Injected from a clock so tests can record stable values.
  recordedAt: z.string(),
  input: z.unknown(),
  result: agentRunResultSchema,
  // A record of what redaction removed. Useful for auditing a cassette without
  // re-running redaction, and proof that the pass actually ran.
  redaction: z
    .object({
      hits: z.array(z.object({ rule: z.string(), path: z.string() })),
    })
    .optional(),
});
export type Cassette = z.infer<typeof cassetteSchema>;

export interface WriteCassetteInput {
  caseId: string;
  agent: string;
  recordedAt: string;
  input: unknown;
  result: unknown;
}

export class RedactionFailedError extends Error {
  constructor(public readonly residual: string[]) {
    super(
      `Refusing to write cassette: redaction check found residual secrets (${residual.join(
        ", ",
      )}). The run was not saved.`,
    );
    this.name = "RedactionFailedError";
  }
}

// Build a redacted, validated cassette in memory. Separated from disk I/O so it
// can be unit tested without a filesystem and reused by callers that persist
// elsewhere. Throws RedactionFailedError if the fail-closed check trips.
export function buildCassette(
  input: WriteCassetteInput,
  rules: RedactionRule[] = DEFAULT_RULES,
): { cassette: Cassette; hits: RedactionHit[] } {
  // Redact input and result together so a secret echoed from input into output
  // is caught in both places. Rules are injectable, but the fail-closed verify
  // below always runs against the fixed forbidden set, so a weakened rule set
  // cannot quietly let a known secret shape through.
  const redactedInput = redact(input.input, rules);
  const redactedResult = redact(input.result, rules);
  const hits = [...redactedInput.hits, ...redactedResult.hits];

  // The whole payload, post-redaction, must clear the fail-closed scan.
  const check = verifyRedaction({ input: redactedInput.value, result: redactedResult.value });
  if (!check.ok) {
    throw new RedactionFailedError(check.residual);
  }

  // Validate the result shape only after redaction, so a malformed agent
  // response is rejected here rather than silently persisted.
  const result = agentRunResultSchema.parse(redactedResult.value);

  const cassette: Cassette = {
    version: CASSETTE_VERSION,
    caseId: input.caseId,
    agent: input.agent,
    recordedAt: input.recordedAt,
    input: redactedInput.value,
    result,
    redaction: { hits },
  };
  return { cassette: cassetteSchema.parse(cassette), hits };
}

// Deterministic on-disk name for a case's cassette.
export function cassetteFileName(caseId: string): string {
  // caseId is author-controlled and used in a path, so constrain it to a safe
  // character set rather than trusting it.
  const safe = caseId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe}.json`;
}

export async function writeCassette(dir: string, input: WriteCassetteInput): Promise<Cassette> {
  const { cassette } = buildCassette(input);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, cassetteFileName(cassette.caseId));
  // Pretty-printed and newline-terminated so cassettes diff cleanly in review,
  // which matters when they are committed artifacts.
  await fs.writeFile(file, JSON.stringify(cassette, null, 2) + "\n", "utf8");
  return cassette;
}

export async function readCassette(file: string): Promise<Cassette> {
  const raw = await fs.readFile(file, "utf8");
  return cassetteSchema.parse(JSON.parse(raw));
}

export async function readCassetteDir(dir: string): Promise<Cassette[]> {
  const entries = await fs.readdir(dir);
  const files = entries.filter((e) => e.endsWith(".json"));
  return Promise.all(files.map((f) => readCassette(path.join(dir, f))));
}
