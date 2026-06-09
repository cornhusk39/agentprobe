import { describe, it, expect } from "vitest";
import { z } from "zod";
import { evaluateAssertions, assertionsPassed, type Assertion } from "./assertions.js";
import type { AgentRunResult } from "./types.js";

const result: AgentRunResult = {
  output: { confirmationId: "BK-123", when: "2026-06-09T09:00:00Z" },
  trace: [
    { type: "message", role: "user", content: "book tuesday 9am" },
    { type: "tool_call", call: { name: "check_availability", args: { day: "tue" } } },
    { type: "tool_call", call: { name: "book_slot", args: { slot: "tue-9am", customerId: 42 } } },
    { type: "message", role: "assistant", content: "Booked." },
  ],
  metrics: { latencyMs: 800, costUsd: 0.012, steps: 4 },
};

describe("deterministic assertions", () => {
  it("passes tool-called, tool-args (subset), and budgets that hold", () => {
    const assertions: Assertion[] = [
      { kind: "tool-called", tool: "book_slot" },
      { kind: "tool-args", tool: "book_slot", args: { slot: "tue-9am" }, match: "subset" },
      { kind: "latency-budget", maxMs: 1000 },
      { kind: "cost-budget", maxUsd: 0.02 },
      { kind: "step-budget", maxSteps: 5 },
      { kind: "output-schema", schema: z.object({ confirmationId: z.string() }) },
    ];
    const results = evaluateAssertions(result, assertions);
    expect(assertionsPassed(results)).toBe(true);
  });

  it("fails when the wrong tool is expected", () => {
    const [r] = evaluateAssertions(result, [{ kind: "tool-called", tool: "cancel_booking" }]);
    expect(r!.pass).toBe(false);
    expect(r!.message).toContain("never called");
  });

  it("tool-not-called passes when the tool is absent and fails when it appears", () => {
    // book_slot was called in the trace, cancel_booking was not.
    const absent = evaluateAssertions(result, [{ kind: "tool-not-called", tool: "cancel_booking" }]);
    expect(absent[0]!.pass).toBe(true);

    const present = evaluateAssertions(result, [{ kind: "tool-not-called", tool: "book_slot" }]);
    expect(present[0]!.pass).toBe(false);
    expect(present[0]!.message).toContain("should not have been");
  });

  it("fails tool-args when arguments diverge", () => {
    const [r] = evaluateAssertions(result, [
      { kind: "tool-args", tool: "book_slot", args: { slot: "wed-9am" }, match: "subset" },
    ]);
    expect(r!.pass).toBe(false);
  });

  it("exact arg match is stricter than subset", () => {
    const subset = evaluateAssertions(result, [
      { kind: "tool-args", tool: "book_slot", args: { slot: "tue-9am" }, match: "subset" },
    ]);
    const exact = evaluateAssertions(result, [
      { kind: "tool-args", tool: "book_slot", args: { slot: "tue-9am" }, match: "exact" },
    ]);
    expect(subset[0]!.pass).toBe(true);
    // exact fails because the real call also carried customerId
    expect(exact[0]!.pass).toBe(false);
  });

  it("reports observed values for over-budget metrics", () => {
    const [r] = evaluateAssertions(result, [{ kind: "latency-budget", maxMs: 500 }]);
    expect(r!.pass).toBe(false);
    expect(r!.observed).toBe(800);
    expect(r!.budget).toBe(500);
  });

  it("fails output-schema when the shape is wrong", () => {
    const [r] = evaluateAssertions(result, [
      { kind: "output-schema", schema: z.object({ missing: z.number() }) },
    ]);
    expect(r!.pass).toBe(false);
  });

  it("output-field checks existence and equality on a dot path", () => {
    const exists = evaluateAssertions(result, [{ kind: "output-field", path: "confirmationId", op: "exists" }]);
    expect(exists[0]!.pass).toBe(true);

    const missing = evaluateAssertions(result, [{ kind: "output-field", path: "nope", op: "exists" }]);
    expect(missing[0]!.pass).toBe(false);

    const equals = evaluateAssertions(result, [
      { kind: "output-field", path: "confirmationId", op: "equals", value: "BK-123" },
    ]);
    expect(equals[0]!.pass).toBe(true);

    const wrongValue = evaluateAssertions(result, [
      { kind: "output-field", path: "confirmationId", op: "equals", value: "BK-999" },
    ]);
    expect(wrongValue[0]!.pass).toBe(false);
  });
});
