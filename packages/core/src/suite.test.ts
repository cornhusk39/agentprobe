import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineSuite } from "./suite.js";

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
            { kind: "output-schema", schema: z.object({ confirmationId: z.string() }) },
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
