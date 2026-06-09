// End-to-end proof of the headline feature, entirely in memory and offline. It
// records cassettes from an in-process agent, sets a baseline, confirms a clean
// check, injects a regression by swapping the agent's behavior and re-recording,
// confirms the check fails, then reverts and confirms it passes again.

import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineAgent, defineSuite, scriptedJudge, type Case } from "@agentprobe/core";
import { defineConfig } from "./config.js";
import { recordCommand, baselineCommand, checkCommand, listRunsCommand } from "./run.js";

const tmp: string[] = [];
afterEach(async () => {
  for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function workspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-cli-"));
  tmp.push(dir);
  return dir;
}

const suite = defineSuite({
  name: "booking",
  cases: [
    {
      id: "books-available-slot",
      input: { q: "book tuesday 9am" },
      assertions: [
        { kind: "tool-called", tool: "book_slot" },
        { kind: "cost-budget", maxUsd: 0.05 },
      ],
      rubric: { criteria: "confirms the booking with a reference", passThreshold: 0.7 },
    },
  ],
});

// A judge that rewards an output mentioning a confirmation reference. Deterministic
// so the whole flow is reproducible with no API key.
const demoJudge = scriptedJudge((req) => {
  const text = JSON.stringify(req.output).toLowerCase();
  const good = text.includes("confirmation") || /bk-\d+/.test(text);
  return { score: good ? 0.9 : 0.3, rationale: good ? "has a reference" : "no confirmation reference" };
});

// The healthy agent books the slot and confirms with a reference.
const goodAgent = defineAgent("booking-agent", () => ({
  output: { reply: "Booked for Tuesday 9am. Confirmation BK-1." },
  trace: [{ type: "tool_call", call: { name: "book_slot", args: { slot: "tue-9am" } } }],
  metrics: { latencyMs: 700, costUsd: 0.01, steps: 3 },
}));

// The regressed agent forgets to call the booking tool and gives no reference.
const brokenAgent = defineAgent("booking-agent", () => ({
  output: { reply: "Let me look into availability." },
  trace: [{ type: "tool_call", call: { name: "check_availability", args: { day: "tue" } } }],
  metrics: { latencyMs: 700, costUsd: 0.01, steps: 2 },
}));

function configFor(dir: string, agent: (c: Case) => ReturnType<typeof defineAgent>) {
  return defineConfig({
    suite,
    cassetteDir: path.join(dir, "cassettes"),
    judgeCacheFile: path.join(dir, "judge-cache.json"),
    baselineFile: path.join(dir, "baseline.json"),
    dbPath: path.join(dir, "data", "runs.db"),
    liveAgent: agent,
    recordJudge: demoJudge,
  });
}

describe("CLI record/baseline/check loop", () => {
  it("passes clean, fails on an injected regression, and passes again on revert", async () => {
    const dir = await workspace();

    // Record the healthy agent and set it as the baseline.
    await recordCommand(configFor(dir, () => goodAgent));
    const baseline = await baselineCommand(configFor(dir, () => goodAgent));
    expect(baseline.casesPassed).toBe(1);

    // A clean check against the baseline: no regression.
    const clean = await checkCommand(configFor(dir, () => goodAgent));
    expect(clean.regression.regressed).toBe(false);

    // Inject the regression: re-record with the broken agent (new cassette and
    // judge verdict), then check. The booking tool assertion and the judge both
    // fail, so the case flips pass to fail and the gate must go red.
    await recordCommand(configFor(dir, () => brokenAgent));
    const regressed = await checkCommand(configFor(dir, () => brokenAgent));
    expect(regressed.regression.regressed).toBe(true);
    expect(regressed.regression.summary.regressedCases).toBe(1);

    // Revert: re-record the healthy agent. The gate returns to green.
    await recordCommand(configFor(dir, () => goodAgent));
    const reverted = await checkCommand(configFor(dir, () => goodAgent));
    expect(reverted.regression.regressed).toBe(false);
  });

  it("lists the stored run history newest first", async () => {
    const dir = await workspace();
    const config = configFor(dir, () => goodAgent);
    // No runs yet.
    expect(listRunsCommand(config)).toHaveLength(0);

    // Each record persists a run; baseline persists another.
    await recordCommand(config);
    await baselineCommand(config);

    const runs = listRunsCommand(config);
    expect(runs.length).toBe(2);
    // Newest first: ids descend.
    expect(runs[0]!.id).toBeGreaterThan(runs[1]!.id);
    // The baseline run is flagged.
    expect(runs.some((r) => r.isBaseline)).toBe(true);
  });
});
