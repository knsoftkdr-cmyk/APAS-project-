// supabase/functions/_shared/handlers/differentiation.ts
//
// AI-ASSISTED DIFFERENTIATION (sheet row 46). Not a standalone edge function (deployment limit):
// `ai-teacher-assistant` routes to it via action "differentiate" - see _shared/mergedRouter.ts.
//
//   op "generate" { topic, material_type, versions[], subject?, grade?, objective?, language?, class_id?, book_id?, chapter_id? }
//                 -> generates and SAVES a pack (differentiation_packs); returns it
//   op "list"     {}                                  -> the caller's last 30 packs (summary)
//   op "get"      { id }                              -> one pack
//   op "delete"   { id }
//   op "share"    { id, version_key, class_id }       -> posts that version (student view: no answers) to the
//                                                        class's Digital Classroom materials (kind 'text')
//
// With class_id, the class's current learning groups (student_learning_groups: remedial / regular / enrichment)
// tell the model how many students each version is for. With chapter_id, chapter + learning objectives ground it.
// Only counts reach the model, never student names.

// deno-lint-ignore-file no-explicit-any
import { callAi, getAiConfig } from "../aiClient.ts";
import { parseAiJson } from "../iepModel.ts";
import {
  buildDiffPrompt, DIFF_SYSTEM_PROMPT, MATERIAL_TYPES, sanitiseDiffPack, studentMarkdown, VERSION_KEYS,
  type DiffVersion, type MaterialType, type VersionKey,
} from "../differentiationModel.ts";
import { authenticateStaff, corsHeaders, json, UUID_RE } from "../learningGroupsData.ts";
import { canStaffAccessClass } from "../studentAccess.ts";

type Row = Record<string, any>;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function handleDifferentiation(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { admin, caller, userId } = auth.ctx;
    const body = await req.json().catch(() => ({}));
    const op = String(body.op ?? "generate");

    if (op === "list") {
      const { data } = await admin.from("differentiation_packs").select("id, topic, subject, grade, material_type, versions, created_at, class_id")
        .eq("teacher_id", userId).order("created_at", { ascending: false }).limit(30);
      return json({ packs: (data ?? []).map((p: Row) => ({ ...p, versions: (p.versions ?? []).map((v: Row) => ({ key: v.key, label: v.label })) })) });
    }

    if (op === "get" || op === "delete" || op === "share") {
      if (!UUID_RE.test(String(body.id))) return json({ error: "id is required" }, 400);
      const { data: pack } = await admin.from("differentiation_packs").select("*").eq("id", body.id).eq("teacher_id", userId).maybeSingle();
      if (!pack) return json({ error: "Pack not found" }, 404);
      if (op === "get") return json({ pack });
      if (op === "delete") {
        await admin.from("differentiation_packs").delete().eq("id", pack.id);
        return json({ ok: true });
      }
      // share
      const version = (pack.versions ?? []).find((v: DiffVersion) => v.key === body.version_key) as DiffVersion | undefined;
      if (!version) return json({ error: "Choose a version to share" }, 400);
      if (!UUID_RE.test(String(body.class_id))) return json({ error: "Choose a class" }, 400);
      const access = await canStaffAccessClass(admin, caller, String(body.class_id));
      if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      const title = pack.request?.title ?? pack.topic;
      const { data, error } = await admin.from("classroom_materials").insert({
        class_id: body.class_id, uploaded_by: userId, kind: "text", title: `${title} - ${version.label}`.slice(0, 200),
        topic: pack.topic, description: version.for_whom || null,
        body: studentMarkdown({ title, learning_objective: pack.request?.learning_objective ?? "" }, version),
      }).select("id").single();
      if (error) throw new Error(error.message);
      return json({ material_id: data.id });
    }

    if (op !== "generate") return json({ error: "Unknown op" }, 400);

    // ── generate ────────────────────────────────────────────────────────────────────────────
    const topic = str(body.topic, 300);
    if (topic.length < 3) return json({ error: "Enter a topic" }, 400);
    const materialType = (Object.keys(MATERIAL_TYPES).includes(body.material_type) ? body.material_type : "worksheet") as MaterialType;
    const versions = [...new Set((Array.isArray(body.versions) ? body.versions : []).filter((k: string) => VERSION_KEYS.includes(k as VersionKey)))] as VersionKey[];
    if (versions.length < 2) return json({ error: "Pick at least two versions" }, 400);

    let classId: string | null = null;
    let groupCounts: Record<string, number> | null = null;
    if (UUID_RE.test(String(body.class_id ?? ""))) {
      const access = await canStaffAccessClass(admin, caller, String(body.class_id));
      if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      classId = String(body.class_id);
      let q = admin.from("student_learning_groups").select("tier, book_id").eq("class_id", classId);
      if (Number(body.book_id) > 0) q = q.eq("book_id", Number(body.book_id));
      const { data: groups } = await q;
      if (groups?.length) {
        groupCounts = { remedial: 0, regular: 0, enrichment: 0 };
        for (const g of groups) groupCounts[g.tier] = (groupCounts[g.tier] ?? 0) + 1;
      }
    }

    let curriculumNotes: string | null = null;
    if (Number(body.chapter_id) > 0) {
      const { data: ch } = await admin.from("curriculum_chapters").select("chapter_name").eq("id", Number(body.chapter_id)).maybeSingle();
      const { data: topics } = await admin.from("topics").select("id, topic_name").eq("chapter_id", Number(body.chapter_id)).limit(30);
      const topicIds = (topics ?? []).map((t: Row) => t.id);
      const { data: subs } = topicIds.length ? await admin.from("subtopics").select("id").in("topic_id", topicIds).limit(200) : { data: [] };
      const { data: los } = (subs ?? []).length
        ? await admin.from("learning_objectives").select("objective_text").in("subtopic_id", subs.map((s: Row) => s.id)).limit(15)
        : { data: [] };
      curriculumNotes = [
        ch?.chapter_name ? `Chapter: ${ch.chapter_name}` : "",
        (topics ?? []).length ? `Topics: ${(topics ?? []).map((t: Row) => t.topic_name).join("; ")}` : "",
        (los ?? []).length ? `Learning objectives:\n- ${(los ?? []).map((l: Row) => l.objective_text).join("\n- ")}` : "",
      ].filter(Boolean).join("\n") || null;
    }

    const request = {
      topic, subject: str(body.subject, 80) || null, grade: str(body.grade, 40) || null, objective: str(body.objective, 400) || null,
      materialType, versions, language: str(body.language, 40) || null, groupCounts, curriculumNotes,
    };
    const result = await callAi(getAiConfig(), buildDiffPrompt(request), { system: DIFF_SYSTEM_PROMPT, temperature: 0.5, maxOutputTokens: 16384 });
    const pack = sanitiseDiffPack(parseAiJson(result.text), versions);
    if (!pack) return json({ error: "The AI could not produce the materials. Try again or simplify the topic." }, 502);

    const { data: saved, error } = await admin.from("differentiation_packs").insert({
      teacher_id: userId, school_id: caller.schoolId, class_id: classId, topic, subject: request.subject, grade: request.grade,
      material_type: materialType, versions: pack.versions, model: result.model,
      request: { title: pack.title, learning_objective: pack.learning_objective, versions, language: request.language, group_counts: groupCounts },
    }).select("id, created_at").single();
    if (error) throw new Error(error.message);
    return json({ id: saved.id, created_at: saved.created_at, ...pack, group_counts: groupCounts, model: result.model });
  } catch (e) {
    console.error("differentiation error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
