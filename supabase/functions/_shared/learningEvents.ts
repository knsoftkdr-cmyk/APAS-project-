// supabase/functions/_shared/learningEvents.ts
//
// One-line telemetry emit for existing edge functions (Real-Time Learning Event Stream).
//
//   await emitLearningEvent(admin, { studentId, eventType: "tutor_message", source: "tutor", payload: { chars: 120 } });
//
// Contract: this NEVER throws and never changes the caller's behaviour. A missing table (migration
// 20261015000000 not applied), a bad value or a network blip is logged once and ignored. `admin` must be a
// service-role client. `studentId` is students.id (not the profile id).
//
// Do not put free text from students in `payload` (chat messages, answers): lengths and ids only.

// deno-lint-ignore-file no-explicit-any

export interface LearningEventInput {
  studentId: string;
  eventType: string;
  source?: string | null;
  refId?: string | null;
  learningObjectiveId?: number | null;
  isCorrect?: boolean | null;
  score?: number | null;
  durationSeconds?: number | null;
  payload?: Record<string, unknown>;
  /** Same key twice = stored once. Use for events that can be re-triggered (e.g. "finish" paths). */
  dedupeKey?: string | null;
  occurredAt?: string | null;
}

const schoolCache = new Map<string, { schoolId: string | null; at: number }>();
const SCHOOL_TTL_MS = 10 * 60 * 1000;
let warnedMissing = false;

async function schoolFor(admin: any, studentId: string): Promise<string | null> {
  const hit = schoolCache.get(studentId);
  if (hit && Date.now() - hit.at < SCHOOL_TTL_MS) return hit.schoolId;
  const { data: s } = await admin.from("students").select("profile_id").eq("id", studentId).maybeSingle();
  let schoolId: string | null = null;
  if (s?.profile_id) {
    const { data: p } = await admin.from("profiles").select("school_id").eq("id", s.profile_id).maybeSingle();
    schoolId = p?.school_id ?? null;
  }
  if (schoolCache.size > 500) schoolCache.clear();
  schoolCache.set(studentId, { schoolId, at: Date.now() });
  return schoolId;
}

export function isMissingTable(err: any): boolean {
  const msg = String(err?.message ?? "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /does not exist|schema cache/i.test(msg);
}

export async function emitLearningEvent(admin: any, e: LearningEventInput): Promise<void> {
  try {
    if (!admin || !e?.studentId || !e.eventType) return;
    const row = {
      student_id: e.studentId,
      school_id: await schoolFor(admin, e.studentId),
      event_type: e.eventType,
      source: e.source ?? null,
      ref_id: e.refId ?? null,
      learning_objective_id: e.learningObjectiveId ?? null,
      is_correct: e.isCorrect ?? null,
      score: e.score ?? null,
      duration_seconds: e.durationSeconds ?? null,
      payload: e.payload ?? {},
      occurred_at: e.occurredAt ?? new Date().toISOString(),
      dedupe_key: e.dedupeKey ?? null,
    };
    const { error } = e.dedupeKey
      ? await admin.from("learning_events").upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true })
      : await admin.from("learning_events").insert(row);
    if (error) {
      if (isMissingTable(error)) {
        if (!warnedMissing) { warnedMissing = true; console.warn("learning_events table not found - apply migration 20261015000000"); }
      } else {
        console.warn("learning event not stored:", error.message);
      }
    }
  } catch (err) {
    console.warn("learning event emit failed:", err instanceof Error ? err.message : err);
  }
}
