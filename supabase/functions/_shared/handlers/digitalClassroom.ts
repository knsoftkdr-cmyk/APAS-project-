// supabase/functions/_shared/handlers/digitalClassroom.ts
//
// DIGITAL CLASSROOM WORKSPACE (sheet row 43). Not a standalone edge function (deployment limit):
// `ai-teacher-assistant` routes to it via action "classroom" - see _shared/mergedRouter.ts.
//
// One class, one place: stream (announcements / discussion / questions + comments), materials (files and
// links), assignments (homework + assigned tests), live sessions and attendance. Body: { action: "classroom", op, ... }
//
//   op "overview"             { class_id? }                          everyone in the class
//   op "post"                 { class_id, body, kind? }               students: discussion|question; teacher: + announcement
//   op "comment"              { post_id, body }
//   op "delete_post"          { post_id }                             author, or the class's teacher/staff
//   op "pin_post"             { post_id, pinned }                     teacher/staff
//   op "material_upload_url"  { class_id, file_name }                 teacher/staff -> signed upload URL (bucket classroom-materials)
//   op "material_add"         { class_id, title, kind, url? | storage_path?, file_name?, mime_type?, size_bytes?, description?, topic? }
//   op "material_delete"      { id }                                  teacher/staff
//   op "attendance_save"      { class_id, date, marks: { [student_id]: status } }   teacher/staff
//
// Access: the class's teachers (class_teachers), school staff admins of the same school, and students on the
// roster (class_students, or students.class/section text - the two roster sources used across APAS). Parents no.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canStaffAccessClass, resolveCaller, type Caller } from "../studentAccess.ts";
import { corsHeaders, json, loadStudentNames, UUID_RE } from "../learningGroupsData.ts";

type Row = Record<string, any>;
type Member = "teacher" | "staff" | "student";
const BUCKET = "classroom-materials";
const STAFF_ADMINS = ["admin", "principal", "hod", "school_admin"];
const ATTENDANCE = ["present", "absent", "late", "half_day", "excused"];

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\b(class|grade|std)\b\.?/g, "").replace(/\s+/g, "");
const sec = (s: unknown) => String(s ?? "").trim().toUpperCase();
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const label = (c: Row) => `${c.name}${c.section ? " - " + c.section : ""}`;

interface Ctx { admin: any; caller: Caller; student: Row | null }

async function studentClasses(ctx: Ctx): Promise<Row[]> {
  if (!ctx.student) return [];
  const { data: links } = await ctx.admin.from("class_students").select("classes(id, name, section)").eq("student_id", ctx.student.id);
  const out = new Map<string, Row>();
  for (const l of links ?? []) if (l.classes) out.set(l.classes.id, l.classes);
  if (!out.size && ctx.student.class && ctx.caller.schoolId) {
    // Roster kept only as text on the student row: match a class of the SAME school by grade + section.
    // (`classes` is shared across schools; if this deployment has no classes.school_id, skip the fallback.)
    const { data: cands, error } = await ctx.admin.from("classes").select("id, name, section").eq("school_id", ctx.caller.schoolId).limit(500);
    if (!error) for (const c of cands ?? []) if (norm(c.name) === norm(ctx.student.class) && sec(c.section) === sec(ctx.student.section)) out.set(c.id, c);
  }
  return [...out.values()];
}

async function membership(ctx: Ctx, classId: string): Promise<Member | null> {
  const { caller, admin } = ctx;
  if (caller.role === "teacher") {
    const { data } = await admin.from("class_teachers").select("id").eq("class_id", classId).eq("teacher_id", caller.userId).limit(1);
    return data?.length ? "teacher" : null;
  }
  if (STAFF_ADMINS.includes(caller.role)) return (await canStaffAccessClass(admin, caller, classId)).ok ? "staff" : null;
  if (caller.role === "student") return (await studentClasses(ctx)).some((c) => c.id === classId) ? "student" : null;
  return null;
}

/** Student ids on the class: class_students plus students whose class/section text matches (same school). */
async function rosterOf(ctx: Ctx, cls: Row): Promise<string[]> {
  const ids = new Set<string>();
  const { data: links } = await ctx.admin.from("class_students").select("student_id").eq("class_id", cls.id);
  for (const l of links ?? []) ids.add(l.student_id);
  if (ctx.caller.schoolId) {
    const { data: text } = await ctx.admin.from("students").select("id, class, section").eq("school_id", ctx.caller.schoolId)
      .ilike("class", String(cls.name).replace(/[%_]/g, "")).limit(500);
    for (const s of text ?? []) if (sec(s.section) === sec(cls.section)) ids.add(s.id);
  }
  return [...ids];
}

async function profileNames(admin: any, ids: string[]): Promise<Map<string, { name: string; role: string }>> {
  const out = new Map<string, { name: string; role: string }>();
  if (!ids.length) return out;
  const { data } = await admin.from("profiles").select("id, full_name, role").in("id", [...new Set(ids)]);
  for (const p of data ?? []) out.set(p.id, { name: p.full_name || "Member", role: p.role });
  return out;
}

/** Homework set by THIS class's teachers for its grade + section (homework rows carry the class only as text). */
async function homeworkFor(admin: any, cls: Row): Promise<Row[]> {
  const { data: teachers } = await admin.from("class_teachers").select("teacher_id").eq("class_id", cls.id);
  const teacherIds = [...new Set((teachers ?? []).map((t: Row) => t.teacher_id))];
  if (!teacherIds.length) return [];
  for (const col of ["assigned_by", "teacher_id"]) { // deployed schemas differ
    const { data, error } = await admin.from("homework_assignments").select("*").in(col, teacherIds).limit(300);
    if (error) continue;
    return (data ?? []).filter((h: Row) =>
      norm(h.class_level ?? h.class_grade ?? h.class_name) === norm(cls.name) && (!h.section || sec(h.section) === sec(cls.section)));
  }
  return [];
}

async function overview(ctx: Ctx, classIdIn: unknown): Promise<Response> {
  const { admin, caller } = ctx;
  let classes: Row[] = [];
  if (caller.role === "teacher") {
    const { data } = await admin.from("class_teachers").select("classes(id, name, section)").eq("teacher_id", caller.userId);
    classes = [...new Map((data ?? []).filter((r: Row) => r.classes).map((r: Row) => [r.classes.id, r.classes])).values()];
  } else if (caller.role === "student") {
    classes = await studentClasses(ctx);
  }
  classes.sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }));

  const classId = UUID_RE.test(String(classIdIn)) ? String(classIdIn) : classes[0]?.id;
  if (!classId) return json({ classes: [], class: null });
  const member = await membership(ctx, classId);
  if (!member) return json({ error: "You are not part of this class" }, 403);
  const { data: cls } = await admin.from("classes").select("id, name, section").eq("id", classId).maybeSingle();
  if (!cls) return json({ error: "Class not found" }, 404);
  const moderator = member !== "student";
  const today = new Date().toISOString().slice(0, 10);

  const [postsRes, matsRes, sessRes, papersRes, homework, roster] = await Promise.all([
    admin.from("classroom_posts").select("*").eq("class_id", classId).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(50),
    admin.from("classroom_materials").select("*").eq("class_id", classId).order("created_at", { ascending: false }).limit(200),
    admin.from("virtual_classroom_sessions").select("id, title, subject, meet_link, scheduled_start, scheduled_end, status")
      .eq("class_id", classId).gte("scheduled_end", new Date(Date.now() - 3600000).toISOString()).order("scheduled_start").limit(10),
    admin.from("generated_assessment_paper_assignments").select("id, title, due_at, opens_at, is_mock, time_limit_minutes, created_at")
      .eq("class_id", classId).order("created_at", { ascending: false }).limit(30),
    homeworkFor(admin, cls),
    rosterOf(ctx, cls),
  ]);

  const posts: Row[] = postsRes.data ?? [];
  const { data: comments } = posts.length
    ? await admin.from("classroom_post_comments").select("*").in("post_id", posts.map((p) => p.id)).order("created_at")
    : { data: [] };
  const people = await profileNames(admin, [...posts.map((p) => p.author_id), ...(comments ?? []).map((c: Row) => c.author_id), ...(matsRes.data ?? []).map((m: Row) => m.uploaded_by)]);
  const who = (id: string) => ({ id, name: people.get(id)?.name ?? "Member", role: people.get(id)?.role ?? "" });

  const mats: Row[] = matsRes.data ?? [];
  const filePaths = mats.filter((m) => m.kind === "file" && m.storage_path).map((m) => m.storage_path);
  const signed = new Map<string, string>();
  if (filePaths.length) {
    const { data } = await admin.storage.from(BUCKET).createSignedUrls(filePaths, 3600);
    for (const s of data ?? []) if (s.signedUrl && s.path) signed.set(s.path, s.signedUrl);
  }

  // Tests: students also see their own attempt status.
  const papers: Row[] = papersRes.data ?? [];
  const attemptBy = new Map<string, string>();
  if (ctx.student && papers.length) {
    const { data } = await admin.from("generated_assessment_paper_attempts").select("assignment_id, status")
      .eq("student_id", ctx.student.id).in("assignment_id", papers.map((p) => p.id));
    for (const a of data ?? []) attemptBy.set(a.assignment_id, a.status);
  }
  const visiblePapers = ctx.student ? papers.filter((p) => attemptBy.has(p.id)) : papers;

  // Attendance: today's register for teachers/staff, the student's own recent record for students.
  let attendance: Row;
  if (moderator) {
    const names = await loadStudentNames(admin, roster);
    const { data: fallbackNames } = roster.length ? await admin.from("students").select("id, full_name").in("id", roster) : { data: [] };
    for (const s of fallbackNames ?? []) if (!names.has(s.id) && s.full_name) names.set(s.id, s.full_name);
    const { data: rows } = roster.length
      ? await admin.from("attendance_records").select("student_id, status").eq("class_id", classId).eq("date", today).is("period_number", null)
      : { data: [] };
    const statusOf = new Map((rows ?? []).map((r: Row) => [r.student_id, r.status]));
    attendance = {
      date: today,
      roster: roster.map((id) => ({ student_id: id, name: names.get(id) ?? "Student", status: statusOf.get(id) ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } else {
    const { data: rows } = await admin.from("attendance_records").select("date, status").eq("student_id", ctx.student!.id)
      .order("date", { ascending: false }).limit(30);
    const list = rows ?? [];
    const present = list.filter((r: Row) => ["present", "late", "half_day"].includes(r.status)).length;
    attendance = { recent: list.slice(0, 10), present_pct: list.length ? Math.round((present / list.length) * 100) : null };
  }

  return json({
    classes: classes.map((c) => ({ id: c.id, label: label(c) })),
    class: { id: cls.id, label: label(cls), roster_size: roster.length },
    role: member,
    me: caller.userId,
    posts: posts.map((p) => ({
      id: p.id, kind: p.kind, body: p.body, pinned: p.pinned, created_at: p.created_at, author: who(p.author_id),
      can_delete: moderator || p.author_id === caller.userId,
      comments: (comments ?? []).filter((c: Row) => c.post_id === p.id)
        .map((c: Row) => ({ id: c.id, body: c.body, created_at: c.created_at, author: who(c.author_id) })),
    })),
    materials: mats.map((m) => ({
      id: m.id, title: m.title, description: m.description, topic: m.topic, kind: m.kind,
      url: m.kind === "link" ? m.url : signed.get(m.storage_path) ?? null,
      file_name: m.file_name, mime_type: m.mime_type, size_bytes: m.size_bytes, created_at: m.created_at, uploaded_by: who(m.uploaded_by).name,
      body: m.kind === "text" ? m.body : null, // e.g. a differentiated version shared from the Differentiation Studio
    })),
    assignments: [
      ...homework.slice(0, 30).map((h) => ({
        id: h.id, type: "homework", title: h.period_title || h.topic || h.title || `${h.subject ?? ""} homework`.trim(),
        subject: h.subject ?? null, due: h.due_date ?? null, created_at: h.created_at ?? h.assigned_at ?? null, status: null,
      })),
      ...visiblePapers.map((p) => ({
        id: p.id, type: p.is_mock ? "mock_exam" : "test", title: p.title, subject: null, due: p.due_at, created_at: p.created_at,
        status: attemptBy.get(p.id) ?? null, time_limit_minutes: p.time_limit_minutes,
      })),
    ].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))),
    sessions: sessRes.data ?? [],
    attendance,
  });
}

export async function handleDigitalClassroom(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const caller = await resolveCaller(admin, user.id);
    if (!caller || !["teacher", "student", ...STAFF_ADMINS].includes(caller.role)) return json({ error: "Not permitted" }, 403);
    const { data: student } = caller.role === "student"
      ? await admin.from("students").select("id, class, section").eq("profile_id", user.id).maybeSingle()
      : { data: null };
    const ctx: Ctx = { admin, caller, student };

    const body = await req.json().catch(() => ({}));
    const op = String(body.op ?? "overview");
    if (op === "overview") return await overview(ctx, body.class_id);

    // Everything below acts on one class; resolve it and the caller's place in it.
    let classId = String(body.class_id ?? "");
    let post: Row | null = null;
    if (op === "comment" || op === "delete_post" || op === "pin_post") {
      if (!UUID_RE.test(String(body.post_id))) return json({ error: "post_id is required" }, 400);
      const { data } = await admin.from("classroom_posts").select("*").eq("id", body.post_id).maybeSingle();
      if (!data) return json({ error: "Post not found" }, 404);
      post = data; classId = data.class_id;
    }
    let material: Row | null = null;
    if (op === "material_delete") {
      if (!UUID_RE.test(String(body.id))) return json({ error: "id is required" }, 400);
      const { data } = await admin.from("classroom_materials").select("*").eq("id", body.id).maybeSingle();
      if (!data) return json({ error: "Material not found" }, 404);
      material = data; classId = data.class_id;
    }
    if (!UUID_RE.test(classId)) return json({ error: "class_id is required" }, 400);
    const member = await membership(ctx, classId);
    if (!member) return json({ error: "You are not part of this class" }, 403);
    const moderator = member !== "student";
    const needModerator = () => json({ error: "Only the class teacher can do that" }, 403);

    switch (op) {
      case "post": {
        const content = text(body.body, 5000);
        if (!content) return json({ error: "Write something first" }, 400);
        const kind = ["announcement", "discussion", "question"].includes(body.kind) ? body.kind : "discussion";
        if (kind === "announcement" && !moderator) return needModerator();
        const { data, error } = await admin.from("classroom_posts").insert({ class_id: classId, author_id: user.id, kind, body: content }).select("id").single();
        if (error) throw new Error(error.message);
        return json({ id: data.id });
      }
      case "comment": {
        const content = text(body.body, 2000);
        if (!content) return json({ error: "Write something first" }, 400);
        const { data, error } = await admin.from("classroom_post_comments").insert({ post_id: post!.id, author_id: user.id, body: content }).select("id").single();
        if (error) throw new Error(error.message);
        return json({ id: data.id });
      }
      case "delete_post": {
        if (!moderator && post!.author_id !== user.id) return needModerator();
        const { error } = await admin.from("classroom_posts").delete().eq("id", post!.id);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case "pin_post": {
        if (!moderator) return needModerator();
        const { error } = await admin.from("classroom_posts").update({ pinned: body.pinned === true, updated_at: new Date().toISOString() }).eq("id", post!.id);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case "material_upload_url": {
        if (!moderator) return needModerator();
        const name = text(body.file_name, 150).replace(/[^\w.\- ]+/g, "_") || "file";
        const path = `${classId}/${crypto.randomUUID()}-${name}`;
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error) throw new Error(error.message);
        return json({ path: data.path ?? path, token: data.token });
      }
      case "material_add": {
        if (!moderator) return needModerator();
        const title = text(body.title, 200);
        if (!title) return json({ error: "Give the material a title" }, 400);
        const kind = body.kind === "file" ? "file" : "link";
        const row: Row = {
          class_id: classId, uploaded_by: user.id, title, kind,
          description: text(body.description, 1000) || null, topic: text(body.topic, 120) || null,
        };
        if (kind === "link") {
          const url = text(body.url, 1000);
          if (!/^https?:\/\//i.test(url)) return json({ error: "Links must start with http:// or https://" }, 400);
          row.url = url;
        } else {
          const path = text(body.storage_path, 400);
          if (!path.startsWith(`${classId}/`)) return json({ error: "Upload the file first" }, 400);
          Object.assign(row, {
            storage_path: path, file_name: text(body.file_name, 200) || null, mime_type: text(body.mime_type, 120) || null,
            size_bytes: Number.isFinite(Number(body.size_bytes)) ? Number(body.size_bytes) : null,
          });
        }
        const { data, error } = await admin.from("classroom_materials").insert(row).select("id").single();
        if (error) throw new Error(error.message);
        return json({ id: data.id });
      }
      case "material_delete": {
        if (!moderator) return needModerator();
        if (material!.storage_path) await admin.storage.from(BUCKET).remove([material!.storage_path]);
        const { error } = await admin.from("classroom_materials").delete().eq("id", material!.id);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case "attendance_save": {
        if (!moderator) return needModerator();
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) ? String(body.date) : null;
        if (!date) return json({ error: "date must be YYYY-MM-DD" }, 400);
        if (!caller.schoolId) return json({ error: "Your profile has no school" }, 400);
        const { data: cls } = await admin.from("classes").select("id, name, section").eq("id", classId).single();
        const roster = new Set(await rosterOf(ctx, cls));
        const marks = Object.entries((body.marks ?? {}) as Record<string, string>).filter(([sid, st]) => roster.has(sid) && ATTENDANCE.includes(st));
        if (!marks.length) return json({ error: "Nothing to save" }, 400);
        const { data: existing } = await admin.from("attendance_records").select("id, student_id").eq("class_id", classId).eq("date", date).is("period_number", null);
        const idOf = new Map((existing ?? []).map((r: Row) => [r.student_id, r.id]));
        const inserts = marks.filter(([sid]) => !idOf.has(sid)).map(([sid, status]) => ({
          school_id: caller.schoolId, class_id: classId, student_id: sid, date, period_number: null, status, marked_by: user.id,
        }));
        if (inserts.length) {
          const { error } = await admin.from("attendance_records").insert(inserts);
          if (error) throw new Error(error.message);
        }
        for (const [sid, status] of marks.filter(([sid]) => idOf.has(sid))) {
          const { error } = await admin.from("attendance_records").update({ status, marked_by: user.id }).eq("id", idOf.get(sid));
          if (error) throw new Error(error.message);
        }
        return json({ saved: marks.length });
      }
      default:
        return json({ error: "Unknown op" }, 400);
    }
  } catch (e) {
    console.error("digital-classroom error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
