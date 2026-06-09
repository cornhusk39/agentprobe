// Integration test for the authored-suite layer against a real temporary suite
// file. AGENTPROBE_SUITE_FILE is set before the module under test is imported so
// its reads and writes target the temp file.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
let suiteLib: typeof import("./suite");

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-web-"));
  const file = path.join(dir, "suite.json");
  writeFileSync(file, JSON.stringify({ name: "demo", cases: [] }));
  process.env.AGENTPROBE_SUITE_FILE = file;
  suiteLib = await import("./suite");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("authored suite (file-backed)", () => {
  it("saves a case and reads it back, preserving the suite name", () => {
    const result = suiteLib.saveCaseFromJson(
      JSON.stringify({
        id: "c1",
        input: { q: "hi" },
        assertions: [{ kind: "tool-called", tool: "search" }],
        rubric: { criteria: "ok", passThreshold: 0.7 },
      }),
    );
    expect(result.ok).toBe(true);
    expect(suiteLib.activeSuite()).toBe("demo");
    expect(suiteLib.getCase("c1")?.id).toBe("c1");
    expect(suiteLib.listCases()).toHaveLength(1);
  });

  it("exports and round-trips through import", () => {
    const exported = suiteLib.exportSuiteJson();
    expect(JSON.parse(exported).name).toBe("demo");
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

  it("deletes a case", () => {
    suiteLib.deleteCase("c1");
    expect(suiteLib.getCase("c1")).toBeUndefined();
  });

  it("reports a friendly error for non-JSON input", () => {
    const result = suiteLib.importSuiteJson("{not json");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not valid json/i);
  });
});
