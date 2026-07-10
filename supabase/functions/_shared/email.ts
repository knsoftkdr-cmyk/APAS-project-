// _shared/email.ts
// Thin adapter around Resend's REST API.

import type { EmailPayload } from "./types.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("RESEND_FROM_ADDRESS") ?? "APAS <notifications@yourdomain.com>";

export async function sendEmail(payload: EmailPayload): Promise<{ id: string }> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [payload.to],
      subject: payload.subject,
      text: payload.body,
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Resend error: ${JSON.stringify(result)}`);
  }
  return result;
}
