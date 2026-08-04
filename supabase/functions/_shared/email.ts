// _shared/email.ts
// SMTP adapter using Hostinger mailbox via denomailer.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import type { EmailPayload } from "./types.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST")!;
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USERNAME = Deno.env.get("SMTP_USERNAME")!;
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD")!;
const FROM_ADDRESS = Deno.env.get("SMTP_FROM_ADDRESS") ?? `APAS <${SMTP_USERNAME}>`;

export async function sendEmail(payload: EmailPayload): Promise<{ id: string }> {
  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: true,
      auth: {
        username: SMTP_USERNAME,
        password: SMTP_PASSWORD,
      },
    },
  });

  try {
    await client.send({
      from: FROM_ADDRESS,
      to: payload.to,
      subject: payload.subject,
      content: payload.body,
      attachments: (payload.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content,
        encoding: "base64",
      })),
    });
  } finally {
    await client.close();
  }

  return { id: "smtp-sent" };
}