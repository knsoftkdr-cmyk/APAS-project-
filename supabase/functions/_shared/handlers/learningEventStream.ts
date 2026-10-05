// supabase/functions/_shared/handlers/learningEventStream.ts
//
// Real-Time Learning Event Stream: centralised student learning telemetry.
//
// Not a standalone edge function (deployment limit): `get-mastery-history` routes to this handler via its
// `action` field - see _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   lel_ingest   Body: { events: [{ event_type, path?, title?, resource_type?, resource_id?, duration_seconds?,
//                                    occurred_at?, client_event_id? }] }        (students only, their own)
//                -> { accepted, dropped, persistence }
//   lel_stream   Body: { student_id? | class_id, since?, limit?, include_heartbeats?, types? }
//                -> { events, cursor, persistence, names? }       newest first; `since` = cursor from last call
//   lel_summary  Body: { student_id? | class_id, days?, tz_offset_minutes? }
//                -> student: { summary }   class: { summary, students, status_counts, truncated }
//
// Access (same rules as the Student Digital Learning Twin):
//   student  only themself            parent  only linked children (parent_students)
//   staff    studentAccess.ts: own school; teachers only students on a class they teach
//   class scope is staff only (a teacher must be assigned to that class).
//
// Writes: only `lel_ingest`, only for the caller's own student row, only whitelisted client event types with
// sanitised fields (_shared/learningEventModel.ts). The user id and student id come from the verified JWT,
// never from the body. Server-side events are written by emitLearningEvent() and a DB trigger.
// If migration 20261015000000 has not been applied everything answers `persistence: "unavailable"`.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller, studentIdForProfile, canStaffAccessStudent, canStaffAccessClass } from "../studentAccess.ts";
import { isMissingTable } from "../learningEvents.ts";
import {
  ALL_EVENT_TYPES, MAX_CLIENT_BATCH, clampTzOffset, describeEvent, sanitizeClientEvent, summarizeCohort, summarizeEvents,
} from "../learningEventModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = Record<string, any>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE = "learning_events";
const MAX_CLIENT_EVENTS_PER_HOUR = 400;
const MAX_SUMMARY_ROWS = 5000;
const MAX_CLASS_STUDENTS = 300;
const FEED_COLUMNS = "id, student_id, event_type, source, is_correct, score, duration_seconds, payload, occurred_at, created_at";

class Deny extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function handleLearningEventStream(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const caller = await resolveCaller(admin, user.id);
    if (!caller) return json({ error: "Profile not found" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    // ── ingest (browser telemetry) ───────────────────────────────────────────────────────────
    if (action === "ingest") {
      if (caller.role !== "student") return json({ accepted: 0, dropped: 0, ignored: "not_a_student" });
      const studentId = await studentIdForProfile(admin, user.id);
      if (!studentId) return json({ error: "No student record found for this account" }, 404);

      const raw: unknown[] = Array.isArray(body?.events) ? body.events : [];
      if (!raw.length) return json({ accepted: 0, dropped: 0 });
      const now = Date.now();
      const clean = raw.slice(0, MAX_CLIENT_BATCH).map((e) => sanitizeClientEvent(e, now)).filter((e): e is NonNullable<typeof e> => !!e);
      const dropped = raw.length - clean.length;
      if (!clean.length) return json({ accepted: 0, dropped });

      const since = new Date(now - 3600_000).toISOString();
      const { count, error: cErr } = await admin.from(TABLE).select("id", { count: "exact", head: true })
        .eq("student_id", studentId).eq("source", "client").gte("created_at", since);
      if (cErr) {
        if (isMissingTable(cErr)) return json({ accepted: 0, dropped, persistence: "unavailable" });
        throw cErr;
      }
      if ((count ?? 0) >= MAX_CLIENT_EVENTS_PER_HOUR) return json({ error: "Too many events", code: "rate_limited" }, 429);

      const base = (e: (typeof clean)[number]) => ({
        student_id: studentId, school_id: caller.schoolId, event_type: e.event_type, source: e.source, ref_id: e.ref_id,
        duration_seconds: e.duration_seconds, payload: e.payload, occurred_at: e.occurred_at, dedupe_key: e.dedupe_key,
      });
      const plain = clean.filter((e) => !e.dedupe_key).map(base);
      const keyed = clean.filter((e) => e.dedupe_key).map(base);
      if (plain.length) {
        const { error } = await admin.from(TABLE).insert(plain);
        if (error) throw error;
      }
      if (keyed.length) {
        const { error } = await admin.from(TABLE).upsert(keyed, { onConflict: "dedupe_key", ignoreDuplicates: true });
        if (error) throw error;
      }
      return json({ accepted: clean.length, dropped, persistence: "available" });
    }

    if (action !== "stream" && action !== "summary") return json({ error: "Unknown action" }, 400);

    // ── who is being looked at ───────────────────────────────────────────────────────────────
    const scope = await resolveScope(admin, caller, user.id, body);
    if (!scope.studentIds.length) {
      // An empty class: nothing to query (and `.in(..., [])` is not a valid filter).
      if (action === "stream") return json({ events: [], cursor: null, persistence: "available", names: {} });
      const empty = summarizeCohort([], [], Date.now(), Math.max(1, Math.min(30, Math.round(Number(body.days) || 7))), clampTzOffset(body.tz_offset_minutes));
      return json({ persistence: "available", truncated: false, summary: empty.summary, status_counts: empty.status_counts, students: [], roster_truncated: !!scope.rosterTruncated });
    }

    // ── stream ───────────────────────────────────────────────────────────────────────────────
    if (action === "stream") {
      const limit = Math.max(1, Math.min(100, Math.round(Number(body.limit) || 50)));
      const sinceRaw = typeof body.since === "string" && !Number.isNaN(Date.parse(body.since)) ? new Date(body.since).toISOString() : null;
      const types: string[] | null = Array.isArray(body.types)
        ? body.types.filter((t: unknown): t is string => typeof t === "string" && ALL_EVENT_TYPES.includes(t))
        : null;

      let q = admin.from(TABLE).select(FEED_COLUMNS).order("created_at", { ascending: false }).limit(limit);
      q = scope.studentIds.length === 1 ? q.eq("student_id", scope.studentIds[0]) : q.in("student_id", scope.studentIds);
      if (sinceRaw) q = q.gte("created_at", sinceRaw);
      if (types && types.length) q = q.in("event_type", types);
      else if (body.include_heartbeats !== true) q = q.neq("event_type", "session_heartbeat");

      const { data, error } = await q;
      if (error) {
        if (isMissingTable(error)) return json({ events: [], cursor: sinceRaw, persistence: "unavailable" });
        throw error;
      }
      // Each event carries its own human-readable line so every screen words it the same way.
      const events = (data ?? []).map((e: Row) => ({
        ...e, ...describeEvent(e as any), student_name: scope.names?.[e.student_id] ?? undefined,
      }));
      const cursor = events.length ? events[0].created_at : sinceRaw;
      return json({ events, cursor, persistence: "available", ...(scope.isClass ? { names: scope.names } : {}) });
    }

    // ── summary ──────────────────────────────────────────────────────────────────────────────
    const days = Math.max(1, Math.min(30, Math.round(Number(body.days) || 7)));
    const tz = clampTzOffset(body.tz_offset_minutes);
    const now = Date.now();
    const from = new Date(now - days * 86400_000).toISOString();

    let q = admin.from(TABLE).select("student_id, event_type, source, is_correct, occurred_at")
      .gte("occurred_at", from).order("occurred_at", { ascending: false }).limit(MAX_SUMMARY_ROWS);
    q = scope.studentIds.length === 1 ? q.eq("student_id", scope.studentIds[0]) : q.in("student_id", scope.studentIds);
    const { data, error } = await q;
    if (error) {
      if (isMissingTable(error)) return json({ persistence: "unavailable" });
      throw error;
    }
    const rows: Row[] = data ?? [];
    const truncated = rows.length >= MAX_SUMMARY_ROWS;

    if (!scope.isClass) {
      return json({ persistence: "available", truncated, summary: summarizeEvents(rows as any, now, days, tz) });
    }
    const cohort = summarizeCohort(scope.studentIds, rows as any, now, days, tz);
    return json({
      persistence: "available", truncated, summary: cohort.summary, status_counts: cohort.status_counts,
      students: cohort.students.map((s) => ({ ...s, name: scope.names?.[s.student_id] ?? null })),
      roster_truncated: scope.rosterTruncated,
    });
  } catch (e) {
    if (e instanceof Deny) return json({ error: e.message }, e.status);
    console.error("learning event stream error:", e);
    return json({ error: e instanceof Error ? e.message : (e as any)?.message ?? "Unknown error" }, 500);
  }
}

interface Scope {
  studentIds: string[];
  isClass: boolean;
  names?: Record<string, string>;
  rosterTruncated?: boolean;
}

async function resolveScope(admin: any, caller: any, userId: string, body: Row): Promise<Scope> {
  const classId = typeof body.class_id === "string" ? body.class_id : null;
  let studentId: string | null = typeof body.student_id === "string" ? body.student_id : null;
  if (classId && !UUID_RE.test(classId)) throw new Deny(400, "class_id must be a valid id");
  if (studentId && !UUID_RE.test(studentId)) throw new Deny(400, "student_id must be a valid id");

  // ── a whole class (staff only) ─────────────────────────────────────────────────────────────
  if (classId) {
    if (!caller.isStaff) throw new Deny(403, "Not permitted");
    const access = await canStaffAccessClass(admin, caller, classId);
    if (!access.ok) throw new Deny(access.status ?? 403, access.error ?? "Not permitted");
    let ids = access.studentIds ?? [];
    const rosterTruncated = ids.length > MAX_CLASS_STUDENTS;
    if (rosterTruncated) ids = ids.slice(0, MAX_CLASS_STUDENTS);
    if (!ids.length) return { studentIds: [], isClass: true, names: {}, rosterTruncated };
    const { data: students } = await admin.from("students").select("id, full_name").in("id", ids);
    const names: Record<string, string> = {};
    for (const s of students ?? []) if (s.full_name) names[s.id] = s.full_name;
    return { studentIds: ids, isClass: true, names, rosterTruncated };
  }

  // ── one student ────────────────────────────────────────────────────────────────────────────
  if (caller.role === "student") {
    const own = await studentIdForProfile(admin, userId);
    if (!own) throw new Deny(404, "No student record found for this account");
    if (studentId && studentId !== own) throw new Deny(403, "Not permitted");
    return { studentIds: [own], isClass: false };
  }
  if (!studentId) throw new Deny(400, "student_id or class_id is required");

  if (caller.role === "parent") {
    const { data: target } = await admin.from("students").select("profile_id").eq("id", studentId).maybeSingle();
    if (!target) throw new Deny(404, "Student not found");
    const { data: link } = await admin.from("parent_students").select("student_id")
      .eq("parent_id", userId).eq("student_id", target.profile_id).maybeSingle();
    if (!link) throw new Deny(403, "Not permitted");
  } else if (caller.isStaff) {
    const access = await canStaffAccessStudent(admin, caller, studentId);
    if (!access.ok) throw new Deny(access.status ?? 403, access.error ?? "Not permitted");
  } else {
    throw new Deny(403, "Not permitted");
  }
  return { studentIds: [studentId], isClass: false };
}
