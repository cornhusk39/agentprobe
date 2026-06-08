// The single integration point. Everything in AgentProbe runs an `Agent`, and
// every transport (live HTTP, replay from a cassette, an in-memory test double)
// is just an implementation of this one interface. Keeping it this small is
// what lets the recorder wrap any agent and the replay transport stand in for
// any agent without the rest of the system knowing the difference.

import type { AgentInput, AgentRunResult, RunContext } from "./types.js";

export interface Agent {
  // A stable identifier for the agent under test. Recorded into cassettes and
  // shown in the dashboard so runs can be attributed.
  readonly name: string;
  // Run the agent against one case input and return the full result: final
  // output, the trace of steps, and the metrics. Implementations must not throw
  // for a normal agent-level failure; they encode that in the trace or output.
  // They may throw for transport failures (network, timeout, malformed
  // response), which the runner treats as an errored case.
  run(input: AgentInput, ctx: RunContext): Promise<AgentRunResult>;
}

// A trivial in-process agent built from a plain function. Used by tests and by
// the reference agent. It exists so that "define an agent" never requires a
// running server: you can exercise the whole harness in memory first.
export function defineAgent(
  name: string,
  handler: (input: AgentInput, ctx: RunContext) => Promise<AgentRunResult> | AgentRunResult,
): Agent {
  return {
    name,
    async run(input, ctx) {
      return handler(input, ctx);
    },
  };
}
