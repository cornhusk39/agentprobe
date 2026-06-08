// Synthetic data for the mock tools. None of this is real: it is a clean-room
// stand-in for a production home-service business, so the public demo never
// touches client data. Names, addresses, and phone numbers are invented.

export interface PropertyRecord {
  id: string;
  type: string;
  lastService: string;
}

// Availability by weekday. Wednesday is intentionally empty so the suite can
// cover the "no slots, offer an alternative" path.
export const AVAILABILITY: Record<string, string[]> = {
  monday: ["mon-8am", "mon-2pm"],
  tuesday: ["tue-9am", "tue-1pm", "tue-4pm"],
  wednesday: [],
  thursday: ["thu-10am"],
  friday: ["fri-9am", "fri-3pm"],
};

export const PROPERTIES: Record<string, PropertyRecord> = {
  "12 oak st": { id: "P-100", type: "single-family home", lastService: "2026-02-11" },
  "440 birch ave": { id: "P-205", type: "duplex", lastService: "2026-05-03" },
};

// The next confirmation number is derived from the slot so the agent stays a
// pure function of its input, which keeps recorded cassettes reproducible.
export function confirmationFor(slot: string): string {
  let sum = 0;
  for (const ch of slot) sum = (sum + ch.charCodeAt(0)) % 9000;
  return `BK-${1000 + sum}`;
}
