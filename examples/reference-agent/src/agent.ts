// The reference agent. It is a clean-room twin of a real home-service booking
// agent, built with mock tools so it can run with no external calls and no real
// data. It is deliberately deterministic: given an input it always produces the
// same trace and output, which is what lets a recorded cassette be replayed and
// scored forever. In production you would point AgentProbe's HTTP adapter at the
// real agent; here the same Agent interface is satisfied in process.

import { defineAgent, type AgentRunResult, type ToolCall, type TraceStep } from "@agentprobe/core";
import { AVAILABILITY, PROPERTIES, confirmationFor } from "./data.js";

// The structured request the agent accepts. A real agent would parse natural
// language; this one takes an explicit intent so the demo stays deterministic
// and the focus stays on the harness, not on NLP.
export interface BookingInput {
  intent: "book" | "availability" | "property";
  day?: string;
  address?: string;
  service?: string;
  customer?: { name: string; phone: string };
}

export interface BookingOutput {
  status: "booked" | "unavailable" | "info";
  message: string;
  confirmationId?: string;
  slots?: string[];
  property?: { type: string; lastService: string };
}

// Build a tool-call trace step, recording the result so the dashboard's
// tool-call view shows both the arguments and what came back.
function call(name: string, args: Record<string, unknown>, result: unknown): TraceStep {
  const toolCall: ToolCall = { name, args, result };
  return { type: "tool_call", call: toolCall };
}

// Cost and latency are modeled from the amount of work (steps), so a flow that
// calls more tools costs and takes more, the way a real agent would. This makes
// the budget assertions and the cost and latency trend charts meaningful.
function metrics(steps: TraceStep[]): AgentRunResult["metrics"] {
  const toolCalls = steps.filter((s) => s.type === "tool_call").length;
  return {
    latencyMs: 180 + toolCalls * 160,
    costUsd: Number((0.002 + toolCalls * 0.0035).toFixed(4)),
    steps: steps.length,
    inputTokens: 120 + toolCalls * 40,
    outputTokens: 60 + toolCalls * 30,
  };
}

function handle(input: BookingInput): { output: BookingOutput; trace: TraceStep[] } {
  const trace: TraceStep[] = [
    { type: "message", role: "user", content: JSON.stringify(input) },
  ];

  if (input.intent === "availability") {
    const day = (input.day ?? "").toLowerCase();
    const slots = AVAILABILITY[day] ?? [];
    trace.push(call("check_availability", { day }, { slots }));
    const output: BookingOutput = {
      status: "info",
      message: slots.length ? `Open slots on ${day}: ${slots.join(", ")}.` : `No openings on ${day}.`,
      slots,
    };
    trace.push({ type: "message", role: "assistant", content: output.message });
    return { output, trace };
  }

  if (input.intent === "property") {
    const address = (input.address ?? "").toLowerCase();
    const record = PROPERTIES[address];
    trace.push(call("lookup_property", { address }, record ?? null));
    const output: BookingOutput = record
      ? {
          status: "info",
          message: `${address} is a ${record.type}; last serviced ${record.lastService}.`,
          property: { type: record.type, lastService: record.lastService },
        }
      : { status: "info", message: `No property record for ${address}.` };
    trace.push({ type: "message", role: "assistant", content: output.message });
    return { output, trace };
  }

  // intent === "book"
  const day = (input.day ?? "").toLowerCase();
  if (input.customer) {
    // The CRM step echoes customer PII into the trace on purpose, so the
    // recorder's redaction is exercised on every booking cassette.
    trace.push(
      call(
        "crm_upsert_customer",
        { name: input.customer.name, phone: input.customer.phone },
        { customerId: "C-501" },
      ),
    );
  }
  const slots = AVAILABILITY[day] ?? [];
  trace.push(call("check_availability", { day }, { slots }));

  if (slots.length === 0) {
    // No availability: decline gracefully and suggest the next open day rather
    // than booking anything. The suite asserts no booking happens here.
    const alternative = Object.entries(AVAILABILITY).find(([, s]) => s.length > 0)?.[0];
    const output: BookingOutput = {
      status: "unavailable",
      message: `No openings on ${day}.${alternative ? ` The soonest is ${alternative}.` : ""}`,
    };
    trace.push({ type: "message", role: "assistant", content: output.message });
    return { output, trace };
  }

  const slot = slots[0]!;
  const confirmationId = confirmationFor(slot);
  trace.push(call("create_booking", { slot, service: input.service ?? "general" }, { confirmationId }));
  const output: BookingOutput = {
    status: "booked",
    message: `Booked ${input.service ?? "a visit"} for ${slot}. Confirmation ${confirmationId}.`,
    confirmationId,
  };
  trace.push({ type: "message", role: "assistant", content: output.message });
  return { output, trace };
}

export const referenceAgent = defineAgent("home-service-booking", (input) => {
  const { output, trace } = handle(input as BookingInput);
  return { output, trace, metrics: metrics(trace) };
});

// A deliberately broken variant used to demonstrate the CI gate catching a
// regression: it skips the booking tool and never returns a confirmation, the
// classic "agent changed and silently stopped completing the task" failure.
export const regressedAgent = defineAgent("home-service-booking", (input) => {
  const i = input as BookingInput;
  if (i.intent !== "book") return referenceAgent.run(input, { now: () => 0 });
  const trace: TraceStep[] = [
    { type: "message", role: "user", content: JSON.stringify(i) },
    call("check_availability", { day: (i.day ?? "").toLowerCase() }, { slots: [] }),
    { type: "message", role: "assistant", content: "Let me look into that and get back to you." },
  ];
  return {
    output: { status: "info", message: "Let me look into that and get back to you." } as BookingOutput,
    trace,
    metrics: metrics(trace),
  };
});
