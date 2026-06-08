// M1 smoke test. Proves the spine works end to end in memory: define an agent,
// run it through the Agent interface, get a validated result back. If this is
// green, the type foundation and the run contract hold.

import { describe, it, expect } from "vitest";
import { defineAgent } from "./agent.js";
import { agentRunResultSchema, toolNames, type RunContext } from "./types.js";

// A fixed clock so anything time-dependent is deterministic under test.
const fixedCtx: RunContext = { now: () => 1_700_000_000_000 };

describe("defineAgent", () => {
  it("runs an in-process agent and returns a well-formed result", async () => {
    const echo = defineAgent("echo", (input) => ({
      output: input,
      trace: [
        { type: "message", role: "user", content: String(input) },
        { type: "tool_call", call: { name: "lookup", args: { q: input } } },
        { type: "message", role: "assistant", content: `you said ${input}` },
      ],
      metrics: { latencyMs: 12, costUsd: 0.0004, steps: 3 },
    }));

    const result = await echo.run("hello", fixedCtx);

    // The result must satisfy the core schema, our contract for every transport.
    expect(() => agentRunResultSchema.parse(result)).not.toThrow();
    expect(result.output).toBe("hello");
    expect(toolNames(result.trace)).toEqual(["lookup"]);
    expect(result.metrics.steps).toBe(3);
  });

  it("exposes a stable name", () => {
    const a = defineAgent("booking-agent", () => ({
      output: null,
      trace: [],
      metrics: { latencyMs: 0, costUsd: 0, steps: 0 },
    }));
    expect(a.name).toBe("booking-agent");
  });
});
