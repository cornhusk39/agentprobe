// Project config the CLI loads. It wires the suite, the demo judge, and the
// paths for cassettes, the judge cache, the baseline, and the local database.
// Paths are resolved relative to this file so the commands work from any cwd.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@agentprobe/cli";
import { suite } from "./src/suite.js";
import { referenceAgent, regressedAgent } from "./src/agent.js";
import { demoJudge } from "./src/judge.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Flip to the broken agent by setting AGENTPROBE_DEMO_REGRESSION=1. This is how
// the README and CI demonstrate the gate catching a regression: record with the
// flag on, run check, watch it fail, unset it, record again, watch it pass.
const useRegressed = process.env.AGENTPROBE_DEMO_REGRESSION === "1";

export default defineConfig({
  suite,
  cassetteDir: path.join(here, "cassettes"),
  judgeCacheFile: path.join(here, "judge-cache.json"),
  baselineFile: path.join(here, "baseline.json"),
  dbPath: path.join(here, "data", "agentprobe.db"),
  liveAgent: () => (useRegressed ? regressedAgent : referenceAgent),
  recordJudge: demoJudge,
});
