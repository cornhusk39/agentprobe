// The replay transport re-runs a recorded cassette without touching the
// network. It is the default mode in CI: deterministic, offline, and free.
// Given a cassette, it returns exactly the recorded result, so scoring a replay
// is scoring the captured behavior, frozen in time. This is what makes a
// regression diff meaningful: the only thing that changed between two replay
// runs is the assertions, the judge, or the thresholds, never the agent's luck.

import type { Agent } from "../agent.js";
import type { AgentInput, AgentRunResult, RunContext } from "../types.js";
import { readCassetteDir, type Cassette } from "../cassette.js";

// Stable JSON used to compare a replayed input against the recorded one. Keys
// are sorted so ordering differences do not register as drift. Cycles are guarded
// against by tracking only the current ancestor chain, so a value that legitimately
// reuses the same sub-object in two sibling positions (a DAG, not a cycle) still
// serializes correctly rather than being nulled out.
function canonical(value: unknown): string {
  const norm = (v: unknown, ancestors: Set<object>): unknown => {
    if (v && typeof v === "object") {
      if (ancestors.has(v as object)) return null;
      const next = new Set(ancestors).add(v as object);
      if (Array.isArray(v)) return v.map((item) => norm(item, next));
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = norm((v as Record<string, unknown>)[key], next);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value, new Set()));
}

export class CassetteInputDriftError extends Error {
  constructor(public readonly caseId: string) {
    super(
      `Replay input for case "${caseId}" does not match the recorded input. ` +
        `The cassette is stale; re-record it or fix the case.`,
    );
    this.name = "CassetteInputDriftError";
  }
}

export interface ReplayOptions {
  // When true, the input passed at replay time must match the recorded input,
  // otherwise the cassette is treated as stale. Off by default so replay stays
  // robust to incidental input shape changes; the runner can opt in.
  strictInput?: boolean;
}

// An agent backed by a single cassette. It ignores the live clock and signal
// because there is no live work to time or cancel; it returns the recorded
// result verbatim.
export function replayAgent(cassette: Cassette, options: ReplayOptions = {}): Agent {
  return {
    name: cassette.agent,
    async run(input: AgentInput, _ctx: RunContext): Promise<AgentRunResult> {
      if (options.strictInput && canonical(input) !== canonical(cassette.input)) {
        throw new CassetteInputDriftError(cassette.caseId);
      }
      return cassette.result;
    },
  };
}

// A keyed collection of cassettes loaded from a directory, so a suite run can
// look up the right cassette per case id. This is the shape the runner consumes
// in replay mode.
export class ReplayStore {
  private readonly byCase = new Map<string, Cassette>();

  constructor(cassettes: Cassette[]) {
    for (const c of cassettes) {
      this.byCase.set(c.caseId, c);
    }
  }

  static async fromDir(dir: string): Promise<ReplayStore> {
    return new ReplayStore(await readCassetteDir(dir));
  }

  has(caseId: string): boolean {
    return this.byCase.has(caseId);
  }

  get(caseId: string): Cassette | undefined {
    return this.byCase.get(caseId);
  }

  // Build a replay agent for a specific case. Throws if no cassette exists,
  // because a missing cassette in replay mode is a setup error, not a pass.
  agentFor(caseId: string, options?: ReplayOptions): Agent {
    const cassette = this.byCase.get(caseId);
    if (!cassette) {
      throw new Error(`No cassette recorded for case "${caseId}". Record it before replaying.`);
    }
    return replayAgent(cassette, options);
  }

  caseIds(): string[] {
    return [...this.byCase.keys()];
  }
}
