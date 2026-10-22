import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import type { CommandParams } from "../../supabase/functions/_shared/commandModel";

// AI Command Bar - client helpers. Served by the already-deployed `ai-teacher-assistant` function via
// action "command_bar" (no new edge function). Keep the response shape in sync with
// supabase/functions/_shared/handlers/commandBar.ts (CommandResponse).
//
// The browser sends ONLY the typed sentence (and, when the user clicked an option, an intent id + class/section).
// It never sends a role, user id or school id; the server derives those from the session.

export type { CommandParams };

export interface CommandResponse {
  status: "answer" | "navigate" | "preview" | "clarify" | "unsupported" | "forbidden" | "none" | "client" | "error";
  intent?: { id: string; kind: string; label: string };
  interpreted_by?: "rules" | "ai";
  message: string;
  facts?: { label: string; value: string }[];
  rows?: { title: string; subtitle?: string; route?: string }[];
  note?: string;
  links?: { label: string; route: string }[];
  route?: string;
  preview?: {
    title: string;
    lines: { label: string; value: string }[];
    consequences: string[];
    handoff?: { label: string; route: string };
  };
  followUp?: { question: string; options: { label: string; intent_id: string; params?: CommandParams }[] };
  params?: CommandParams;
  suggestions?: { label: string; route?: string; text?: string }[];
}

/** What the dialog renders. Server responses and browser-side answers both become a View. */
export interface CommandView extends Omit<CommandResponse, "status"> {
  kind: "answer" | "preview" | "clarify" | "unsupported" | "forbidden" | "none" | "error" | "confirm" | "done";
  /** confirm only: the browser-side operation to run when (and only when) the user confirms. */
  confirmIntent?: string;
}

export class CommandError extends Error {
  code: "session" | "timeout" | "network" | "server";
  constructor(message: string, code: "session" | "timeout" | "network" | "server") {
    super(message);
    this.code = code;
  }
}

export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Defence in depth: only ever navigate to an in-app path. A tampered or buggy response must never be able to send
 * the user to another site or a script URL.
 */
export function isSafeRoute(route: unknown): route is string {
  return (
    typeof route === "string" &&
    route.length > 0 &&
    route.length < 200 &&
    route.startsWith("/") &&
    !route.startsWith("//") &&
    !route.includes("\\") &&
    !/^\/[a-z][a-z0-9+.-]*:/i.test(route) &&
    !/[\u0000-\u001f]/.test(route)
  );
}

/** The user's LOCAL calendar date, so "today" is right near midnight in India. The server sanity-checks it. */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function toView(r: CommandResponse): CommandView {
  const { status, ...rest } = r;
  // "navigate" and "client" are handled before rendering; if one reaches here, show it as a plain answer.
  const kind = status === "navigate" || status === "client" ? "answer" : status;
  return { ...rest, kind };
}

export interface RunInput {
  text: string;
  intentId?: string;
  params?: CommandParams;
}

export async function runCommand(input: RunInput, signal?: { cancelled: boolean }): Promise<CommandResponse> {
  const body: Record<string, unknown> = { action: "command_bar", text: input.text, local_date: localDate() };
  if (input.intentId) body.intent_id = input.intentId;
  if (input.params) body.params = input.params;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CommandError("This is taking longer than expected. Please try again.", "timeout")), REQUEST_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([
      supabase.functions.invoke("ai-teacher-assistant", { body }),
      timeout,
    ]);
    if (signal?.cancelled) throw new CommandError("cancelled", "server");
    if (error) {
      const status = (error as { context?: Response }).context?.status;
      const { message } = await unwrapFunctionError(error, "Something went wrong. Please try again.");
      if (status === 401) throw new CommandError("Your session has expired. Please sign in again.", "session");
      if (!status) throw new CommandError("Couldn't reach the server. Check your connection and try again.", "network");
      throw new CommandError(message, "server");
    }
    if (!data || typeof data !== "object" || typeof (data as CommandResponse).status !== "string") {
      throw new CommandError("Unexpected response. Please try again.", "server");
    }
    return data as CommandResponse;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─────────────────────── notification commands (answered in the browser) ───────────────────────
// The bell keeps its read state in React, not in the database, so only the browser can answer these truthfully.

export interface BellNotification { id: string; title: string; is_read: boolean; created_at: string }

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function notificationsView(list: BellNotification[]): CommandView {
  const unread = list.filter((n) => !n.is_read);
  if (unread.length === 0) return { kind: "answer", message: "You have no unread notifications." };
  return {
    kind: "answer",
    message: `You have ${plural(unread.length, "unread notification")}.`,
    rows: unread.slice(0, 5).map((n) => ({ title: n.title, subtitle: String(n.created_at).slice(0, 10) })),
    note: "These are the notifications shown in the bell at the top of the page.",
  };
}

export function markReadConfirmView(list: BellNotification[]): CommandView {
  const n = list.filter((x) => !x.is_read).length;
  if (n === 0) return { kind: "answer", message: "You have no unread notifications to mark as read." };
  return {
    kind: "confirm",
    confirmIntent: "action.mark_notifications_read",
    message: "Please confirm.",
    preview: {
      title: "Mark notifications as read",
      lines: [
        { label: "Target", value: "Your own notifications only" },
        { label: "Unread now", value: String(n) },
      ],
      consequences: [
        `${plural(n, "notification")} will be marked as read and removed from the bell on this device.`,
        "Nothing is deleted and nobody else is affected.",
      ],
    },
  };
}

export function markReadDoneView(count: number): CommandView {
  return { kind: "done", message: `Marked ${plural(count, "notification")} as read.` };
}
