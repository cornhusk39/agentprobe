// The demo judge. In a real project this would be the Anthropic judge scoring
// against the rubric; for the public demo it is a deterministic heuristic so the
// whole flow records, replays, and gates with no API key and no variance. It
// rewards a complete, on-task response and penalizes a vague non-answer, which
// is exactly the regression the gate needs to catch.

import { scriptedJudge } from "@agentprobe/core";
import type { BookingOutput } from "./agent.js";

export const demoJudge = scriptedJudge((req) => {
  const out = req.output as Partial<BookingOutput> | null;
  const message = String(out?.message ?? "");

  if (out?.status === "booked" && out.confirmationId) {
    return { score: 0.92, rationale: "Completed the booking and returned a confirmation reference." };
  }
  if (out?.status === "unavailable" && /soonest|no openings/i.test(message)) {
    return { score: 0.85, rationale: "Declined gracefully and pointed to the next available day." };
  }
  if (out?.status === "info" && (out.slots !== undefined || out.property !== undefined)) {
    return { score: 0.88, rationale: "Answered the query with the requested details." };
  }
  // A vague, taskless reply: helpful-sounding but it did nothing.
  return { score: 0.45, rationale: "Did not complete the task or provide the requested information." };
});
