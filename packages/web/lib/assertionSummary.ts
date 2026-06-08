// A short human label for an assertion, used in the suite list. Kept as a pure
// function so both server components can render it without pulling in the engine.

import type { Assertion } from "@agentprobe/core";

export function assertionSummary(a: Assertion): string {
  switch (a.kind) {
    case "tool-called":
      return a.tool;
    case "tool-args":
      return `${a.tool} args ${JSON.stringify(a.args)} (${a.match ?? "subset"})`;
    case "output-schema":
      return "matches a Zod schema";
    case "output-field":
      return a.op === "exists" ? `${a.path} exists` : `${a.path} = ${JSON.stringify(a.value)}`;
    case "latency-budget":
      return `<= ${a.maxMs}ms`;
    case "cost-budget":
      return `<= $${a.maxUsd}`;
    case "step-budget":
      return `<= ${a.maxSteps} steps`;
  }
}
