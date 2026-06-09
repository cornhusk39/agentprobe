# AgentProbe

**A regression safety net for LLM agents.** Record agent runs as cassettes,
replay them deterministically in CI, score them with deterministic assertions
*and* an LLM judge, and fail the build when quality, cost, or latency regress
against a saved baseline.

[![CI](https://github.com/cornhusk39/agentprobe/actions/workflows/agentprobe.yml/badge.svg)](https://github.com/cornhusk39/agentprobe/actions/workflows/agentprobe.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

---

## The problem

Change a prompt, swap a model, or bump a dependency, and you usually find out
something broke from a user, not from CI. Single-prompt eval tools score one
turn of text. They do not assert on multi-step, tool-calling behavior, which is
exactly where real agents fail: the wrong tool, the wrong arguments, a silent
cost blow-up, latency creep across a chain of steps.

AgentProbe treats agent runs like a test suite. You define cases, run them
against your agent over HTTP, and **record each run as a cassette** (the full
trace). On every change it **replays those cassettes deterministically**, scores
them, and **fails the build on a regression**. A Next.js dashboard shows runs,
traces, and trends.

## How it works

```
            record (opt-in, live)                 replay (default, offline)
 your agent ──────────────────► cassette (redacted) ──────────────────► score
   over HTTP                       on disk, committed                     │
                                                                          ├─ deterministic assertions
                                                                          │    tool called / not called,
                                                                          │    args, call count, call order,
                                                                          │    output shape, latency / cost /
                                                                          │    step budgets
                                                                          │
                                                                          └─ LLM judge (rubric → score)
                                                                               cached, so CI needs no key
                                          │
                                          ▼
                          diff against a committed baseline
                                  pass / regress / improve
                                          │
                           GitHub Action fails the build on a regression
                                          │
                              Next.js dashboard: runs, traces, trends
```

The single integration point is one `Agent` interface. Every transport (live
HTTP, replay from a cassette, an in-process test double) implements it, so the
recorder can wrap any agent and the replay transport can stand in for any agent
without the rest of the system knowing the difference.

## What makes it different

- **It asserts on the whole trace, not one turn.** "The booking tool was called,
  after availability was checked, with these arguments, at most twice" is a thing
  you can assert. A single-prompt eval can't see any of that.
- **Replay is deterministic and key-free.** CI replays committed cassettes, and
  the LLM judge reads cached verdicts, so the gate needs no network and no API
  key. Live capture is opt-in and only used to record or refresh a cassette.
- **It gates on cost and latency, not just correctness.** A change that keeps
  every case passing but triples the cost still fails the build.
- **Secrets and PII are redacted at capture time,** before a cassette is written,
  with a fail-closed check that refuses to write a cassette that still contains a
  known secret shape.

## Quickstart (no API key required)

```sh
pnpm install
pnpm test          # 83 tests across the engine, CLI, and dashboard

# Run the bundled reference agent's gate, entirely offline:
cd examples/reference-agent
pnpm check         # PASS, exits 0
```

See the gate catch a regression:

```sh
# Inject a regression: the agent stops calling its booking tool.
AGENTPROBE_DEMO_REGRESSION=1 pnpm record
pnpm check         # FAIL, exits 1, names the broken assertions

pnpm record        # revert
pnpm check         # PASS again
```

When the regression is in, `check` reports exactly why:

```
  FAIL  books-available-slot  2/8 assertions  judge 0.45 (below threshold)
  [regress] books-available-slot: case went from pass to fail

FAIL: 2 case(s) regressed
```

The deterministic assertion (`tool-called create_booking: never called`) and the
judge (score drops from 0.92 to 0.45) agree, from two independent angles, that
the agent stopped doing its job.

## The dashboard

```sh
pnpm --filter @agentprobe/web seed:db   # seed a local database with run history
pnpm --filter @agentprobe/web dev       # http://localhost:3000
```

The dashboard is interactive and reads/writes the same SQLite database the CLI
uses:

- **Runs** — trend charts (pass rate, judge score, cost, latency), a runs table
  with regression highlights, and a run detail view with the full trace and
  tool-call view. "Run suite now" replays and records; "Set as baseline" promotes
  a run.
- **Suite** — author cases in the browser: edit a case as validated JSON, add or
  delete cases, then run the suite to see pass or fail change immediately. Export
  and import suites as JSON.
- **Compare** — diff any two runs side by side, with per-case classification and
  color-coded judge, cost, and latency deltas.
- **Flaky cases** — surfaces cases whose pass/fail status has churned across the
  run history.

## Using it on your own agent

Point the HTTP adapter at your agent's endpoint. Your agent should return the run
contract `{ output, trace, metrics }`; if its native response differs, map it
with `mapResponse`.

```ts
// agentprobe.config.ts  (scaffold one with `agentprobe init`)
import { defineConfig } from "@agentprobe/cli";
import { httpAgent, anthropicJudge } from "@agentprobe/core";
import { suite } from "./suite.js";

export default defineConfig({
  suite,
  cassetteDir: "./cassettes",
  judgeCacheFile: "./judge-cache.json",
  baselineFile: "./baseline.json",
  dbPath: "./data/agentprobe.db",
  liveAgent: () =>
    httpAgent({
      name: "my-agent",
      url: process.env.MY_AGENT_URL!,
      allowlist: ["my-agent.internal"],
      bearerEnvVar: "AGENT_BEARER_TOKEN", // read from env at call time, never committed
      retries: 2,
    }),
  recordJudge: anthropicJudge(), // needs ANTHROPIC_API_KEY, used only at record time
});
```

Then, once:

```sh
export ANTHROPIC_API_KEY=...   # only for record
export AGENT_BEARER_TOKEN=...  # only for record
agentprobe record    # capture redacted cassettes + real judge verdicts
agentprobe baseline  # save the committed baseline
```

Commit the cassettes, the judge cache, and `baseline.json`. From then on,
`agentprobe check` and CI replay them with no key. Wire the included GitHub
Action and every pull request gets a regression gate plus a Markdown summary in
the job output.

## Layout

This is a pnpm workspace.

- **`packages/core`** — the framework-free engine: the `Agent` interface, the
  HTTP adapter and recorder, the replay transport, deterministic assertions, the
  LLM judge, SQLite persistence, and the regression diff. No Next, no React, no
  CLI concerns, so it can be reused on its own.
- **`packages/cli`** — the command line: `init`, `record`, `replay`, `baseline`,
  `check`, `runs`, `stats`.
- **`packages/web`** — the Next.js (App Router) dashboard.
- **`examples/reference-agent`** — a mock home-service booking agent, its suite,
  and committed cassettes, used as the offline demo.

## Design decisions and tradeoffs

- **Cassettes and replay, not live calls in CI.** Replaying a recorded trace is
  deterministic, offline, and free; between two runs the only variables are the
  assertions, the judge, and the thresholds. The cost is that a cassette can go
  stale, which is by design: re-recording is a deliberate, reviewable act.
- **Two kinds of scoring.** Deterministic assertions catch the precise, machine
  checkable failures; the LLM judge catches the fuzzy quality failures a schema
  can't express. An agent can call the right tools and still answer badly.
- **The judge is cached and offline-first.** Verdicts are keyed by a hash of
  (case, output, rubric). In offline mode a cache miss is an error, never a
  surprise live call, which is what keeps CI deterministic and key-free.
- **`core` is framework-free.** The dashboard imports only *types* from it, which
  keeps the engine's native dependency (better-sqlite3) out of the client bundle.
- **Redaction is fail-closed.** Custom rules can extend the built-in set, but a
  fixed backstop still refuses to write a cassette containing a known secret
  shape.

## Limitations and roadmap

This is a focused v1. Known boundaries:

- **The dashboard's authored suite and the CLI's code suite are separate stores.**
  The dashboard edits cases in its local database for fast iteration; the
  committed TypeScript suite is the source of truth for CI. Reconciling the two
  (a `suite sync` / codegen step) is the most-wanted next feature.
- **The HTTP adapter expects a structured trace.** Agents built on frameworks
  that don't expose tool calls over HTTP need a `mapResponse` shim; first-class
  adapters for common frameworks are on the roadmap.
- **The dashboard tracks a single active suite** and does not paginate large run
  histories yet.
- **Editing a rubric invalidates its cached judge verdict,** so the suite must be
  re-recorded before CI can score it offline.

## Development

```sh
pnpm install
pnpm test         # vitest across packages
pnpm typecheck
pnpm lint
pnpm build        # engine, CLI, and the dashboard
./publish-gate.sh # secret hygiene + gitleaks + typecheck/lint/test/build + the gate

agentprobe init   # scaffold a new project
```

A gitleaks pre-commit hook runs on every commit (enable it once with
`git config core.hooksPath .githooks`), and CI runs a server-side secret scan.

## License

MIT. See [LICENSE](./LICENSE).
