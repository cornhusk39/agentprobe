import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      // Resolve the workspace engine to its source so these tests do not require
      // a build, matching the CLI package's setup.
      "@agentprobe/core": path.resolve(here, "../core/src/index.ts"),
    },
  },
});
