// The suite for the reference agent. Each case pairs a request with the
// behavior we expect: which tools must fire, what the output must look like, the
// budgets it must stay under, and a rubric for the judge. These cases are the
// regression contract; a change that breaks any of them turns CI red.

import { defineSuite } from "@agentprobe/core";
import { z } from "zod";

export const suite = defineSuite({
  name: "home-service-booking",
  cases: [
    {
      id: "books-available-slot",
      description: "Books the first open slot on a day that has availability.",
      input: {
        intent: "book",
        day: "tuesday",
        service: "plumbing",
        // Synthetic PII: a reserved 555 number, redacted in the cassette.
        customer: { name: "Pat Rivera", phone: "512-555-0142" },
      },
      assertions: [
        { kind: "tool-called", tool: "crm_upsert_customer" },
        { kind: "tool-called", tool: "create_booking" },
        // The booking flow must look up the customer and check availability
        // before it books, in that order.
        { kind: "tool-call-order", tools: ["crm_upsert_customer", "check_availability", "create_booking"] },
        { kind: "tool-args", tool: "create_booking", args: { service: "plumbing" }, match: "subset" },
        { kind: "output-schema", schema: z.object({ status: z.literal("booked"), confirmationId: z.string() }) },
        { kind: "cost-budget", maxUsd: 0.02 },
        { kind: "step-budget", maxSteps: 6 },
      ],
      rubric: { criteria: "Completes the booking and returns a confirmation reference.", passThreshold: 0.7 },
    },
    {
      id: "declines-when-no-availability",
      description: "On a fully booked day, declines without booking and offers an alternative.",
      input: { intent: "book", day: "wednesday", service: "hvac", customer: { name: "Sam Lee", phone: "512-555-0199" } },
      assertions: [
        { kind: "tool-called", tool: "check_availability" },
        // Assert directly that it did not book, rather than inferring it from
        // the output shape.
        { kind: "tool-not-called", tool: "create_booking" },
        { kind: "output-schema", schema: z.object({ status: z.literal("unavailable") }) },
        { kind: "cost-budget", maxUsd: 0.02 },
      ],
      rubric: { criteria: "Declines gracefully without booking and suggests the next open day.", passThreshold: 0.7 },
    },
    {
      id: "lists-availability",
      description: "Answers an availability query with the open slots.",
      input: { intent: "availability", day: "tuesday" },
      assertions: [
        { kind: "tool-called", tool: "check_availability" },
        { kind: "output-schema", schema: z.object({ status: z.literal("info"), slots: z.array(z.string()) }) },
        { kind: "latency-budget", maxMs: 600 },
      ],
      rubric: { criteria: "Lists the open slots for the requested day.", passThreshold: 0.7 },
    },
    {
      id: "reports-property-history",
      description: "Looks up a property and reports its type and last service date.",
      input: { intent: "property", address: "12 Oak St" },
      assertions: [
        { kind: "tool-called", tool: "lookup_property" },
        {
          kind: "output-schema",
          schema: z.object({ property: z.object({ type: z.string(), lastService: z.string() }) }),
        },
        { kind: "cost-budget", maxUsd: 0.02 },
      ],
      rubric: { criteria: "Reports the property type and its last service date.", passThreshold: 0.7 },
    },
  ],
});
