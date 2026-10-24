// supabase/functions/_shared/handlers/conceptVisual.ts
//
// AI concept visualization (feature 37). Never a standalone edge function (Edge Function deployment limit):
// `cat-session` routes to it via action "concept_visual" - see _shared/mergedRouter.ts.
//
//   Body: { concept: string (2-80 chars), grade?: string, language?: "en" | "hi" | "te" | ... }
//
//   Response: { visual: { title, summary, steps[], parts[], analogy, check_question }, model: string }
//
// SAFE BY CONSTRUCTION
//   * Signed-in students and staff only. Nothing is read from or written to the database: no student data is
//     sent to the AI, only the topic text and (optionally) the class label.
//   * The topic is cleaned and length-limited, and is placed between markers in the prompt as a topic name only.
//   * The AI answer is validated and cleaned (no HTML, no links, capped sizes) before anything is returned.
//   * Not a chatbot: topics that are not school learning concepts are refused.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAi, getAiConfig } from "../aiClient.ts";
import { languageDirective, resolveTeachingLanguage } from "../languages.ts";
import { buildPrompt, parseVisualResponse, sanitizeConcept, sanitizeGrade } from "../conceptVisualModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = ["student", "teacher", "hod", "principal", "admin", "school_admin"];

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handleConceptVisual(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new HttpError(401, "Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) throw new HttpError(401, "Not authenticated");

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile) throw new HttpError(403, "Profile not found");
    if (!ALLOWED_ROLES.includes(profile.role)) throw new HttpError(403, "Not permitted");

    const body = await req.json().catch(() => ({}));
    const concept = sanitizeConcept(body.concept);
    if (!concept) {
      throw new HttpError(400, "Please type a short topic (2 to 80 characters), for example \"Water cycle\".", "bad_concept");
    }
    const grade = sanitizeGrade(body.grade);
    const lang = resolveTeachingLanguage(body.language);

    let cfg;
    try {
      cfg = getAiConfig();
    } catch (e) {
      console.error("concept-visual: AI not configured", e);
      throw new HttpError(503, "The visual helper is not available right now.", "ai_not_configured");
    }

    let text: string;
    let model: string;
    try {
      const out = await callAi(cfg, buildPrompt(concept, grade, languageDirective(lang)), {
        temperature: 0.4,
        maxOutputTokens: 4096,
      });
      text = out.text;
      model = out.model;
    } catch (e) {
      console.error("concept-visual: AI call failed", e);
      throw new HttpError(502, "Could not build the visual right now. Please try again.", "ai_failed");
    }

    const parsed = parseVisualResponse(text, concept);
    if (!parsed.ok) {
      if (parsed.reason === "refused") {
        throw new HttpError(422, "Please type a school topic, for example \"Photosynthesis\" or \"Fractions\".", "not_a_topic");
      }
      throw new HttpError(502, "Could not build the visual right now. Please try again.", "ai_bad_output");
    }

    return json({ visual: parsed.visual, model });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error("concept-visual error", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
