#!/usr/bin/env node
// The AgentProbe command line. Thin by design: parse arguments, load the
// project config, dispatch to the machinery in run.ts, format the result, and
// set an exit code. All the real logic lives in run.ts and in core.

import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentProbeConfig } from "./config.js";
import { recordCommand, replayCommand, baselineCommand, checkCommand } from "./run.js";
import type { RunReport } from "@agentprobe/core";

const USAGE = `agentprobe <command> [--config <path>]

Commands:
  record     Capture a live run per case to a redacted cassette, score it, and
             save the judge cache and run history. The only command that may
             reach the network or the model.
  replay     Replay the recorded cassettes offline and print the run summary.
  baseline   Replay and save the result as the suite's committed baseline.
  check      Replay and diff against the baseline. Exits non-zero on a
             regression. This is what CI runs.

Options:
  --config <path>   Path to the config module (default: ./agentprobe.config.ts)
`;

interface ParsedArgs {
  command: string | undefined;
  configPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let command: string | undefined;
  let configPath = "agentprobe.config.ts";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") {
      const next = argv[++i];
      if (!next) throw new Error("--config needs a path");
      configPath = next;
    } else if (!command && arg && !arg.startsWith("-")) {
      command = arg;
    }
  }
  return { command, configPath };
}

async function loadConfig(configPath: string): Promise<AgentProbeConfig> {
  const abs = path.resolve(process.cwd(), configPath);
  const mod = (await import(pathToFileURL(abs).href)) as { default?: AgentProbeConfig };
  if (!mod.default) {
    throw new Error(`Config at ${configPath} must have a default export (use defineConfig).`);
  }
  return mod.default;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(4)}`;
}

function printRunSummary(report: RunReport): void {
  console.log(`\nrun ${report.runUid}  (${report.mode})  suite "${report.suite}"`);
  for (const c of report.cases) {
    const mark = c.passed ? "PASS" : "FAIL";
    const judge = c.judge ? `  judge ${c.judge.score.toFixed(2)}${c.judge.pass ? "" : " (below threshold)"}` : "";
    const err = c.error ? `  error: ${c.error}` : "";
    const a = `${c.assertionsPassed}/${c.assertionsTotal} assertions`;
    console.log(`  ${mark}  ${c.caseId}  ${a}${judge}  ${c.metrics.latencyMs}ms ${fmtMoney(c.metrics.costUsd)}${err}`);
  }
  console.log(
    `  ----\n  ${report.casesPassed}/${report.casesTotal} cases passed  ` +
      `total ${fmtMoney(report.totalCostUsd)}  ${report.totalLatencyMs}ms` +
      (report.avgJudgeScore !== null ? `  avg judge ${report.avgJudgeScore.toFixed(2)}` : ""),
  );
}

async function main(): Promise<number> {
  const { command, configPath } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  const config = await loadConfig(configPath);

  switch (command) {
    case "record": {
      const report = await recordCommand(config);
      printRunSummary(report);
      console.log("\nrecorded cassettes and judge cache.");
      return report.casesPassed === report.casesTotal ? 0 : 1;
    }
    case "replay": {
      const report = await replayCommand(config);
      printRunSummary(report);
      return report.casesPassed === report.casesTotal ? 0 : 1;
    }
    case "baseline": {
      const report = await baselineCommand(config);
      printRunSummary(report);
      console.log(`\nbaseline saved to ${config.baselineFile}`);
      return 0;
    }
    case "check": {
      const { report, regression } = await checkCommand(config);
      printRunSummary(report);
      console.log(`\nregression check against baseline ${regression.baselineRunUid}:`);
      for (const c of regression.cases) {
        if (c.classification === "pass") continue;
        console.log(`  [${c.classification}] ${c.caseId}: ${c.reasons.join(", ")}`);
      }
      const s = regression.summary;
      console.log(
        `  regressed ${s.regressedCases}  improved ${s.improvedCases}  new ${s.newCases}  removed ${s.removedCases}`,
      );
      if (regression.regressed) {
        console.log(`\nFAIL: ${regression.reasons.join("; ")}`);
        return 1;
      }
      console.log("\nPASS: no regressions against the baseline.");
      return 0;
    }
    default:
      console.error(`Unknown command "${command}".\n`);
      console.log(USAGE);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
