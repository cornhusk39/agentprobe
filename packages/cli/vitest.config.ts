import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      // Resolve the workspace dependency to its source during tests, so the CLI
      // tests do not require core to be built first.
      "@agentprobe/core": path.resolve(here, "../core/src/index.ts"),
    },
  },
});
