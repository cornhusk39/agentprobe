// The primary adapter. It calls a real agent over HTTP to capture a run. Live
// HTTP is opt-in and only used to record or refresh a cassette; CI never calls
// it. Because the endpoint is untrusted from this process's point of view, the
// adapter enforces the threat-model controls directly: an endpoint allowlist, a
// bearer token sourced from env (never an argument that could be logged), a
// response timeout, a hard size cap, and no following of redirects.

import { z } from "zod";
import type { Agent } from "../agent.js";
import {
  agentRunResultSchema,
  runMetricsSchema,
  traceStepSchema,
  type AgentInput,
  type AgentRunResult,
  type RunContext,
} from "../types.js";

// The contract an agent endpoint must satisfy. The result shape is the core
// run result, but metrics are accepted partially because the transport can fill
// in latency itself and derive step count from the trace.
const httpResponseSchema = z.object({
  output: z.unknown(),
  trace: z.array(traceStepSchema).default([]),
  metrics: runMetricsSchema.partial().optional(),
});

export interface HttpAgentOptions {
  name: string;
  url: string;
  // Allowed hostnames. A request to any host not on this list is refused before
  // a socket is opened. Required: there is no implicit "allow all".
  allowlist: string[];
  // Name of the env var holding the bearer token. The token is read at call
  // time, so it never sits in a config object that might be serialized.
  bearerEnvVar?: string;
  // Caps. Sensible defaults; override per agent if needed.
  timeoutMs?: number;
  maxResponseBytes?: number;
  // Optional mapper for agents whose JSON does not already match the contract.
  mapResponse?: (body: unknown) => unknown;
  // Injected for testing. Defaults to global fetch.
  fetchImpl?: typeof fetch;
}

export class EndpointNotAllowedError extends Error {
  constructor(host: string) {
    super(`Endpoint host "${host}" is not on the allowlist. Refusing to send.`);
    this.name = "EndpointNotAllowedError";
  }
}

export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`Agent response exceeded the ${limit} byte cap. Aborted.`);
    this.name = "ResponseTooLargeError";
  }
}

export class UnexpectedRedirectError extends Error {
  constructor(status: number) {
    super(`Agent endpoint returned a redirect (${status}). Redirects are not followed.`);
    this.name = "UnexpectedRedirectError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 2_000_000;

function assertAllowed(url: URL, allowlist: string[]): void {
  if (!allowlist.includes(url.hostname)) {
    throw new EndpointNotAllowedError(url.hostname);
  }
}

// Read a response body with a hard byte cap, aborting as soon as the cap is
// exceeded rather than after buffering an unbounded payload.
async function readCapped(res: Response, limit: number): Promise<string> {
  const body = res.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ResponseTooLargeError(limit);
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function httpAgent(options: HttpAgentOptions): Agent {
  const {
    name,
    url,
    allowlist,
    bearerEnvVar,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_BYTES,
    mapResponse,
    fetchImpl = fetch,
  } = options;

  const parsed = new URL(url);
  // Fail fast at construction if the configured URL is off-allowlist; no point
  // building an agent that can never legally call out.
  assertAllowed(parsed, allowlist);

  return {
    name,
    async run(input: AgentInput, ctx: RunContext): Promise<AgentRunResult> {
      // Re-check at call time in case the URL object was tampered with.
      assertAllowed(parsed, allowlist);

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (bearerEnvVar) {
        const token = process.env[bearerEnvVar];
        if (token) headers["authorization"] = `Bearer ${token}`;
      }

      // Compose our own timeout with any caller-provided abort signal.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      ctx.signal?.addEventListener("abort", onAbort, { once: true });

      const started = ctx.now();
      try {
        const res = await fetchImpl(parsed, {
          method: "POST",
          headers,
          body: JSON.stringify({ input }),
          // Never chase a redirect to a host that might not be on the allowlist.
          redirect: "manual",
          signal: controller.signal,
        });

        // redirect: "manual" surfaces 3xx as an opaque response or a real
        // status; treat any redirect status as a hard error.
        if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
          throw new UnexpectedRedirectError(res.status);
        }
        if (!res.ok) {
          throw new Error(`Agent endpoint returned HTTP ${res.status}`);
        }

        const text = await readCapped(res, maxResponseBytes);
        const json: unknown = text ? JSON.parse(text) : {};
        const mapped = mapResponse ? mapResponse(json) : json;
        const body = httpResponseSchema.parse(mapped);

        const latencyMs = ctx.now() - started;
        // Trust the agent for cost and tokens; fill latency from our own
        // measurement and step count from the trace when the agent omits them.
        const result: AgentRunResult = {
          output: body.output,
          trace: body.trace,
          metrics: {
            latencyMs: body.metrics?.latencyMs ?? latencyMs,
            costUsd: body.metrics?.costUsd ?? 0,
            steps: body.metrics?.steps ?? body.trace.length,
            inputTokens: body.metrics?.inputTokens,
            outputTokens: body.metrics?.outputTokens,
          },
        };
        return agentRunResultSchema.parse(result);
      } finally {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
