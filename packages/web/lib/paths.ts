// Server-only path resolution shared by the data and engine modules.

import path from "node:path";
import { existsSync } from "node:fs";

// Locate the reference example by walking up from the working directory, so the
// app works whether started from the web package or the repo root.
export function exampleDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "examples", "reference-agent");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), "..", "..", "examples", "reference-agent");
}

// The committed suite JSON, the single source of truth the CLI also reads. An
// env override makes it testable against a temporary file.
export function suiteFilePath(): string {
  return process.env.AGENTPROBE_SUITE_FILE ?? path.join(exampleDir(), "suite.json");
}
