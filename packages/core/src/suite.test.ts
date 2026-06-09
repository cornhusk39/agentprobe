import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineSuite, loadSuiteFile, saveSuiteFile } from "./suite.js";

describe("defineSuite", () => {
  it("validates and returns a well-formed suite", () => {
    const suite = defineSuite({
      name: "booking",
      cases: [
        {
          id: "happy-path",
          description: "books an available slot",
          input: { q: "book tuesday 9am" },
          assertions: [
            { kind: "tool-called", tool: "book_slot" },
            { kind: "output-schema", schema: { type: "object", required: ["confirmationId"] } },
          ],
          rubric: { criteria: "confirms the booking clearly", passThreshold: 0.8 },
        },
      ],
    });
    expect(suite.cases).toHaveLength(1);
    // default passThreshold is applied when omitted
    const noThreshold = defineSuite({
      name: "x",
      cases: [{ id: "a", input: {}, rubric: { criteria: "ok" } }],
    });
    expect(noThreshold.cases[0]!.rubric!.passThreshold).toBe(0.7);
  });

  it("rejects case ids that collide on the sanitized cassette filename", () => {
    expect(() =>
      defineSuite({
        name: "collide",
        cases: [
          { id: "a/b", input: {} },
          { id: "a_b", input: {} },
        ],
      }),
    ).toThrow(/same cassette filename/);
  });

  it("rejects duplicate case ids", () => {
    expect(() =>
      defineSuite({
        name: "dupes",
        cases: [
          { id: "a", input: {} },
          { id: "a", input: {} },
        ],
      }),
    ).toThrow(/Duplicate case id/);
  });

  it("rejects an unknown assertion kind", () => {
    expect(() =>
      defineSuite({
        name: "bad",
        // @ts-expect-error deliberately invalid assertion kind
        cases: [{ id: "a", input: {}, assertions: [{ kind: "nope" }] }],
      }),
    ).toThrow();
  });
});

describe("loadSuiteFile / saveSuiteFile", () => {
  const tmp: string[] = [];
  afterEach(async () => {
    for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
  });

  it("round-trips a suite through a JSON file and validates on load", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-suitefile-"));
    tmp.push(dir);
    const file = path.join(dir, "suite.json");
    const suite = defineSuite({
      name: "booking",
      cases: [
        {
          id: "books",
          input: { q: "book tuesday" },
          assertions: [
            { kind: "tool-called", tool: "book_slot" },
            { kind: "output-schema", schema: { type: "object", required: ["confirmationId"] } },
          ],
          rubric: { criteria: "confirms", passThreshold: 0.7 },
        },
      ],
    });

    await saveSuiteFile(file, suite);
    const loaded = await loadSuiteFile(file);
    expect(loaded).toEqual(suite);

    // A hand-corrupted file is rejected on load.
    await fs.writeFile(file, JSON.stringify({ name: "x", cases: [{ id: "a", input: {}, assertions: [{ kind: "nope" }] }] }));
    await expect(loadSuiteFile(file)).rejects.toThrow();
  });
});
