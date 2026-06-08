import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SuiteStore } from "./suiteStore.js";
import type { Case } from "./suite.js";

const tmp: string[] = [];
async function tmpDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-suite-"));
  tmp.push(dir);
  return path.join(dir, "suite.db");
}
afterEach(async () => {
  for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const sampleCase: Case = {
  id: "books-slot",
  input: { intent: "book", day: "tuesday" },
  assertions: [
    { kind: "tool-called", tool: "create_booking" },
    { kind: "output-field", path: "status", op: "equals", value: "booked" },
    { kind: "cost-budget", maxUsd: 0.02 },
  ],
  rubric: { criteria: "confirms the booking", passThreshold: 0.7 },
};

describe("SuiteStore", () => {
  it("upserts and materializes an authored suite", async () => {
    const store = new SuiteStore(await tmpDb());
    store.upsertSuite("booking", "2026-06-08T00:00:00.000Z");
    store.upsertCase("booking", sampleCase);
    store.upsertCase("booking", { id: "lists", input: { intent: "availability" }, assertions: [] });

    const suite = store.materialize("booking");
    expect(suite.name).toBe("booking");
    expect(suite.cases.map((c) => c.id)).toEqual(["books-slot", "lists"]);
    // assertions round-trip, including the serializable output-field kind
    expect(suite.cases[0]!.assertions).toHaveLength(3);
    store.close();
  });

  it("updates a case in place and deletes it", async () => {
    const store = new SuiteStore(await tmpDb());
    store.upsertSuite("booking", "2026-06-08T00:00:00.000Z");
    store.upsertCase("booking", sampleCase);

    // Edit: tighten the budget.
    store.upsertCase("booking", {
      ...sampleCase,
      assertions: [{ kind: "cost-budget", maxUsd: 0.005 }],
    });
    const edited = store.getCase("booking", "books-slot")!;
    expect(edited.assertions).toEqual([{ kind: "cost-budget", maxUsd: 0.005 }]);

    store.deleteCase("booking", "books-slot");
    expect(store.getCase("booking", "books-slot")).toBeUndefined();
    store.close();
  });

  it("rejects a case with an invalid assertion on write", async () => {
    const store = new SuiteStore(await tmpDb());
    store.upsertSuite("booking", "2026-06-08T00:00:00.000Z");
    expect(() =>
      // @ts-expect-error invalid assertion kind on purpose
      store.upsertCase("booking", { id: "bad", input: {}, assertions: [{ kind: "nope" }] }),
    ).toThrow();
    store.close();
  });
});
