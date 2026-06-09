// Integration test for the authored-suite layer against a real temporary
// database. The database path is taken from AGENTPROBE_DB_PATH, set before the
// module under test is imported so its lazily-opened connection points here.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
// Imported dynamically in beforeAll, after the env var is set.
let suiteLib: typeof import("./suite");

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-web-"));
  process.env.AGENTPROBE_DB_PATH = path.join(dir, "test.db");
  suiteLib = await import("./suite");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("authored suite import/export", () => {
  it("round-trips a suite through export and import", () => {
    const seed = JSON.stringify({
      name: "anything",
      cases: [
        {
          id: "c1",
          input: { q: "hi" },
          assertions: [{ kind: "tool-called", tool: "search" }],
          rubric: { criteria: "ok", passThreshold: 0.7 },
        },
      ],
    });
    expect(suiteLib.importSuiteJson(seed).ok).toBe(true);

    const exported = suiteLib.exportSuiteJson();
    expect(JSON.parse(exported).cases.map((c: { id: string }) => c.id)).toContain("c1");
    // re-importing the export is a no-op upsert, still valid
    expect(suiteLib.importSuiteJson(exported).ok).toBe(true);
  });

  it("rejects a malformed import atomically, leaving the suite unchanged", () => {
    const before = suiteLib.listCases().length;
    const bad = JSON.stringify({
      name: "x",
      cases: [
        { id: "good-new", input: {}, assertions: [] },
        { id: "bad", input: {}, assertions: [{ kind: "not-a-real-kind" }] },
      ],
    });
    const result = suiteLib.importSuiteJson(bad);
    expect(result.ok).toBe(false);
    // The valid case from the rejected batch must NOT have been persisted.
    expect(suiteLib.getCase("good-new")).toBeUndefined();
    expect(suiteLib.listCases().length).toBe(before);
  });

  it("reports a friendly error for non-JSON input", () => {
    const result = suiteLib.importSuiteJson("{not json");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not valid json/i);
  });
});
