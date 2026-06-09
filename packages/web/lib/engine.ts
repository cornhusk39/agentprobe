// Server-only engine runner for the authored suite. It materializes the suite
// from the database, replays the reference cassettes to score each case, and
// persists the run, all in process. Editing a case in the dashboard and running
// it here is the authoring loop: change an assertion, run, see pass or fail
// change immediately.
//
// The judge is a deterministic heuristic (the same one the reference demo uses)
// so interactive runs need no API key and no cache, which means editing a
// rubric works offline too.

import path from "node:path";
import { existsSync } from "node:fs";
import {
  SuiteStore,
  ReplayStore,
  scriptedJudge,
  runSuite,
  persistRun,
  Store,
  defineAgent,
  type Agent,
} from "@agentprobe/core";
import { dbPath, suiteName } from "./db";

// Locate the reference example by walking up from the working directory until a
// directory containing examples/reference-agent is found. This works whether the
// server was started from the web package or the repo root, rather than assuming
// a fixed depth (process.cwd() is reliable in the Next server runtime, but the
// distance to the repo root is not).
function exampleDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "examples", "reference-agent");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the conventional location (web package two levels below root).
  return path.resolve(process.cwd(), "..", "..", "examples", "reference-agent");
}

// The reference demo's judge, replicated so the web runtime does not have to
// import the example package. Rewards a complete, on-task response.
const demoJudge = scriptedJudge((req) => {
  const out = req.output as { status?: string; message?: string; confirmationId?: string; slots?: unknown; property?: unknown } | null;
  const message = String(out?.message ?? "");
  if (out?.status === "booked" && out.confirmationId) {
    return { score: 0.92, rationale: "Completed the booking and returned a confirmation reference." };
  }
  if (out?.status === "unavailable" && /soonest|no openings/i.test(message)) {
    return { score: 0.85, rationale: "Declined gracefully and pointed to the next available day." };
  }
  if (out?.status === "info" && (out.slots !== undefined || out.property !== undefined)) {
    return { score: 0.88, rationale: "Answered the query with the requested details." };
  }
  return { score: 0.45, rationale: "Did not complete the task or provide the requested information." };
});

// A stand-in agent for a case that has no recorded cassette yet. It fails the
// case with a clear message rather than aborting the whole run.
function missingCassetteAgent(caseId: string): Agent {
  return defineAgent("home-service-booking", () => {
    throw new Error(`No cassette recorded for "${caseId}". Record it before it can be replayed.`);
  });
}

export interface RunSummary {
  runId: number;
  passed: number;
  total: number;
}

export async function runActiveSuite(): Promise<RunSummary> {
  const suiteStore = new SuiteStore(dbPath());
  const cases = suiteStore.getCases(suiteName());
  suiteStore.close();
  if (cases.length === 0) {
    throw new Error("The suite has no cases. Add a case under Suite before running.");
  }
  const suite = { name: suiteName(), cases };

  const replay = await ReplayStore.fromDir(path.join(exampleDir(), "cassettes"));
  const report = await runSuite({
    suite,
    agentFor: (c) => (replay.has(c.id) ? replay.agentFor(c.id) : missingCassetteAgent(c.id)),
    judge: demoJudge,
    mode: "replay",
    now: () => Date.now(),
  });

  const store = new Store(dbPath());
  const runId = persistRun(store, report);
  store.close();
  return { runId, passed: report.casesPassed, total: report.casesTotal };
}
