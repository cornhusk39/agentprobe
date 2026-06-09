// Deterministic assertions. These are the half of scoring that needs no model:
// given a run result, each assertion is a pure, repeatable check. They cover the
// failure modes a single-prompt eval misses entirely, the wrong tool, the wrong
// arguments, a malformed output, and silent cost, latency, or step blowups.

import { z } from "zod";
import { toolCalls, type AgentRunResult, type ToolCall } from "./types.js";

// A Zod schema used by the output-schema assertion. It is a real schema object,
// so it does not survive JSON export; that assertion is TS-suite only by design.
const zodSchema = z.custom<z.ZodTypeAny>((v) => v instanceof z.ZodType, {
  message: "expected a Zod schema",
});

// The assertion catalog, as a discriminated union on `kind`. Authors build
// these as plain objects in a suite; the evaluator below interprets them.
export const assertionSchema = z.discriminatedUnion("kind", [
  // The named tool appears at least once in the trace.
  z.object({ kind: z.literal("tool-called"), tool: z.string() }),
  // The named tool was never called. The negative is its own failure mode: a
  // case can demand that an agent decline rather than act, and "did not book"
  // is something only this assertion can express directly.
  z.object({ kind: z.literal("tool-not-called"), tool: z.string() }),
  // The named tool was called a bounded number of times. This is the guard
  // against runaway tool use, the loop that calls the same tool ten times and
  // quietly triples the cost, which a pass/fail check alone never catches.
  z.object({
    kind: z.literal("tool-call-count"),
    tool: z.string(),
    op: z.enum(["exactly", "at-least", "at-most"]).default("at-most"),
    count: z.number().int().nonnegative(),
  }),
  // A call to the named tool has arguments matching `args`. "subset" checks
  // that each given key matches; "exact" requires the whole arg object to match.
  z.object({
    kind: z.literal("tool-args"),
    tool: z.string(),
    args: z.record(z.unknown()),
    match: z.enum(["subset", "exact"]).default("subset"),
  }),
  // The agent's output parses against the given schema. This one holds a live
  // Zod schema, so it is for code-defined TS suites only; it does not serialize.
  z.object({ kind: z.literal("output-schema"), schema: zodSchema }),
  // A single field of the output exists, or equals a value. Fully serializable,
  // so it can be authored in the dashboard. `path` is a dot path into the output
  // (for example "status" or "property.type").
  z.object({
    kind: z.literal("output-field"),
    path: z.string().min(1),
    op: z.enum(["exists", "equals"]).default("exists"),
    value: z.unknown().optional(),
  }),
  // Each metric stays under its budget. These are what regression detection
  // later diffs across runs.
  z.object({ kind: z.literal("latency-budget"), maxMs: z.number().positive() }),
  z.object({ kind: z.literal("cost-budget"), maxUsd: z.number().positive() }),
  z.object({ kind: z.literal("step-budget"), maxSteps: z.number().int().positive() }),
]);
export type Assertion = z.infer<typeof assertionSchema>;

export interface AssertionResult {
  kind: Assertion["kind"];
  // A short label for the dashboard, e.g. the tool name or the metric.
  label: string;
  pass: boolean;
  message: string;
  // For metric assertions, the observed value and its budget, so the dashboard
  // can render how close a run came to tripping a threshold.
  observed?: number;
  budget?: number;
}

// Stable structural comparison. Args are JSON-shaped, so a canonical stringify
// with sorted keys is a correct and cheap deep equality.
function canonical(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = norm((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(norm);
    return v;
  };
  return JSON.stringify(norm(value));
}

// Resolve a dot path into a value tree, returning a marker when the path does
// not exist so that a stored undefined can be told apart from a missing field.
const MISSING = Symbol("missing");
function getByPath(root: unknown, path: string): unknown | typeof MISSING {
  let node: unknown = root;
  for (const key of path.split(".")) {
    if (node && typeof node === "object" && key in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[key];
    } else {
      return MISSING;
    }
  }
  return node;
}

function argsMatch(call: ToolCall, expected: Record<string, unknown>, mode: "subset" | "exact"): boolean {
  if (mode === "exact") {
    return canonical(call.args) === canonical(expected);
  }
  return Object.entries(expected).every(
    ([key, val]) => canonical((call.args as Record<string, unknown>)[key]) === canonical(val),
  );
}

function evaluateOne(result: AgentRunResult, assertion: Assertion): AssertionResult {
  switch (assertion.kind) {
    case "tool-called": {
      const called = toolCalls(result.trace).some((c) => c.name === assertion.tool);
      return {
        kind: assertion.kind,
        label: assertion.tool,
        pass: called,
        message: called
          ? `tool "${assertion.tool}" was called`
          : `tool "${assertion.tool}" was never called`,
      };
    }
    case "tool-not-called": {
      const called = toolCalls(result.trace).some((c) => c.name === assertion.tool);
      return {
        kind: assertion.kind,
        label: assertion.tool,
        pass: !called,
        message: called
          ? `tool "${assertion.tool}" was called but should not have been`
          : `tool "${assertion.tool}" was correctly not called`,
      };
    }
    case "tool-call-count": {
      const n = toolCalls(result.trace).filter((c) => c.name === assertion.tool).length;
      const op = assertion.op ?? "at-most";
      const pass =
        op === "exactly" ? n === assertion.count : op === "at-least" ? n >= assertion.count : n <= assertion.count;
      return {
        kind: assertion.kind,
        label: assertion.tool,
        pass,
        observed: n,
        budget: assertion.count,
        message: `tool "${assertion.tool}" called ${n} time(s), expected ${op} ${assertion.count}`,
      };
    }
    case "tool-args": {
      const calls = toolCalls(result.trace).filter((c) => c.name === assertion.tool);
      const match = assertion.match ?? "subset";
      const hit = calls.find((c) => argsMatch(c, assertion.args, match));
      return {
        kind: assertion.kind,
        label: assertion.tool,
        pass: Boolean(hit),
        message: hit
          ? `tool "${assertion.tool}" was called with matching args (${match})`
          : calls.length === 0
            ? `tool "${assertion.tool}" was never called, so args could not match`
            : `tool "${assertion.tool}" was called but no call matched the expected args (${match})`,
      };
    }
    case "output-schema": {
      const parsed = assertion.schema.safeParse(result.output);
      return {
        kind: assertion.kind,
        label: "output-schema",
        pass: parsed.success,
        message: parsed.success
          ? "output matched the schema"
          : `output did not match the schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      };
    }
    case "output-field": {
      const found = getByPath(result.output, assertion.path);
      const exists = found !== MISSING;
      if (assertion.op === "exists") {
        return {
          kind: assertion.kind,
          label: assertion.path,
          pass: exists,
          message: exists
            ? `output field "${assertion.path}" is present`
            : `output field "${assertion.path}" is missing`,
        };
      }
      // equals
      const pass = exists && canonical(found) === canonical(assertion.value);
      return {
        kind: assertion.kind,
        label: assertion.path,
        pass,
        message: pass
          ? `output field "${assertion.path}" equals the expected value`
          : exists
            ? `output field "${assertion.path}" did not equal the expected value`
            : `output field "${assertion.path}" is missing, so it cannot equal the expected value`,
      };
    }
    case "latency-budget": {
      const observed = result.metrics.latencyMs;
      const pass = observed <= assertion.maxMs;
      return {
        kind: assertion.kind,
        label: "latency",
        pass,
        observed,
        budget: assertion.maxMs,
        message: `latency ${observed}ms ${pass ? "within" : "over"} budget ${assertion.maxMs}ms`,
      };
    }
    case "cost-budget": {
      const observed = result.metrics.costUsd;
      const pass = observed <= assertion.maxUsd;
      return {
        kind: assertion.kind,
        label: "cost",
        pass,
        observed,
        budget: assertion.maxUsd,
        message: `cost $${observed} ${pass ? "within" : "over"} budget $${assertion.maxUsd}`,
      };
    }
    case "step-budget": {
      const observed = result.metrics.steps;
      const pass = observed <= assertion.maxSteps;
      return {
        kind: assertion.kind,
        label: "steps",
        pass,
        observed,
        budget: assertion.maxSteps,
        message: `steps ${observed} ${pass ? "within" : "over"} budget ${assertion.maxSteps}`,
      };
    }
  }
}

export function evaluateAssertions(result: AgentRunResult, assertions: Assertion[]): AssertionResult[] {
  return assertions.map((a) => evaluateOne(result, a));
}

// Convenience: did every assertion pass?
export function assertionsPassed(results: AssertionResult[]): boolean {
  return results.every((r) => r.pass);
}
