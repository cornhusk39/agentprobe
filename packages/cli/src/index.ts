#!/usr/bin/env node
// The AgentProbe command line. Thin by design: parse arguments, load the
// project config, dispatch to the machinery in run.ts, format the result, and
// set an exit code. All the real logic lives in run.ts and in core.

import path from "node:path";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { AgentProbeConfig } from "./config.js";
import {
  recordCommand,
  replayCommand,
  baselineCommand,
  checkCommand,
  listRunsCommand,
  statsCommand,
  initCommand,
} from "./run.js";
import { regressionMarkdown, type RunReport } from "@agentprobe/core";

const USAGE = `agentprobe <command> [--config <path>]

Commands:
  record     Capture a live run per case to a redacted cassette, score it, and
             save the judge cache and run history. The only command that may
             reach the network or the model.
  replay     Replay the recorded cassettes offline and print the run summary.
  baseline   Replay and save the result as the suite's committed baseline.
  check      Replay and diff against the baseline. Exits non-zero on a
             regression. This is what CI runs.
  runs       Print the stored run history for the suite, newest first.
  stats      Print aggregate health stats for the suite.
  init       Scaffold a starter agentprobe.config.ts and suite.ts in the
             current directory.

Options:
  --config <path>   Path to the config module (default: ./agentprobe.config.ts)
  --json            For check: print the regression report as JSON instead of
                    text. When $GITHUB_STEP_SUMMARY is set, check also writes a
                    Markdown summary there automatically.
`;

interface ParsedArgs {
  command: string | undefined;
  configPath: string;
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let command: string | undefined;
  let configPath = "agentprobe.config.ts";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") {
      const next = argv[++i];
      if (!next) throw new Error("--config needs a path");
      configPath = next;
    } else if (arg === "--json") {
      json = true;
    } else if (!command && arg && !arg.startsWith("-")) {
      command = arg;
    }
  }
  return { command, configPath, json };
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
  const { command, configPath, json } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  // init runs before any config is loaded, since it is what creates the config.
  if (command === "init") {
    const created = await initCommand(process.cwd());
    console.log("scaffolded a starter project:");
    for (const f of created) console.log(`  ${path.relative(process.cwd(), f)}`);
    console.log("\nNext: edit suite.ts and agentprobe.config.ts, then run `agentprobe record`.");
    return 0;
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

      // When CI provides a step-summary file, drop a Markdown report into it so
      // a regression shows up readably in the pull request, no extra wiring.
      const summaryFile = process.env.GITHUB_STEP_SUMMARY;
      if (summaryFile) {
        appendFileSync(summaryFile, regressionMarkdown(regression));
      }

      // --json emits the machine-readable report for other tools to consume.
      // The exit code still encodes pass or fail.
      if (json) {
        console.log(JSON.stringify(regression, null, 2));
        return regression.regressed ? 1 : 0;
      }

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
    case "stats": {
      const s = statsCommand(config);
      if (s.runs === 0) {
        console.log(`No runs recorded yet for suite "${s.suite}".`);
        return 0;
      }
      const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);
      console.log(`stats for suite "${s.suite}":\n`);
      console.log(`  runs           ${s.runs}`);
      console.log(`  latest pass    ${pct(s.latestPassRate)}`);
      console.log(`  avg judge      ${s.avgJudge !== null ? s.avgJudge.toFixed(2) : "-"}`);
      console.log(`  avg cost       ${fmtMoney(s.avgCostUsd)}`);
      console.log(`  avg latency    ${Math.round(s.avgLatencyMs)}ms`);
      console.log(`  flaky cases    ${s.flakyCases}`);
      console.log(`  baseline       ${s.baselineRunUid ?? "none"}`);
      return 0;
    }
    case "runs": {
      const runs = listRunsCommand(config);
      if (runs.length === 0) {
        console.log(`No runs recorded yet for suite "${config.suite.name}".`);
        return 0;
      }
      console.log(`run history for suite "${config.suite.name}" (newest first):\n`);
      for (const r of runs) {
        const flag = r.isBaseline ? " *baseline" : "";
        const judge = r.avgJudgeScore !== null ? `judge ${r.avgJudgeScore.toFixed(2)}` : "judge -";
        console.log(
          `  #${r.id}  ${r.createdAt.slice(0, 19).replace("T", " ")}  ${r.mode}  ` +
            `${r.casesPassed}/${r.casesTotal}  ${judge}  ${fmtMoney(r.totalCostUsd)}  ${r.totalLatencyMs}ms${flag}`,
        );
      }
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
