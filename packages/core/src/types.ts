// The core domain model. Zod schemas are the source of truth so that anything
// crossing a trust boundary (a cassette read from disk, a suite file, an agent
// HTTP response) gets validated at runtime, and the TypeScript types are
// derived from the same definitions. One model, no drift.

import { z } from "zod";

// A single tool invocation inside an agent run. This is the unit deterministic
// assertions care about most: which tool, with which arguments, and what it
// returned. Args are kept as an open record because every agent's tools differ;
// assertions narrow them per case.
export const toolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()).default({}),
  // The tool's output, if the agent reported it. Optional because some agents
  // only surface the call, not the result.
  result: z.unknown().optional(),
  // Present when the tool itself errored. Distinct from a missing result.
  error: z.string().optional(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

// A step in the agent's trace. We model the two things assertions and the
// dashboard need to reason about: conversational messages and tool calls. The
// shape is intentionally narrow so different agents map onto it cleanly rather
// than leaking provider-specific structures into core.
export const traceStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool_call"),
    call: toolCallSchema,
  }),
]);
export type TraceStep = z.infer<typeof traceStepSchema>;

// Quantitative facts about a run. These are what regression detection diffs
// against a baseline. Cost is in US dollars; latency in milliseconds; steps is
// the number of model or tool steps the agent took to finish.
export const runMetricsSchema = z.object({
  latencyMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  steps: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});
export type RunMetrics = z.infer<typeof runMetricsSchema>;

// The complete result of running an agent on a single case. This is what the
// recorder captures, what replay returns verbatim, and what assertions and the
// judge score. `output` is the agent's final answer; `trace` is how it got
// there; `metrics` is what it cost.
export const agentRunResultSchema = z.object({
  output: z.unknown(),
  trace: z.array(traceStepSchema).default([]),
  metrics: runMetricsSchema,
});
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;

// The input handed to an agent for a case. Left as unknown so any JSON-shaped
// payload works; suites validate their own input shapes.
export type AgentInput = unknown;

// Context passed to an agent on each run. Carries an abort signal so live
// transports can honor timeouts and cancellation, and a clock so recording can
// be made deterministic in tests rather than reaching for the wall clock.
export interface RunContext {
  signal?: AbortSignal;
  // Returns the current time in ms since epoch. Injectable so cassettes can be
  // recorded with stable timestamps under test.
  now: () => number;
}

// Convenience for callers that do not care about determinism: a context backed
// by the real wall clock.
export function liveContext(signal?: AbortSignal): RunContext {
  return { signal, now: () => Date.now() };
}

// Helpers for pulling tool calls out of a trace. Used heavily by assertions.
export function toolCalls(trace: TraceStep[]): ToolCall[] {
  return trace
    .filter((s): s is Extract<TraceStep, { type: "tool_call" }> => s.type === "tool_call")
    .map((s) => s.call);
}

export function toolNames(trace: TraceStep[]): string[] {
  return toolCalls(trace).map((c) => c.name);
}
