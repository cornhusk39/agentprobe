# Testing AgentProbe

The harness is built so that testing it, running CI, and shipping the demo never
need a Claude API key. The model is touched in exactly one place (the live
judge), and that is mockable, cached, and opt-in. This file lays out the levels.

## Why no key is needed

The judge is an interface with three implementations:

- `anthropicJudge` calls Claude. The real one.
- `scriptedJudge` is a deterministic function. Used by tests and the demo.
- `cachedJudge` wraps either and serves verdicts from a cached file. In offline
  mode a cache miss is an error, never a surprise live call.

Two facts make a key unnecessary for testing:

1. Replay freezes the agent's trace into a committed cassette, so re-running is
   deterministic and offline.
2. Judge verdicts are cached by a hash of (case, output, rubric), so scoring a
   replay reads the cache instead of calling the model.

A key is needed in one situation only: pointing AgentProbe at your own agent and
asking the real judge for a real verdict, which happens once at record time to
seed the cache. Every replay and CI run after that is free and offline.

## Level 1: unit tests (no key)

```sh
pnpm install
pnpm test
```

52 tests across the engine and CLI. Notable ones:

- `src/judge.test.ts` tests the real `anthropicJudge` by injecting a fake
  `createMessage`, so it verifies the prompt-injection isolation and the
  forced tool-call parsing with no network.
- `src/adapters/http.integration.test.ts` starts a real HTTP server standing in
  for your agent, records a redacted cassette over a real socket, and replays it
  offline. This is the live-capture path, proven without a key.
- `src/redaction.test.ts` and `src/cassette.test.ts` prove redaction is
  fail-closed: a cassette with a residual secret is refused, not written.
- `packages/cli/src/run.test.ts` runs the whole record, baseline, check loop in
  memory and proves the gate flips red on an injected regression and green on
  revert.

## Level 2: the reference agent, end to end (no key)

The demo agent uses a deterministic judge, so the full lifecycle runs key-free.

```sh
cd examples/reference-agent
pnpm replay     # replay the committed cassettes and print the run summary
pnpm check      # diff against the baseline, exit 0 when clean
```

## Level 3: watch the gate catch a regression (no key)

```sh
cd examples/reference-agent
pnpm check                                  # PASS, exit 0

AGENTPROBE_DEMO_REGRESSION=1 pnpm record    # the agent stops calling its booking tool
pnpm check                                  # FAIL, exit 1, names the broken assertions

pnpm record                                 # revert
pnpm check                                  # PASS again, exit 0
```

When the regression is in, `check` prints the cause: `tool-called create_booking:
tool "create_booking" was never called`, and the judge score drops below its
threshold. Two independent signals agree the agent stopped doing its job.

## Level 4: the interactive dashboard (no key)

```sh
pnpm --filter @agentprobe/web seed:db    # seed the local database with run history
pnpm --filter @agentprobe/web dev        # http://localhost:3000
```

The dashboard reads and writes the same SQLite database the CLI uses. "Run suite
now" replays the cassettes and records a new run; "Set as baseline" promotes a
run. Both are key-free (they replay cassettes and read cached judge verdicts).
It renders runs, traces, and trend charts from the live database.

## The real-API path (the one place a key is used)

To run AgentProbe against your own agent with a real judge, write a config:

```ts
// agentprobe.config.ts
import { defineConfig } from "@agentprobe/cli";
import { httpAgent, anthropicJudge } from "@agentprobe/core";
import { suite } from "./suite.js";

export default defineConfig({
  suite,
  cassetteDir: "./cassettes",
  judgeCacheFile: "./judge-cache.json",
  baselineFile: "./baseline.json",
  dbPath: "./data/agentprobe.db",
  // Your live agent over HTTP. The bearer token is read from env at call time.
  liveAgent: () =>
    httpAgent({
      name: "my-agent",
      url: process.env.MY_AGENT_URL!,
      allowlist: ["my-agent.internal"],
      bearerEnvVar: "AGENT_BEARER_TOKEN",
    }),
  // The real judge. Needs ANTHROPIC_API_KEY, used only during record.
  recordJudge: anthropicJudge(),
});
```

Then, once:

```sh
export ANTHROPIC_API_KEY=sk-ant-...      # only for record
export AGENT_BEARER_TOKEN=...            # only for record
agentprobe record --config ./agentprobe.config.ts
agentprobe baseline --config ./agentprobe.config.ts
```

That captures redacted cassettes and real judge verdicts into the cache. From
then on, `agentprobe check` and CI replay them with no key.
