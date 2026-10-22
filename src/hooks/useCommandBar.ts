import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import {
  CommandError, isSafeRoute, markReadConfirmView, markReadDoneView, notificationsView, runCommand, toView,
  type CommandParams, type CommandView,
} from "@/lib/commandBar";
import {
  INTENT_BY_ID, cleanCommand, examplesForRole, resolveRules, routeFor,
} from "../../supabase/functions/_shared/commandModel";

export type CommandPhase = "idle" | "thinking" | "ready";

/**
 * Drives the AI Command Bar.
 *
 *  1. The typed sentence is first matched in the browser by the SAME deterministic rules the server uses, so
 *     navigation ("open the timetable") is instant and needs no AI and no network.
 *  2. Anything that needs data goes to the server (`ai-teacher-assistant` / action "command_bar"), which
 *     authenticates the session, re-resolves, re-checks the role and runs a fixed, scoped, read-only lookup.
 *  3. Notification commands run here, because the bell keeps its read state in the browser.
 *
 * Duplicate submissions are blocked while a request is running, and a confirmation can be used only once.
 * Nothing is persisted: no command history is stored anywhere.
 */
export function useCommandBar(onNavigate: (route: string) => void) {
  const { user, profile } = useAuth();
  const { notifications, markAllAsRead } = useNotifications();
  const role = profile?.role ?? null;

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<CommandPhase>("idle");
  const [view, setView] = useState<CommandView | null>(null);

  const busy = useRef(false);        // blocks a second submit while one is in flight
  const confirmed = useRef(false);   // a confirmation may run exactly once
  const token = useRef({ cancelled: false });

  const examples = useMemo(() => examplesForRole(role), [role]);

  const reset = useCallback(() => {
    token.current.cancelled = true;   // an in-flight answer for the old state is discarded
    token.current = { cancelled: false };
    busy.current = false;
    confirmed.current = false;
    setText("");
    setView(null);
    setPhase("idle");
  }, []);

  // Never carry a command, an answer or a pending confirmation over to a different account.
  const userId = user?.id ?? null;
  useEffect(() => { reset(); }, [userId, reset]);

  const show = useCallback((v: CommandView) => {
    confirmed.current = false;
    setView(v);
    setPhase("ready");
  }, []);

  const go = useCallback((route: string | null | undefined) => {
    if (isSafeRoute(route)) onNavigate(route);
  }, [onNavigate]);

  const runClientIntent = useCallback((intentId: string) => {
    if (intentId === "info.notifications_unread") return show(notificationsView(notifications));
    if (intentId === "action.mark_notifications_read") return show(markReadConfirmView(notifications));
  }, [notifications, show]);

  const submit = useCallback(async (raw: string, opts?: { intentId?: string; params?: CommandParams }) => {
    const q = cleanCommand(raw);
    if (!q && !opts?.intentId) return;
    if (busy.current) return;   // duplicate-submission guard

    let intentId = opts?.intentId;
    let params = opts?.params;

    if (intentId) {
      const def = INTENT_BY_ID[intentId];
      if (!def) return;
      if (def.handler === "client") return runClientIntent(intentId);
    } else {
      const r = resolveRules(q, role);
      if (r.status === "forbidden") {
        return show({
          kind: "forbidden",
          message: "That command isn't available for your account.",
          suggestions: examples.map((e) => ({ label: e.text, text: e.text })),
        });
      }
      if (r.status === "ambiguous") {
        return show({
          kind: "clarify",
          message: "I found more than one thing you might mean.",
          followUp: { question: "Which one did you mean?", options: r.candidates.map((c) => ({ label: c.label, intent_id: c.id })) },
        });
      }
      if (r.status === "matched") {
        if (r.intent.handler === "client") return runClientIntent(r.intent.id);
        if (r.intent.kind === "navigate") {
          const route = routeFor(r.intent, role);
          if (isSafeRoute(route)) return go(route);
        }
        intentId = r.intent.id;
        params = r.params;
      }
      // status "none": the server tries the AI fallback.
    }

    busy.current = true;
    const mine = token.current;
    setPhase("thinking");
    setView(null);
    try {
      const resp = await runCommand({ text: q, intentId, params }, mine);
      if (mine.cancelled) return;
      if (resp.status === "navigate") return go(resp.route);
      if (resp.status === "client" && resp.intent) return runClientIntent(resp.intent.id);
      show(toView(resp));
    } catch (e) {
      if (mine.cancelled) return;
      const err = e as CommandError;
      show({
        kind: "error",
        message: err?.message && err.message !== "cancelled" ? err.message : "Something went wrong. Please try again.",
        links: err?.code === "session" ? [{ label: "Sign in again", route: "/login" }] : [],
      });
    } finally {
      if (token.current === mine) busy.current = false;
    }
  }, [role, examples, go, runClientIntent, show]);

  /** Runs the pending browser-side operation. Only reachable from a confirm view, and only once per view. */
  const confirm = useCallback(() => {
    if (!view || view.kind !== "confirm" || confirmed.current) return;
    confirmed.current = true;
    if (view.confirmIntent === "action.mark_notifications_read") {
      const count = notifications.filter((n) => !n.is_read).length;
      markAllAsRead();
      show(markReadDoneView(count));
      confirmed.current = true;
    }
  }, [view, notifications, markAllAsRead, show]);

  const cancel = useCallback(() => { confirmed.current = false; setView(null); setPhase("idle"); }, []);

  return { text, setText, phase, view, examples, submit, confirm, cancel, reset, go };
}
