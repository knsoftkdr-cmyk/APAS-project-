// supabase/functions/_shared/handlers/aiWhiteboard.ts
//
// AI WHITEBOARD (sheet row 27). Not a standalone edge function (deployment limit): `ai-teacher-assistant`
// routes to it via action "whiteboard_draw" - see _shared/mergedRouter.ts.
//
// Body: { action: "whiteboard_draw", prompt: string, grade?: string, subject?: string, max_steps?: 2-10,
//         style?: "illustration" (default) | "board" }
// Returns: illustration -> { kind: "illustration", title, steps: [{ caption }], svg, model }
//          board        -> { kind: "board", title, steps: [{ caption, elements: [...] }], model }
// If the illustration comes back unusable, it falls back to the board drawing so the teacher still gets one.
// See whiteboardModel.ts for both shapes.
//
// Any signed-in teacher/staff member or student may call it (students draw on boards their teacher unlocked).
// Saves nothing; the board itself is persisted by the client exactly like a hand drawing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAi, getAiConfig } from "../aiClient.ts";
import { parseAiJson } from "../iepModel.ts";
import {
  buildIllustrationPrompt, buildWhiteboardPrompt, ILLUSTRATION_SYSTEM_PROMPT, MAX_STEPS, sanitiseDrawing, sanitiseIllustration,
  WHITEBOARD_SYSTEM_PROMPT,
} from "../whiteboardModel.ts";
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

    const input = { prompt, grade: body.grade ?? null, subject: body.subject ?? null, maxSteps };
    const cfg = getAiConfig();

    if (body.style !== "board") {
      try {
        // Thinking on: a correct, well laid-out picture needs the model to plan positions before drawing.
        const pic = await callAi(cfg, buildIllustrationPrompt(input), {
          system: ILLUSTRATION_SYSTEM_PROMPT, temperature: 0.3, maxOutputTokens: 32768, reasoning: true,
        });
        const illustration = sanitiseIllustration(parseAiJson(pic.text), maxSteps);
        if (illustration) return json({ kind: "illustration", ...illustration, model: pic.model });
        console.warn("ai-whiteboard: unusable illustration, falling back to board drawing");
      } catch (e) {
        console.warn("ai-whiteboard: illustration failed, falling back to board drawing", e);
      }
    }

    const result = await callAi(cfg, buildWhiteboardPrompt(input), {
      system: WHITEBOARD_SYSTEM_PROMPT, temperature: 0.2, maxOutputTokens: 8192,
    });
    const drawing = sanitiseDrawing(parseAiJson(result.text), maxSteps);
    if (!drawing) return json({ error: "The AI could not produce a drawing for that. Try rephrasing the request." }, 502);
    return json({ kind: "board", ...drawing, model: result.model });
  } catch (e) {
    console.error("ai-whiteboard error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
