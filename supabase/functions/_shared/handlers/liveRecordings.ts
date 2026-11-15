// supabase/functions/_shared/handlers/liveRecordings.ts
//
// LIVE CLASS RECORDINGS. Not a standalone edge function (the project is at its deployment limit): it is served by
// two already-deployed anchors through _shared/mergedRouter.ts -
//   ai-teacher-assistant   action "live_recordings"   user operations (signed-in caller)       handleLiveRecordings
//   calibrate-irt-cron     job    "live_recordings"   scheduled steps (x-cron-secret header)   handleLiveRecordingsCron
// See liveRecordingsModel.ts for how recording works (Google Meet records server-side; APAS arms it, finds the file,
// copies it into a private bucket) and supabase/migrations/20261114000000_live_class_recordings.sql for the tables.
//
// Every table/bucket involved is service-role only, so THIS file is the permission boundary.
//
// User ops (body { action: "live_recordings", op, ... }):
//   settings_get                          everyone in the school (admins also get Google connection info)
//   settings_save { ...settings }         admin / principal / school_admin
//   retention_preview { days }            same: how many recordings a new retention period would expire
//   usage                                 staff admins: storage by class/subject, quota, counts
//   purge_now                             admin-level: expire + physically delete now
//   session_state { session_id }          teacher of the session/class, staff
//   session_toggle { session_id, enabled } teacher (if allowed) / staff: per-session recording on/off (null = default)
//   arm { session_id }                    re-arm Google Meet auto-recording now
//   list { class_id?, session_id?, subject? }
//   play { id }                           signed URL (or external link) for someone allowed to view it
//   update { id, title?, notes?, visibility?, pinned?, course_id?, lesson_id? }
//   link_options { id }                   courses / lessons a recording can be linked to
//   delete { id }
//   upload_url { session_id, session_date, file_name, size_bytes, mime_type }  -> { id, path, token }
//   upload_complete { id }
//   add_link { session_id, session_date, url, title? }

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canStaffAccessClass, resolveCaller, type Caller } from "../studentAccess.ts";
import { corsHeaders, json, UUID_RE } from "../learningGroupsData.ts";
import * as M from "../liveRecordingsModel.ts";
import * as G from "../googleMeet.ts";

type Row = Record<string, any>;
const BUCKET = "live-class-recordings";
const STAFF_ADMINS = ["admin", "principal", "hod", "school_admin"];
const ADMIN_LEVEL = ["admin", "principal", "school_admin"];
const SIGNED_URL_SECONDS = 3600;

interface Ctx { admin: any; caller: Caller; settings: M.RecSettings; studentClasses?: string[] }

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\b(class|grade|std)\b\.?/g, "").replace(/\s+/g, "");
const sec = (s: unknown) => String(s ?? "").trim().toUpperCase();
const fail = (error: string, status = 400) => json({ error }, status);

async function loadSettings(admin: any, schoolId: string): Promise<M.RecSettings> {
  const { data } = await admin.from("live_recording_settings").select("*").eq("school_id", schoolId).maybeSingle();
  return data ? { ...M.DEFAULT_SETTINGS, ...data } : { ...M.DEFAULT_SETTINGS };
}

// ── who is this person in relation to a class ───────────────────────────────────────────────────────

async function studentRow(admin: any, userId: string): Promise<Row | null> {
  const { data } = await admin.from("students").select("id, class, section").eq("profile_id", userId).maybeSingle();
  return data ?? null;
}

/** Classes a student belongs to: class_students, else a same-school class matching their class/section text. */
async function studentClassIds(ctx: Ctx): Promise<string[]> {
  if (ctx.studentClasses) return ctx.studentClasses;
  const st = await studentRow(ctx.admin, ctx.caller.userId);
  if (!st) return (ctx.studentClasses = []);
  const { data: links } = await ctx.admin.from("class_students").select("class_id").eq("student_id", st.id);
  const ids = new Set<string>((links ?? []).map((l: Row) => l.class_id));
  if (!ids.size && st.class && ctx.caller.schoolId) {
    const { data: cands, error } = await ctx.admin.from("classes").select("id, name, section").eq("school_id", ctx.caller.schoolId).limit(500);
    if (!error) for (const c of cands ?? []) if (norm(c.name) === norm(st.class) && sec(c.section) === sec(st.section)) ids.add(c.id);
  }
  return (ctx.studentClasses = [...ids]);
}

async function teacherClassIds(ctx: Ctx): Promise<string[]> {
  const ids = new Set<string>();
  const { data: a } = await ctx.admin.from("class_teachers").select("class_id").eq("teacher_id", ctx.caller.userId);
  for (const r of a ?? []) ids.add(r.class_id);
  const { data: b } = await ctx.admin.from("virtual_classroom_sessions").select("class_id").eq("teacher_id", ctx.caller.userId).eq("school_id", ctx.caller.schoolId);
  for (const r of b ?? []) ids.add(r.class_id);
  return [...ids];
}

async function memberOf(ctx: Ctx, classId: string, hostId?: string | null): Promise<M.Member> {
  const { caller, admin } = ctx;
  if (caller.role === "teacher") {
    if (hostId && hostId === caller.userId) return "teacher";
    const { data } = await admin.from("class_teachers").select("id").eq("class_id", classId).eq("teacher_id", caller.userId).limit(1);
    return data?.length ? "teacher" : null;
  }
  if (STAFF_ADMINS.includes(caller.role)) return (await canStaffAccessClass(admin, caller, classId)).ok ? "staff" : null;
  if (caller.role === "student") return (await studentClassIds(ctx)).includes(classId) ? "student" : null;
  return null;
}

async function loadRecording(ctx: Ctx, id: unknown): Promise<Row | null> {
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  const { data } = await ctx.admin.from("live_class_recordings").select("*").eq("id", id).maybeSingle();
  if (!data || data.school_id !== ctx.caller.schoolId) return null;   // never cross schools
  return data;
}

async function loadSession(ctx: Ctx, id: unknown): Promise<Row | null> {
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  const { data } = await ctx.admin.from("virtual_classroom_sessions").select("*").eq("id", id).maybeSingle();
  if (!data || data.school_id !== ctx.caller.schoolId) return null;
  return data;
}

const access = (member: M.Member, row: Row, ctx: Ctx) => M.recordingAccess(member, row as M.AccessRow, ctx.settings);

// ── Meet arming ─────────────────────────────────────────────────────────────────────────────────────

async function teacherEmail(admin: any, teacherId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("email").eq("id", teacherId).maybeSingle();
  return data?.email ?? null;
}

/** Switch Meet auto-recording on (or off) for the session's meeting space, acting as the teacher. Never throws. */
async function armSession(admin: any, session: Row, on = true): Promise<{ ok: boolean; error?: string }> {
  const attempted = new Date().toISOString();
  const save = (patch: Row) => admin.from("virtual_classroom_sessions").update({ ...patch, recording_arm_attempted_at: attempted }).eq("id", session.id);
  const code = M.parseMeetingCode(session.meet_link);
  if (!code) {
    const error = "Recording needs a Google Meet link like meet.google.com/abc-defg-hij (Classroom and other links are not supported).";
    await save({ recording_armed_at: null, recording_arm_error: error });
    return { ok: false, error };
  }
  const sa = G.loadServiceAccount();
  if (!sa) {
    const error = "Google connection is not configured on the server yet (GOOGLE_MEET_SA_JSON).";
    await save({ recording_arm_error: error });
    return { ok: false, error };
  }
  try {
    const email = await teacherEmail(admin, session.teacher_id);
    if (!email) throw new G.GoogleError("The teacher has no email address in APAS");
    const token = await G.accessTokenFor(sa, email);
    const space = await G.getSpace(token, code);
    await G.setAutoRecording(token, space.name, on);
    await save({ meet_space_name: space.name, recording_armed_at: on ? new Date().toISOString() : null, recording_arm_error: null });
    return { ok: true };
  } catch (e) {
    const error = G.describeGoogleError(e);
    await save({ recording_armed_at: null, recording_arm_error: error });
    return { ok: false, error };
  }
}

// ── enrichment for list ─────────────────────────────────────────────────────────────────────────────

async function titlesFor(admin: any, table: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data, error } = await admin.from(table).select("id, title").in("id", ids);   // course/lesson tables vary: tolerate absence
  if (!error) for (const r of data ?? []) out.set(r.id, r.title);
  return out;
}

async function shape(ctx: Ctx, rows: Row[]) {
  const classIds = [...new Set(rows.map((r) => r.class_id))];
  const { data: classes } = classIds.length ? await ctx.admin.from("classes").select("id, name, section").in("id", classIds) : { data: [] };
  const label = new Map<string, string>((classes ?? []).map((c: Row) => [c.id, `${c.name}${c.section ? " " + c.section : ""}`]));
  const courses = await titlesFor(ctx.admin, "courses", [...new Set(rows.map((r) => r.course_id).filter(Boolean))]);
  const lessons = await titlesFor(ctx.admin, "lessons", [...new Set(rows.map((r) => r.lesson_id).filter(Boolean))]);
  const memberCache = new Map<string, M.Member>();
  const out: Row[] = [];
  for (const r of rows) {
    const key = `${r.class_id}|${r.teacher_id}`;
    if (!memberCache.has(key)) memberCache.set(key, await memberOf(ctx, r.class_id, r.teacher_id));
    const a = access(memberCache.get(key)!, r, ctx);
    if (!a.view) continue;
    out.push({
      id: r.id, session_id: r.session_id, session_date: r.session_date, class_id: r.class_id, class_label: label.get(r.class_id) ?? "",
      subject: r.subject, title: r.title, notes: r.notes, source: r.source, status: r.status, storage_kind: r.storage_kind,
      size_bytes: Number(r.size_bytes) || 0, duration_seconds: r.duration_seconds, started_at: r.started_at, ended_at: r.ended_at,
      visibility: r.visibility, pinned: r.pinned, course_id: r.course_id, course_title: courses.get(r.course_id) ?? null,
      lesson_id: r.lesson_id, lesson_title: lessons.get(r.lesson_id) ?? null, retention_expires_at: r.retention_expires_at,
      created_at: r.created_at, last_error: a.manage ? r.last_error : null, can_manage: a.manage, can_delete: a.remove,
      playable: r.status === "ready" && r.storage_kind !== "none",
    });
  }
  return out;
}

// ── user operations ─────────────────────────────────────────────────────────────────────────────────

export async function handleLiveRecordings(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("Missing authorization", 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return fail("Not authenticated", 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const caller = await resolveCaller(admin, user.id);
    if (!caller || !caller.schoolId || !["teacher", "student", ...STAFF_ADMINS].includes(caller.role)) return fail("Not permitted", 403);
    const ctx: Ctx = { admin, caller, settings: await loadSettings(admin, caller.schoolId) };
    const body = await req.json().catch(() => ({}));
    const op = String(body.op ?? "");
    const isAdmin = ADMIN_LEVEL.includes(caller.role);

    switch (op) {
      case "settings_get": {
        const google = isAdmin ? (() => {
          const sa = G.loadServiceAccount();
          return { configured: !!sa, client_email: sa?.client_email ?? null, client_id: sa?.client_id ?? null, scopes: M.GOOGLE_SCOPES };
        })() : null;
        return json({ settings: ctx.settings, can_edit: isAdmin, google });
      }
      case "settings_save": {
        if (!isAdmin) return fail("Only a school administrator can change recording settings", 403);
        const cleaned = M.cleanSettings(body.settings ?? {}, ctx.settings);
        if (!cleaned.ok) return fail(cleaned.error);
        const { error } = await admin.from("live_recording_settings").upsert(
          { school_id: caller.schoolId, ...cleaned.value, updated_by: caller.userId, updated_at: new Date().toISOString() }, { onConflict: "school_id" });
        if (error) throw new Error(error.message);
        let reapplied = 0;
        if (cleaned.value.retention_days !== ctx.settings.retention_days) reapplied = await applyRetention(admin, caller.schoolId, cleaned.value.retention_days);
        return json({ settings: cleaned.value, retention_reapplied: reapplied });
      }
      case "retention_preview": {
        if (!isAdmin) return fail("Not permitted", 403);
        const days = Number(body.days);
        if (!Number.isInteger(days) || days < 0 || days > 3650) return fail("Retention must be 0 to 3650 days");
        if (days === 0) return json({ would_expire: 0 });
        const { data } = await admin.from("live_class_recordings").select("ended_at, created_at")
          .eq("school_id", caller.schoolId).is("deleted_at", null).eq("pinned", false).limit(20000);
        const cutoff = Date.now() - days * 86_400_000;
        return json({ would_expire: (data ?? []).filter((r: Row) => new Date(r.ended_at ?? r.created_at).getTime() <= cutoff).length });
      }
      case "usage": {
        if (!STAFF_ADMINS.includes(caller.role)) return fail("Not permitted", 403);
        return json(await usage(ctx));
      }
      case "purge_now": {
        if (!isAdmin) return fail("Not permitted", 403);
        const expired = await admin.rpc("live_rec_mark_expired");
        const purged = await purgeBatch(admin, 200, caller.schoolId);
        return json({ expired: expired.data ?? 0, ...purged });
      }
      case "session_state":
      case "session_toggle":
      case "arm": {
        const session = await loadSession(ctx, body.session_id);
        if (!session) return fail("Session not found", 404);
        const member = await memberOf(ctx, session.class_id, session.teacher_id);
        if (member !== "teacher" && member !== "staff") return fail("Not permitted", 403);
        const mayToggle = member === "staff" || ctx.settings.teachers_can_toggle;
        let current = session;
        if (op === "session_toggle") {
          if (!mayToggle) return fail("Your school does not let teachers change recording", 403);
          if (!ctx.settings.enabled) return fail("Recording is switched off for your school. Ask an administrator to enable it.", 409);
          const enabled = body.enabled === null ? null : body.enabled === true ? true : body.enabled === false ? false : undefined;
          if (enabled === undefined) return fail("enabled must be true, false or null");
          await admin.from("virtual_classroom_sessions").update({ record_enabled: enabled }).eq("id", session.id);
          current = { ...session, record_enabled: enabled };
          const on = M.effectiveRecordEnabled(enabled, ctx.settings);
          await armSession(admin, current, on);
        } else if (op === "arm") {
          if (!mayToggle) return fail("Not permitted", 403);
          if (!M.effectiveRecordEnabled(session.record_enabled, ctx.settings)) return fail("Recording is off for this session", 409);
          await armSession(admin, session, true);
        }
        const { data: fresh } = await admin.from("virtual_classroom_sessions").select("record_enabled, recording_armed_at, recording_arm_error, meet_link").eq("id", session.id).maybeSingle();
        const { count } = await admin.from("live_class_recordings").select("id", { count: "exact", head: true }).eq("session_id", session.id).is("deleted_at", null);
        return json({
          school_enabled: ctx.settings.enabled,
          google_configured: !!G.loadServiceAccount(),
          record_enabled: fresh?.record_enabled ?? null,
          effective: M.effectiveRecordEnabled(fresh?.record_enabled, ctx.settings),
          armed_at: fresh?.recording_armed_at ?? null,
          arm_error: fresh?.recording_arm_error ?? null,
          meet_supported: !!M.parseMeetingCode(fresh?.meet_link),
          can_toggle: mayToggle,
          can_upload: member === "staff" || ctx.settings.teachers_can_upload,
          recordings: count ?? 0,
        });
      }
      case "list": {
        let q = admin.from("live_class_recordings").select("*").eq("school_id", caller.schoolId).is("deleted_at", null)
          .order("session_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(300);
        if (typeof body.session_id === "string" && UUID_RE.test(body.session_id)) q = q.eq("session_id", body.session_id);
        if (typeof body.class_id === "string" && UUID_RE.test(body.class_id)) q = q.eq("class_id", body.class_id);
        if (text(body.subject, 100)) q = q.eq("subject", text(body.subject, 100));
        if (caller.role === "student") {
          if (!ctx.settings.student_access) return json({ recordings: [] });
          const classes = await studentClassIds(ctx);
          if (!classes.length) return json({ recordings: [] });
          q = q.in("class_id", classes).eq("status", "ready").eq("visibility", "class");
        } else if (caller.role === "teacher") {
          const classes = await teacherClassIds(ctx);
          if (!classes.length) return json({ recordings: [] });
          q = q.in("class_id", classes);
        }
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return json({ recordings: await shape(ctx, data ?? []) });
      }
      case "play": {
        const rec = await loadRecording(ctx, body.id);
        if (!rec) return fail("Recording not found", 404);
        const a = access(await memberOf(ctx, rec.class_id, rec.teacher_id), rec, ctx);
        if (!a.view) return fail("You do not have access to this recording", 403);
        if (rec.status !== "ready") return fail("This recording is not ready yet", 409);
        if (rec.storage_kind === "supabase" && rec.storage_path) {
          const mayDownload = caller.role !== "student" || ctx.settings.student_download;
          // Signed URLs are short-lived (1 h) and per request. "download" only controls whether the app shows a download
          // button: a viewer who can play a video can always save it, so this deters, it is not DRM.
          const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(rec.storage_path, SIGNED_URL_SECONDS);
          if (error || !data?.signedUrl) return fail("The recording file is not available", 404);
          return json({ kind: "file", url: data.signedUrl, expires_in: SIGNED_URL_SECONDS, title: rec.title, mime_type: rec.mime_type, download: mayDownload });
        }
        if (rec.drive_view_url) return json({ kind: "external", url: rec.drive_view_url, title: rec.title });
        return fail("No playable file for this recording", 404);
      }
      case "update": {
        const rec = await loadRecording(ctx, body.id);
        if (!rec) return fail("Recording not found", 404);
        if (!access(await memberOf(ctx, rec.class_id, rec.teacher_id), rec, ctx).manage) return fail("Not permitted", 403);
        const patch: Row = {};
        if (body.title !== undefined) { const t = text(body.title, 200); if (!t) return fail("A title is required"); patch.title = t; }
        if (body.notes !== undefined) patch.notes = text(body.notes, 2000) || null;
        if (body.visibility !== undefined) { if (!["class", "teachers"].includes(body.visibility)) return fail("Invalid visibility"); patch.visibility = body.visibility; }
        if (body.pinned !== undefined) patch.pinned = body.pinned === true;
        for (const k of ["course_id", "lesson_id"]) {
          if (body[k] === undefined) continue;
          if (body[k] !== null && !(typeof body[k] === "string" && UUID_RE.test(body[k]))) return fail(`Invalid ${k}`);
          patch[k] = body[k];
        }
        if (!Object.keys(patch).length) return fail("Nothing to change");
        const { error } = await admin.from("live_class_recordings").update(patch).eq("id", rec.id);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case "link_options": {
        const rec = await loadRecording(ctx, body.id);
        if (!rec) return fail("Recording not found", 404);
        if (!access(await memberOf(ctx, rec.class_id, rec.teacher_id), rec, ctx).manage) return fail("Not permitted", 403);
        let courses: Row[] = [];
        let c = await admin.from("courses").select("id, title").order("title").limit(200);
        if (!c.error) courses = c.data ?? [];
        let lessons: Row[] = [];
        if (rec.teacher_id) {
          let l = admin.from("lessons").select("id, title, subject, topic").eq("teacher_id", rec.teacher_id).order("created_at", { ascending: false }).limit(200);
          if (rec.subject) l = l.eq("subject", rec.subject);
          const r = await l;
          if (!r.error) lessons = r.data ?? [];
        }
        return json({ courses, lessons });
      }
      case "delete": {
        const rec = await loadRecording(ctx, body.id);
        if (!rec) return fail("Recording not found", 404);
        if (!access(await memberOf(ctx, rec.class_id, rec.teacher_id), rec, ctx).remove) return fail("Your school does not let teachers delete recordings. Ask an administrator.", 403);
        await admin.from("live_class_recordings").update({ deleted_at: new Date().toISOString(), deleted_by: caller.userId, deleted_reason: "manual", status: "deleted" }).eq("id", rec.id);
        await purgeBatch(admin, 5, caller.schoolId, rec.id);   // best effort now; the scheduled sweep catches leftovers
        return json({ ok: true });
      }
      case "upload_url":
      case "add_link": {
        if (!ctx.settings.enabled) return fail("Recording is switched off for your school", 409);
        const session = await loadSession(ctx, body.session_id);
        if (!session) return fail("Session not found", 404);
        const member = await memberOf(ctx, session.class_id, session.teacher_id);
        if (member !== "teacher" && member !== "staff") return fail("Not permitted", 403);
        if (member === "teacher" && !ctx.settings.teachers_can_upload) return fail("Your school does not let teachers add recordings", 403);
        if (!isDate(body.session_date)) return fail("Pick the date of the class");
        const title = text(body.title, 200) || `${session.title || session.subject} - ${body.session_date}`;
        const base = { school_id: caller.schoolId, session_id: session.id, session_date: body.session_date, class_id: session.class_id,
          subject: session.subject, teacher_id: session.teacher_id, created_by: caller.userId, visibility: "class" };
        if (op === "add_link") {
          const v = M.validateLinkUrl(body.url);
          if (!v.ok) return fail(v.error);
          const { data, error } = await admin.from("live_class_recordings").insert({
            ...base, title, source: "link", status: "ready", storage_kind: "link", drive_view_url: v.url,
            ended_at: new Date().toISOString(), retention_expires_at: M.retentionExpiry(new Date().toISOString(), ctx.settings.retention_days) }).select("id").single();
          if (error) return error.code === "23505" ? fail("That link is already attached to this class", 409) : fail(error.message, 500);
          return json({ id: data.id });
        }
        const mime = text(body.mime_type, 80);
        if (!M.ALLOWED_VIDEO_MIME.includes(mime)) return fail("Upload an MP4, WebM or MOV video");
        const size = Number(body.size_bytes);
        if (!(size > 0) || size > ctx.settings.max_upload_mb * 1024 * 1024) return fail(`The file is larger than the ${ctx.settings.max_upload_mb} MB limit`);
        const used = await usedBytes(admin, caller.schoolId);
        if (!M.quotaAllows(used, size, ctx.settings.storage_quota_gb)) return fail("Your school's recording storage is full. Ask an administrator to free space or raise the quota.", 409);
        const id = crypto.randomUUID();
        const path = M.buildStoragePath(caller.schoolId, session.class_id, id, M.extensionFor(mime, text(body.file_name, 150)));
        const { error: insErr } = await admin.from("live_class_recordings").insert({
          ...base, id, title, source: "upload", status: "processing", storage_kind: "none", storage_path: path, mime_type: mime, size_bytes: size });
        if (insErr) throw new Error(insErr.message);
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error) { await admin.from("live_class_recordings").delete().eq("id", id); throw new Error(error.message); }
        return json({ id, path: data.path ?? path, token: data.token });
      }
      case "upload_complete": {
        const rec = await loadRecording(ctx, body.id);
        if (!rec || rec.source !== "upload") return fail("Recording not found", 404);
        if (!access(await memberOf(ctx, rec.class_id, rec.teacher_id), rec, ctx).manage && rec.created_by !== caller.userId) return fail("Not permitted", 403);
        if (rec.status === "ready") return json({ ok: true });                       // idempotent: a retry cannot double-register
        const folder = rec.storage_path.split("/").slice(0, -1).join("/");
        const name = rec.storage_path.split("/").pop();
        const { data: files } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 5 });
        const f = (files ?? []).find((x: Row) => x.name === name);
        if (!f) return fail("The upload has not finished yet", 409);
        const now = new Date().toISOString();
        await admin.from("live_class_recordings").update({
          status: "ready", storage_kind: "supabase", size_bytes: Number(f.metadata?.size) || rec.size_bytes, ended_at: now,
          retention_expires_at: M.retentionExpiry(now, ctx.settings.retention_days) }).eq("id", rec.id);
        return json({ ok: true });
      }
      default:
        return fail("Unknown operation", 400);
    }
  } catch (e) {
    console.error("live_recordings error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}

// ── shared storage / retention helpers ──────────────────────────────────────────────────────────────

async function usedBytes(admin: any, schoolId: string): Promise<number> {
  const { data } = await admin.from("live_class_recordings").select("size_bytes").eq("school_id", schoolId).eq("storage_kind", "supabase").is("deleted_at", null).limit(50000);
  return (data ?? []).reduce((n: number, r: Row) => n + (Number(r.size_bytes) || 0), 0);
}

async function applyRetention(admin: any, schoolId: string, days: number): Promise<number> {
  const { data } = await admin.from("live_class_recordings").select("id, ended_at, created_at")
    .eq("school_id", schoolId).is("deleted_at", null).eq("pinned", false).in("status", ["ready", "copying", "processing"]).limit(20000);
  let n = 0;
  for (const r of data ?? []) {
    const { error } = await admin.from("live_class_recordings").update({ retention_expires_at: M.retentionExpiry(r.ended_at ?? r.created_at, days) }).eq("id", r.id);
    if (!error) n++;
  }
  return n;
}

async function usage(ctx: Ctx) {
  const { admin, caller, settings } = ctx;
  const { data } = await admin.from("live_class_recordings")
    .select("id, class_id, subject, size_bytes, status, storage_kind, retention_expires_at, pinned, last_error")
    .eq("school_id", caller.schoolId).is("deleted_at", null).limit(50000);
  const rows: Row[] = data ?? [];
  const stored = rows.filter((r) => r.storage_kind === "supabase");
  const used = stored.reduce((n, r) => n + (Number(r.size_bytes) || 0), 0);
  const byClass = new Map<string, { bytes: number; count: number }>();
  const bySubject = new Map<string, { bytes: number; count: number }>();
  for (const r of stored) {
    for (const [m, k] of [[byClass, r.class_id], [bySubject, r.subject || "(no subject)"]] as const) {
      const cur = m.get(k) ?? { bytes: 0, count: 0 };
      cur.bytes += Number(r.size_bytes) || 0; cur.count++; m.set(k, cur);
    }
  }
  const ids = [...byClass.keys()];
  const { data: classes } = ids.length ? await admin.from("classes").select("id, name, section").in("id", ids) : { data: [] };
  const label = new Map<string, string>((classes ?? []).map((c: Row) => [c.id, `${c.name}${c.section ? " " + c.section : ""}`]));
  const soon = Date.now() + 30 * 86_400_000;
  const top = (m: Map<string, { bytes: number; count: number }>, nameOf: (k: string) => string) =>
    [...m.entries()].map(([k, v]) => ({ name: nameOf(k), ...v })).sort((a, b) => b.bytes - a.bytes).slice(0, 15);
  return {
    used_bytes: used, quota_bytes: settings.storage_quota_gb * 1024 ** 3, total_recordings: rows.length,
    by_status: rows.reduce((acc: Row, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {}),
    kept_as_drive_link: rows.filter((r) => r.storage_kind === "drive").length,
    expiring_30_days: rows.filter((r) => !r.pinned && r.retention_expires_at && new Date(r.retention_expires_at).getTime() <= soon).length,
    failed: rows.filter((r) => r.status === "failed" || r.last_error).length,
    by_class: top(byClass, (k) => label.get(k) ?? k), by_subject: top(bySubject, (k) => k),
  };
}

/** Physically remove files of deleted recordings (the Storage API is the only way to free the bytes), then sweep stale uploads. */
async function purgeBatch(admin: any, limit: number, schoolId?: string, onlyId?: string) {
  let q = admin.from("live_class_recordings").select("id, storage_kind, storage_path").not("deleted_at", "is", null).is("purged_at", null).limit(limit);
  if (schoolId) q = q.eq("school_id", schoolId);
  if (onlyId) q = q.eq("id", onlyId);
  const { data } = await q;
  let purged = 0;
  for (const r of data ?? []) {
    if (r.storage_kind === "supabase" && r.storage_path) {
      const { error } = await admin.storage.from(BUCKET).remove([r.storage_path]);
      if (error) { console.error("purge failed", r.id, error.message); continue; }   // keep the row; retried next run
    }
    await admin.from("live_class_recordings").update({ purged_at: new Date().toISOString(), storage_path: null, tus_url: null }).eq("id", r.id);
    purged++;
  }
  let stale = 0;
  if (!onlyId) {   // uploads that were reserved but never completed
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    let sq = admin.from("live_class_recordings").select("id, storage_path").eq("source", "upload").eq("status", "processing").lt("created_at", cutoff).limit(50);
    if (schoolId) sq = sq.eq("school_id", schoolId);
    const { data: orphans } = await sq;
    for (const o of orphans ?? []) {
      if (o.storage_path) await admin.storage.from(BUCKET).remove([o.storage_path]);
      await admin.from("live_class_recordings").delete().eq("id", o.id);
      stale++;
    }
  }
  return { purged, stale_uploads_removed: stale };
}

// ── scheduled steps (cron secret) ───────────────────────────────────────────────────────────────────

export async function handleLiveRecordingsCron(req: Request): Promise<Response> {
  try {
    const expected = Deno.env.get("CRON_SECRET");
    const given = req.headers.get("x-cron-secret");
    if (!expected || !given || given !== expected) return json({ error: "Not authorized" }, 401);   // same reply whether wrong or unset
    const body = await req.json().catch(() => ({}));
    const step = String(body.step ?? "all");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const out: Row = { ran_at: new Date().toISOString() };
    if (step === "arm" || step === "all") out.arm = await armDue(admin);
    if (step === "sync" || step === "all") out.sync = await syncRecordings(admin);
    if (step === "copy_purge" || step === "all") {
      out.copy = await copyBatch(admin);
      await admin.rpc("live_rec_mark_expired");
      out.purge = await purgeBatch(admin, 25);
    }
    return json(out);
  } catch (e) {
    console.error("live_recordings cron error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}

async function enabledSchools(admin: any): Promise<Map<string, M.RecSettings>> {
  const { data } = await admin.from("live_recording_settings").select("*").eq("enabled", true);
  return new Map((data ?? []).map((s: Row) => [s.school_id, { ...M.DEFAULT_SETTINGS, ...s } as M.RecSettings]));
}

/** Arm Meet auto-recording for sessions that are due to run soon (idempotent; re-checked every 12 h). */
async function armDue(admin: any) {
  const schools = await enabledSchools(admin);
  if (!schools.size) return { armed: 0, failed: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 24 * 3600_000).toISOString();
  const { data } = await admin.from("virtual_classroom_sessions").select("*")
    .in("school_id", [...schools.keys()]).in("status", ["scheduled", "live"]).lte("scheduled_start", horizon)
    .or(`recurrence_end_date.gte.${today},scheduled_end.gte.${new Date(Date.now() - 3600_000).toISOString()}`).limit(400);
  const stale = Date.now() - 12 * 3600_000;
  let armed = 0, failed = 0, looked = 0;
  for (const s of data ?? []) {
    const settings = schools.get(s.school_id)!;
    if (!M.effectiveRecordEnabled(s.record_enabled, settings)) continue;
    if (s.recording_armed_at && new Date(s.recording_armed_at).getTime() > stale && !s.recording_arm_error) continue;
    // a session that failed to arm is retried at most hourly, so one broken link cannot hammer Google every 5 minutes
    if (s.recording_arm_error && s.recording_arm_attempted_at && Date.now() - new Date(s.recording_arm_attempted_at).getTime() < 3600_000) continue;
    if (++looked > 40) break;
    const r = await armSession(admin, s, true);
    r.ok ? armed++ : failed++;
  }
  return { armed, failed };
}

/** Find recordings Meet produced for armed sessions and register each exactly once. */
async function syncRecordings(admin: any) {
  const schools = await enabledSchools(admin);
  const sa = G.loadServiceAccount();
  if (!schools.size || !sa) return { sessions: 0, found: 0, skipped: !sa ? "google not configured" : "no school enabled" };
  const since = new Date(Date.now() - 4 * 86_400_000).toISOString();
  const { data: sessions } = await admin.from("virtual_classroom_sessions").select("*")
    .in("school_id", [...schools.keys()]).not("recording_armed_at", "is", null).limit(200);
  let looked = 0, found = 0, updated = 0;
  for (const s of sessions ?? []) {
    const settings = schools.get(s.school_id)!;
    if (!M.effectiveRecordEnabled(s.record_enabled, settings)) continue;
    const ended = M.endedOccurrences({ start: s.scheduled_start, end: s.scheduled_end, recurrenceEnd: s.recurrence_end_date }, Date.now() - 4 * 86_400_000, Date.now() + 2 * 3600_000);
    if (!ended.length) continue;
    if (++looked > 30) break;
    const code = M.parseMeetingCode(s.meet_link);
    const email = await teacherEmail(admin, s.teacher_id);
    if (!code || !email) continue;
    try {
      const token = await G.accessTokenFor(sa, email);
      for (const conf of await G.listConferenceRecords(token, code, since)) {
        const date = M.resolveOccurrenceDate({ start: s.scheduled_start, end: s.scheduled_end, recurrenceEnd: s.recurrence_end_date }, new Date(conf.startTime ?? Date.now()).getTime());
        for (const rec of await G.listRecordings(token, conf.name)) {
          const r = await upsertProviderRecording(admin, s, settings, email, date, rec);
          if (r === "new") found++; else if (r === "updated") updated++;
        }
      }
    } catch (e) {
      console.error("sync failed for session", s.id, G.describeGoogleError(e));
      await admin.from("virtual_classroom_sessions").update({ recording_arm_error: G.describeGoogleError(e) }).eq("id", s.id);
    }
  }
  return { sessions: looked, found, updated };
}

async function upsertProviderRecording(admin: any, s: Row, settings: M.RecSettings, ownerEmail: string, date: string, rec: M.ProviderRecording): Promise<"new" | "updated" | "same"> {
  const mapped = M.mapProviderState(rec.state, settings.storage_mode);
  const { data: existing } = await admin.from("live_class_recordings").select("id, status").eq("provider", "google_meet").eq("provider_recording_id", rec.name).maybeSingle();
  const ready = mapped.status === "ready";
  const fields: Row = {
    status: mapped.status, storage_kind: mapped.kind, drive_file_id: rec.fileId, drive_view_url: rec.exportUri,
    started_at: rec.startTime, ended_at: rec.endTime,
    duration_seconds: rec.startTime && rec.endTime ? Math.max(0, Math.round((Date.parse(rec.endTime) - Date.parse(rec.startTime)) / 1000)) : null,
    next_attempt_at: mapped.status === "copying" ? new Date().toISOString() : null,
    retention_expires_at: ready ? M.retentionExpiry(rec.endTime, settings.retention_days) : null,
  };
  if (existing) {
    // only ever move forward (recording -> processing -> copying/ready); never undo a finished or deleted one
    const rank: Record<string, number> = { recording: 0, processing: 1, copying: 2, ready: 3 };
    if (!(existing.status in rank) || rank[existing.status] >= rank[mapped.status]) return "same";
    const { error } = await admin.from("live_class_recordings").update(fields).eq("id", existing.id);
    return error ? "same" : "updated";
  }
  const { error } = await admin.from("live_class_recordings").insert({
    ...fields, school_id: s.school_id, session_id: s.id, session_date: date, class_id: s.class_id, subject: s.subject, teacher_id: s.teacher_id,
    title: `${s.title || s.subject} - ${date}`, source: "auto", provider: "google_meet", provider_recording_id: rec.name, owner_email: ownerEmail, visibility: "class",
  });
  if (error) return "same";   // a unique violation means another run registered it first: exactly-once is the point
  return "new";
}

// ── copy Drive -> private bucket, resumable (Supabase TUS), a few chunks per run ─────────────────────

const b64 = (s: string) => btoa(s);
const tusHeaders = (key: string) => ({ Authorization: `Bearer ${key}`, apikey: key, "Tus-Resumable": "1.0.0" });

async function tusCreate(url: string, key: string, objectName: string, size: number, contentType: string): Promise<string> {
  const res = await fetch(`${url}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: { ...tusHeaders(key), "Upload-Length": String(size), "x-upsert": "true",
      "Upload-Metadata": `bucketName ${b64(BUCKET)},objectName ${b64(objectName)},contentType ${b64(contentType)},cacheControl ${b64("3600")}` },
  });
  const loc = res.headers.get("Location");
  if (res.status !== 201 || !loc) throw new Error(`Could not start the upload (${res.status})`);
  return new URL(loc, url).toString();
}
async function tusOffset(uploadUrl: string, key: string): Promise<number> {
  const res = await fetch(uploadUrl, { method: "HEAD", headers: tusHeaders(key) });
  if (res.status === 404 || res.status === 410) return -1;
  return Number(res.headers.get("Upload-Offset") ?? 0);
}
async function tusPatch(uploadUrl: string, key: string, offset: number, bytes: Uint8Array): Promise<number> {
  const res = await fetch(uploadUrl, {
    method: "PATCH",
    headers: { ...tusHeaders(key), "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
    // a plain ArrayBuffer is accepted as a fetch body by every TypeScript/Deno version
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
  if (res.status !== 204) throw new Error(`Upload chunk failed (${res.status})`);
  return Number(res.headers.get("Upload-Offset") ?? offset + bytes.length);
}

async function copyBatch(admin: any) {
  const sa = G.loadServiceAccount();
  if (!sa) return { copied: 0, skipped: "google not configured" };
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const started = Date.now();
  const { data: rows } = await admin.from("live_class_recordings").select("*").eq("status", "copying")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`).order("created_at").limit(3);
  let finished = 0, progressed = 0, fellBack = 0;
  for (const rec of rows ?? []) {
    if (Date.now() - started > 100_000) break;           // stay inside the function's time limit; resume next minute
    const settings = await loadSettings(admin, rec.school_id);
    try {
      const token = await G.accessTokenFor(sa, rec.owner_email);
      const info = await G.driveFileInfo(token, rec.drive_file_id);
      if (!info.size) throw new Error("Drive reports an empty file");
      if (!M.quotaAllows(await usedBytes(admin, rec.school_id), rec.tus_url ? 0 : info.size, settings.storage_quota_gb)) {
        await admin.from("live_class_recordings").update({ status: "ready", storage_kind: "drive", size_bytes: 0, tus_url: null,
          last_error: "Storage quota reached: kept as a Drive link instead of being copied.",
          retention_expires_at: M.retentionExpiry(rec.ended_at, settings.retention_days) }).eq("id", rec.id);
        fellBack++; continue;
      }
      const ext = M.extensionFor(info.mimeType);
      const path = rec.storage_path ?? M.buildStoragePath(rec.school_id, rec.class_id, rec.id, ext);
      const mime = M.ALLOWED_VIDEO_MIME.includes(info.mimeType) ? info.mimeType : "video/mp4";
      let uploadUrl: string | null = rec.tus_url;
      let offset = 0;
      if (uploadUrl) { offset = await tusOffset(uploadUrl, key); if (offset < 0) { uploadUrl = null; offset = 0; } }   // upload expired: start over
      if (!uploadUrl) {
        uploadUrl = await tusCreate(url, key, path, info.size, mime);
        await admin.from("live_class_recordings").update({ tus_url: uploadUrl, storage_path: path, mime_type: mime, size_bytes: info.size, copied_bytes: 0 }).eq("id", rec.id);
      }
      for (const c of M.chunkPlan(offset, info.size, M.TUS_CHUNK, 12)) {
        if (Date.now() - started > 100_000) break;
        const bytes = await G.driveRange(token, rec.drive_file_id, c.start, c.end);
        offset = await tusPatch(uploadUrl, key, c.start, bytes);
        await admin.from("live_class_recordings").update({ copied_bytes: offset, last_error: null }).eq("id", rec.id);
      }
      if (offset >= info.size) {
        await admin.from("live_class_recordings").update({
          status: "ready", storage_kind: "supabase", tus_url: null, copied_bytes: info.size, size_bytes: info.size, last_error: null,
          retention_expires_at: M.retentionExpiry(rec.ended_at, settings.retention_days) }).eq("id", rec.id);
        finished++;
      } else progressed++;
    } catch (e) {
      const attempts = (rec.copy_attempts ?? 0) + 1;
      const msg = G.describeGoogleError(e);
      if (attempts >= M.MAX_COPY_ATTEMPTS) {
        // Give up copying but never lose the recording: it stays playable from Google Drive.
        await admin.from("live_class_recordings").update({ status: "ready", storage_kind: "drive", copy_attempts: attempts, tus_url: null,
          last_error: `Could not copy to APAS storage (${msg}); kept as a Drive link.`, retention_expires_at: M.retentionExpiry(rec.ended_at, settings.retention_days) }).eq("id", rec.id);
        fellBack++;
      } else {
        await admin.from("live_class_recordings").update({ copy_attempts: attempts, last_error: msg, next_attempt_at: new Date(Date.now() + M.backoffMs(attempts)).toISOString() }).eq("id", rec.id);
      }
    }
  }
  return { finished, in_progress: progressed, kept_as_drive_link: fellBack };
}
