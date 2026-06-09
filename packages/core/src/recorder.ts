// The recorder turns a live agent run into a saved cassette. It is the only
// path that should call a live transport in anger. It runs the agent, then
// hands the raw result to the cassette builder, which redacts and fail-closed
// verifies before anything is written. If redaction trips, nothing is saved and
// the error propagates: a refused write is the correct, safe outcome.

import type { Agent } from "./agent.js";
import type { AgentRunResult, RunContext } from "./types.js";
import { liveContext } from "./types.js";
import { buildCassette, writeCassette, type Cassette } from "./cassette.js";
import { DEFAULT_RULES, type RedactionRule } from "./redaction.js";

export interface RecordOptions {
  agent: Agent;
  caseId: string;
  input: unknown;
  // Where to write the cassette. When omitted, the cassette is built and
  // redaction-checked but not persisted, which is useful for tests.
  dir?: string;
  ctx?: RunContext;
  // Redaction rules applied before the cassette is written. Defaults to the
  // built-in set; supply your own (usually the defaults plus org-specific
  // patterns) to catch secret shapes the defaults do not know about. The
  // fail-closed verify still runs against the fixed forbidden set regardless.
  rules?: RedactionRule[];
}

export interface RecordResult {
  cassette: Cassette;
  result: AgentRunResult;
}

function isoFrom(now: () => number): string {
  return new Date(now()).toISOString();
}

export async function record(options: RecordOptions): Promise<RecordResult> {
  const ctx = options.ctx ?? liveContext();
  const result = await options.agent.run(options.input, ctx);

  const payload = {
    caseId: options.caseId,
    agent: options.agent.name,
    recordedAt: isoFrom(ctx.now),
    input: options.input,
    result,
  };

  const rules = options.rules ?? DEFAULT_RULES;
  if (options.dir) {
    const cassette = await writeCassette(options.dir, payload, rules);
    return { cassette, result };
  }
  const { cassette } = buildCassette(payload, rules);
  return { cassette, result };
}
