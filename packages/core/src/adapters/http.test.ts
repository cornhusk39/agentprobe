import { describe, it, expect, vi } from "vitest";
import {
  httpAgent,
  EndpointNotAllowedError,
  ResponseTooLargeError,
  UnexpectedRedirectError,
  HttpStatusError,
} from "./http.js";
import type { RunContext } from "../types.js";

const noSleep = () => Promise.resolve();

// A context whose clock returns scripted values so measured latency is exact.
function scriptedCtx(times: number[]): RunContext {
  let i = 0;
  return { now: () => times[Math.min(i++, times.length - 1)]! };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("httpAgent security controls", () => {
  it("refuses construction for an off-allowlist host", () => {
    expect(() =>
      httpAgent({ name: "x", url: "https://evil.example.com/run", allowlist: ["localhost"] }),
    ).toThrow(EndpointNotAllowedError);
  });

  it("does not follow redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302 }));
    const agent = httpAgent({
      name: "x",
      url: "http://localhost:4000/run",
      allowlist: ["localhost"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(agent.run({}, scriptedCtx([0, 1]))).rejects.toThrow(UnexpectedRedirectError);
  });

  it("aborts a response that exceeds the byte cap", async () => {
    const big = "x".repeat(5000);
    const fetchImpl = vi.fn(async () => jsonResponse({ output: big, trace: [] }));
    const agent = httpAgent({
      name: "x",
      url: "http://localhost:4000/run",
      allowlist: ["localhost"],
      maxResponseBytes: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(agent.run({}, scriptedCtx([0, 1]))).rejects.toThrow(ResponseTooLargeError);
  });
});

describe("httpAgent happy path", () => {
  it("maps a contract response and fills latency from the clock", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        output: "ok",
        trace: [{ type: "tool_call", call: { name: "book", args: { day: "tue" } } }],
        metrics: { costUsd: 0.02, steps: 1 },
      }),
    );
    const agent = httpAgent({
      name: "booking",
      url: "http://localhost:4000/run",
      allowlist: ["localhost"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await agent.run({ q: "availability" }, scriptedCtx([1000, 1150]));
    expect(result.output).toBe("ok");
    // latency was not in the response, so it comes from the measured clock delta
    expect(result.metrics.latencyMs).toBe(150);
    expect(result.metrics.costUsd).toBe(0.02);
    expect(result.metrics.steps).toBe(1);
  });

  it("sends a bearer token sourced from env, never from config", async () => {
    process.env.TEST_AGENT_TOKEN = "fake-token-value-123";
    let seenAuth: string | undefined;
    const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
      seenAuth = (init.headers as Record<string, string>)["authorization"];
      return jsonResponse({ output: "ok", trace: [] });
    });
    const agent = httpAgent({
      name: "booking",
      url: "http://localhost:4000/run",
      allowlist: ["localhost"],
      bearerEnvVar: "TEST_AGENT_TOKEN",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await agent.run({}, scriptedCtx([0, 1]));
    expect(seenAuth).toBe("Bearer fake-token-value-123");
    delete process.env.TEST_AGENT_TOKEN;
  });
});

describe("httpAgent retry", () => {
  it("retries a transient network error and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError("network down");
      return jsonResponse({ output: "ok", trace: [] });
    });
    const agent = httpAgent({
      name: "x",
      url: "http://localhost:4000/run",
      allowlist: ["localhost"],
      retries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    const result = await agent.run({}, scriptedCtx([0, 1, 2, 3]));
    expect(result.output).toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries a 5xx and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls === 1 ? new Response("err", { status: 503 }) : jsonResponse({ output: "ok", trace: [] });
    });
    const agent = httpAgent({
      name: "x",
      url: "http://localhost:4000/run",
      allowlist: ["localhost"],
      retries: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    const result = await agent.run({}, scriptedCtx([0, 1, 2, 3]));
    expect(result.output).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry a 4xx client error", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response("bad", { status: 400 });
    });
    const agent = httpAgent({
      name: "x",
      url: "http://localhost:4000/run",
      allowlist: ["localhost"],
      retries: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    await expect(agent.run({}, scriptedCtx([0, 1]))).rejects.toBeInstanceOf(HttpStatusError);
    // a 4xx is deterministic, so it is attempted exactly once
    expect(calls).toBe(1);
  });

  it("does not retry a redirect even with retries enabled", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response(null, { status: 302 });
    });
    const agent = httpAgent({
      name: "x",
      url: "http://localhost:4000/run",
      allowlist: ["localhost"],
      retries: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    await expect(agent.run({}, scriptedCtx([0, 1]))).rejects.toThrow(UnexpectedRedirectError);
    expect(calls).toBe(1);
  });

  it("gives up after exhausting retries", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      throw new TypeError("network down");
    });
    const agent = httpAgent({
      name: "x",
      url: "http://localhost:4000/run",
      allowlist: ["localhost"],
      retries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    await expect(agent.run({}, scriptedCtx([0, 1]))).rejects.toThrow("network down");
    // initial attempt plus two retries
    expect(calls).toBe(3);
  });
});
