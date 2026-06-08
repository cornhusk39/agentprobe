// The recorder turns a live agent run into a saved cassette. It is the only
// path that should call a live transport in anger. It runs the agent, then
// hands the raw result to the cassette builder, which redacts and fail-closed
// verifies before anything is written. If redaction trips, nothing is saved and
// the error propagates: a refused write is the correct, safe outcome.

import type { Agent } from "./agent.js";
import type { AgentRunResult, RunContext } from "./types.js";
import { liveContext } from "./types.js";
import { buildCassette, writeCassette, type Cassette } from "./cassette.js";

export interface RecordOptions {
  agent: Agent;
  caseId: string;
  input: unknown;
  // Where to write the cassette. When omitted, the cassette is built and
  // redaction-checked but not persisted, which is useful for tests.
  dir?: string;
  ctx?: RunContext;
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

  if (options.dir) {
    const cassette = await writeCassette(options.dir, payload);
    return { cassette, result };
  }
  const { cassette } = buildCassette(payload);
  return { cassette, result };
}
