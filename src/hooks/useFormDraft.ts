// Auto-save & Recovery hook. Usage:
//
//   const draft = useFormDraft({ formType: "lesson_plan_edit", recordKey: lesson.id, enabled: editing,
//                                value: { content }, baseHash: hashString(lesson.lesson_content),
//                                onRestore: (p) => setContent(p.content) });
//   ...render <DraftStatus draft={draft} /> and <DraftRecoveryDialog draft={draft} />
//   ...after the form's own submit succeeds:  await draft.markSubmitted();
//
// The hook never submits anything and never touches the real tables.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { DraftSession, clearDraftEverywhere, type DraftRecovery, type DraftSessionState, type DraftStatus } from "@/lib/drafts/draftSession";

export interface UseFormDraftOptions<T> {
  /** Stable identifier of the form, e.g. "student_homework". Must match form_draft_record_visible(). */
  formType: string;
  /** The record the draft belongs to (assignment id, lesson id, ...). Falsy => feature off. */
  recordKey: string | null | undefined;
  /** Turn auto-save on only while the form is actually open/editable. */
  enabled?: boolean;
  /** Current form values. Must be plain JSON (no Files, Dates or functions). */
  value: T;
  /** What the form looks like untouched (e.g. fields filled from server data). Defaults to the value when opened. */
  baseline?: T;
  /** Fingerprint of the server data being edited (hashString(...)); lets us warn if it changed. */
  baseHash?: string | null;
  isEmpty?: (value: T) => boolean;
  /** Apply a recovered payload to the form state. Called only after the user chose Restore. */
  onRestore: (payload: T) => void;
  debounceMs?: number;
}

export interface FormDraft {
  status: DraftStatus;
  lastSavedAt: number | null;
  ready: boolean;
  recovery: DraftRecovery | null;
  restore: () => void;
  discard: () => void;
  /** Call after the real submission succeeded: deletes the draft from the device and the server. */
  markSubmitted: () => Promise<void>;
}

const INITIAL: DraftSessionState = { status: "idle", lastSavedAt: null, recovery: null, ready: false };

export function useFormDraft<T>(opts: UseFormDraftOptions<T>): FormDraft {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const schoolId = profile?.school_id ?? null;
  const active = !!userId && !!opts.recordKey && opts.enabled !== false;

  const [state, setState] = useState<DraftSessionState>(INITIAL);
  const sessionRef = useRef<DraftSession | null>(null);
  const latest = useRef(opts);
  latest.current = opts;

  // One session per (user, form, record) while enabled.
  useEffect(() => {
    if (!active || !userId) { setState(INITIAL); return; }
    let alive = true;
    const o = latest.current;
    const session = new DraftSession(
      {
        userId, schoolId, formType: o.formType, recordKey: o.recordKey as string, debounceMs: o.debounceMs,
        isEmpty: o.isEmpty ? (v) => latest.current.isEmpty!(v as T) : undefined,
        onState: (s) => { if (alive) setState(s); },
      },
      o.baseline ?? o.value,
      o.baseHash ?? null,
    );
    sessionRef.current = session;
    setState(INITIAL);
    void session.init(o.value);
    return () => {
      alive = false;
      session.dispose(); // flushes pending changes (route change / close of the form)
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [active, userId, schoolId, opts.formType, opts.recordKey]);

  // Feed every change (and the moment the session becomes ready) into the session.
  const valueKey = (() => { try { return JSON.stringify(opts.value); } catch { return String(Math.random()); } })();
  const baselineKey = (() => { try { return JSON.stringify(opts.baseline ?? null); } catch { return ""; } })();
  useEffect(() => {
    sessionRef.current?.update(latest.current.value, latest.current.baseHash ?? null, latest.current.baseline);
  }, [valueKey, state.ready, opts.baseHash, baselineKey]);

  const restore = useCallback(() => {
    const payload = sessionRef.current?.acceptRecovery();
    if (payload !== undefined) latest.current.onRestore(payload as T);
  }, []);
  const discard = useCallback(() => { void sessionRef.current?.declineRecovery(); }, []);
  // Bound to the key of the render it was created in, so it still clears the right draft when a handler
  // closes the form (unmounting the session) before calling it.
  const formType = opts.formType;
  const recordKey = opts.recordKey;
  const markSubmitted = useCallback(async () => {
    if (!userId || !recordKey) return;
    const s = sessionRef.current;
    if (s && s.matches(formType, recordKey)) await s.markSubmitted();
    else await clearDraftEverywhere(userId, formType, recordKey);
  }, [userId, formType, recordKey]);

  return { status: state.status, lastSavedAt: state.lastSavedAt, ready: state.ready, recovery: state.recovery, restore, discard, markSubmitted };
}
