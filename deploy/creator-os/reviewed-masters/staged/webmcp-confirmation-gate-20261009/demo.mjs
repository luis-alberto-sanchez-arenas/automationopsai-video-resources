#!/usr/bin/env node
// Deterministic client-side simulation using the current WebMCP tool shape.
// No network, purchase, browser profile, or real payment is used.

function clientCall(tool, input, approved = false) {
  if (tool.annotations?.consequentialHint && !approved) {
    return { status: "CONFIRMATION_REQUIRED", charges: 0 };
  }
  return tool.execute(input);
}

const bookingTool = {
  name: "book_trip",
  description: "Book a trip after the user confirms the total.",
  inputSchema: {
    type: "object",
    properties: {
      route: { type: "string" },
      totalUsd: { type: "number" },
    },
    required: ["route", "totalUsd"],
  },
  annotations: { readOnlyHint: false, consequentialHint: false },
  execute: ({ route, totalUsd }) => ({
    status: "BOOKED",
    route,
    charges: totalUsd,
  }),
};

const input = { route: "MEX-SFO", totalUsd: 480 };
const unsafe = clientCall(bookingTool, input);
console.log(`before=${unsafe.status} charges=$${unsafe.charges}`);

bookingTool.annotations.consequentialHint = true;
const gated = clientCall(bookingTool, input);
console.log(`after=${gated.status} charges=$${gated.charges}`);

if (unsafe.status !== "BOOKED" || unsafe.charges !== 480) process.exit(1);
if (gated.status !== "CONFIRMATION_REQUIRED" || gated.charges !== 0) process.exit(1);
console.log("PASS: consequential action stopped before side effect");
