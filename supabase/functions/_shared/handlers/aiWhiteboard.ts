// supabase/functions/_shared/handlers/aiWhiteboard.ts
//
// AI WHITEBOARD (sheet row 27). Not a standalone edge function (deployment limit): `ai-teacher-assistant`
// routes to it via action "whiteboard_draw" - see _shared/mergedRouter.ts.
//
// Body: { action: "whiteboard_draw", prompt: string, grade?: string, subject?: string, max_steps?: 2-10 }
// Returns: { title, steps: [{ caption, elements: [...] }], model }  - see whiteboardModel.ts for the element shapes.
//
// Any signed-in teacher/staff member or student may call it (students draw on boards their teacher unlocked).
// Saves nothing; the board itself is persisted by the client exactly like a hand drawing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAi, getAiConfig } from "../aiClient.ts";
import { parseAiJson } from "../iepModel.ts";
import { buildWhiteboardPrompt, MAX_STEPS, sanitiseDrawing, WHITEBOARD_SYSTEM_PROMPT } from "../whiteboardModel.ts";
import { corsHeaders, json } from "../learningGroupsData.ts";
import { STAFF_ROLES } from "../studentAccess.ts";

const MAX_PROMPT = 600;

export async function handleAiWhiteboard(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (!profile || ![...STAFF_ROLES, "student"].includes(profile.role)) return json({ error: "Not permitted" }, 403);

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, MAX_PROMPT) : "";
    if (prompt.length < 3) return json({ error: "Describe what to draw" }, 400);
    const maxSteps = Math.min(MAX_STEPS, Math.max(2, Number(body.max_steps) || 6));

    const result = await callAi(
      getAiConfig(),
      buildWhiteboardPrompt({ prompt, grade: body.grade ?? null, subject: body.subject ?? null, maxSteps }),
      { system: WHITEBOARD_SYSTEM_PROMPT, temperature: 0.3, maxOutputTokens: 8192 },
    );
    const drawing = sanitiseDrawing(parseAiJson(result.text), maxSteps);
    if (!drawing) return json({ error: "The AI could not produce a drawing for that. Try rephrasing the request." }, 502);
    return json({ ...drawing, model: result.model });
  } catch (e) {
    console.error("ai-whiteboard error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
