// Proves the live capture path works against a real socket, not just a mocked
// fetch: a throwaway HTTP server stands in for "your agent", and the recorder
// captures, redacts, and persists a cassette that then replays and scores
// offline. No API key, no model, no external network. This is the path a user
// runs once with their real agent (and a real judge) to seed cassettes; here
// the judge is deterministic so the whole thing stays key-free.

import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { httpAgent } from "./http.js";
import { record } from "../recorder.js";
import { replayAgent } from "./replay.js";
import { evaluateAssertions, assertionsPassed } from "../assertions.js";
import { readCassette, cassetteFileName } from "../cassette.js";
import type { Assertion } from "../assertions.js";
import type { RunContext } from "../types.js";

const ctx: RunContext = { now: () => 1_700_000_000_000 };

let server: Server | undefined;
const tmp: string[] = [];
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

// A minimal agent endpoint that honors the contract: POST { input } in, a run
// result out. It deliberately echoes a synthetic email into the output so the
// recorder's redaction is exercised on a real response body.
function startAgentServer(): Promise<number> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { input } = JSON.parse(body || "{}");
      const day = (input?.day as string) ?? "tuesday";
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          output: { status: "booked", confirmation: "BK-1", notify: "customer@example.com" },
          trace: [
            { type: "message", role: "user", content: `book ${day}` },
            { type: "tool_call", call: { name: "book_slot", args: { day }, result: { id: "BK-1" } } },
          ],
          metrics: { costUsd: 0.012, steps: 2 },
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

describe("live HTTP capture against a real server", () => {
  it("records a redacted cassette over a real socket and replays it offline", async () => {
    const port = await startAgentServer();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentprobe-http-"));
    tmp.push(dir);

    const agent = httpAgent({
      name: "real-booking",
      url: `http://127.0.0.1:${port}/run`,
      allowlist: ["127.0.0.1"],
    });

    // Capture a live run to a cassette.
    const { result } = await record({
      agent,
      caseId: "live-book",
      input: { day: "tuesday" },
      dir,
      ctx,
    });
    // The live result still has the real value; only the cassette is redacted.
    expect((result.output as { notify: string }).notify).toBe("customer@example.com");

    const cassette = await readCassette(path.join(dir, cassetteFileName("live-book")));
    const serialized = JSON.stringify(cassette);
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).toContain("[REDACTED:email]");

    // Replay the captured cassette offline and score it. Same path CI runs.
    const assertions: Assertion[] = [
      { kind: "tool-called", tool: "book_slot" },
      { kind: "tool-args", tool: "book_slot", args: { day: "tuesday" }, match: "subset" },
      { kind: "cost-budget", maxUsd: 0.05 },
    ];
    const replayed = await replayAgent(cassette).run(cassette.input, ctx);
    expect(assertionsPassed(evaluateAssertions(replayed, assertions))).toBe(true);
  });

  it("refuses an endpoint that is not on the allowlist", () => {
    // The adapter rejects at construction, before any socket opens.
    expect(() =>
      httpAgent({ name: "x", url: "http://169.254.169.254/latest/meta-data", allowlist: ["127.0.0.1"] }),
    ).toThrow();
  });
});
