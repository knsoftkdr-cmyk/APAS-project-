import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Structured output schema — Gemini returns exactly this shape as JSON.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    grade: { type: "STRING" },
    total_score: { type: "NUMBER" },
    max_score: { type: "NUMBER" },
    questions_attempted: { type: "INTEGER" },
    questions_total: { type: "INTEGER" },
    overall_feedback: { type: "STRING" },
    question_scores: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question_no: { type: "STRING" },
          marks_awarded: { type: "NUMBER" },
          marks_total: { type: "NUMBER" },
          status: { type: "STRING", enum: ["full", "partial", "low_zero", "needs_review"] },
          page_number: { type: "INTEGER" },
        },
        required: ["question_no", "marks_awarded", "marks_total", "status", "page_number"],
        propertyOrdering: ["question_no", "marks_awarded", "marks_total", "status", "page_number"],
      },
    },
    topic_proficiency: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" },
          proficiency_percent: { type: "INTEGER" },
          status: { type: "STRING", enum: ["strong", "weak", "critical_gap"] },
          evidence_recall: { type: "STRING", enum: ["correct", "partial", "wrong", "not_tested"] },
          evidence_conceptual: { type: "STRING", enum: ["correct", "partial", "wrong", "not_tested"] },
          evidence_application: { type: "STRING", enum: ["correct", "partial", "wrong", "not_tested"] },
          evidence_assertion_reason: { type: "STRING", enum: ["correct", "partial", "wrong", "not_tested"] },
          evidence_numerical: { type: "STRING", enum: ["correct", "partial", "wrong", "not_tested"] },
          evidence_derivation: { type: "STRING", enum: ["correct", "partial", "wrong", "not_tested"] },
        },
        required: ["topic", "proficiency_percent", "status"],
        propertyOrdering: [
          "topic", "proficiency_percent", "status",
          "evidence_recall", "evidence_conceptual", "evidence_application",
          "evidence_assertion_reason", "evidence_numerical", "evidence_derivation",
        ],
      },
    },
    study_plan: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          priority: { type: "INTEGER" },
          title: { type: "STRING" },
          description: { type: "STRING" },
        },
        required: ["priority", "title", "description"],
        propertyOrdering: ["priority", "title", "description"],
      },
    },
    pages: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          page_number: { type: "INTEGER" },
          annotations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                question_no: { type: "STRING" },
                box_2d: {
                  type: "ARRAY",
                  items: { type: "INTEGER" },
                  description: "Bounding box as [ymin, xmin, ymax, xmax], normalized 0-1000",
                },
                status: { type: "STRING", enum: ["correct", "partial", "wrong"] },
                comment: { type: "STRING", description: "Short explanation of what was right/wrong" },
              },
              required: ["question_no", "box_2d", "status", "comment"],
              propertyOrdering: ["question_no", "box_2d", "status", "comment"],
            },
          },
        },
        required: ["page_number", "annotations"],
        propertyOrdering: ["page_number", "annotations"],
      },
    },
  },
  required: [
    "grade", "total_score", "max_score", "questions_attempted", "questions_total",
    "overall_feedback", "question_scores", "topic_proficiency", "study_plan", "pages",
  ],
  propertyOrdering: [
    "grade", "total_score", "max_score", "questions_attempted", "questions_total",
    "overall_feedback", "question_scores", "topic_proficiency", "study_plan", "pages",
  ],
};

const EVALUATION_PROMPT = `You are an expert teacher grading a student's handwritten assessment answer sheet.

You will be given one or more images, each a full page of the student's answer sheet, in page order.

For each question you can identify on the pages:
1. Determine the question number as written (e.g. "1", "12.a)", "18.2 OR").
2. Read the student's handwritten work carefully, including crossed-out attempts, corrections, and final answers.
3. Award marks out of the total marks for that question, based on standard grading (working, method, final answer).
4. Classify status: "full" (full marks), "partial" (some marks), "low_zero" (little to no marks, incorrect), "needs_review" (illegible or ambiguous - flag for teacher).
5. Identify the curriculum topic each question tests (e.g. "Graphical solution of linear equations", "Prime Factorization", "Relationship between zeroes and coefficients").
6. For each question, give a bounding box (box_2d: [ymin, xmin, ymax, xmax], normalized 0-1000 relative to the page image) tightly around that question's answer region on the page it appears on, and a short comment (1-2 sentences) explaining what was right or wrong. Be specific: name the exact mistake (e.g. "Sign error when transposing -6y to the other side" rather than "incorrect answer").

Then aggregate:
- Overall grade (letter grade appropriate to score, e.g. "A+", "B", "C-").
- total_score and max_score across all questions.
- questions_attempted and questions_total counts.
- overall_feedback: 2-3 sentence summary of overall performance.
- topic_proficiency: for each distinct topic tested, compute a proficiency_percent (0-100) based on performance on that topic across all questions testing it, a status ("strong" >=70%, "weak" 40-69%, "critical_gap" <40%), and which question-types (recall/conceptual/application/assertion_reason/numerical/derivation) were tested for that topic and whether the student got them correct/partial/wrong (use "not_tested" if that type wasn't tested for this topic).
- study_plan: prioritized list (priority 1 = most urgent) of 2-4 topics to fix first, based on which critical_gap or weak topics have the most marks impact, each with a short actionable description.

Be strict and specific. Do not guess marks generously - grade based on what is actually mathematically/factually correct in the handwriting shown.

Return ONLY the JSON matching the provided schema. No markdown, no preamble.`;

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const geminiApiKey = Deno.env.get("Worksheet_gemini_api_key")!;

    // Client scoped to the caller's JWT so RLS enforces teacher_id ownership automatically.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { evaluation_ids } = await req.json();
    if (!Array.isArray(evaluation_ids) || evaluation_ids.length === 0) {
      return new Response(JSON.stringify({ error: "evaluation_ids array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];

    for (const evaluationId of evaluation_ids) {
      try {
        const { data: evalRow, error: evalErr } = await supabase
          .from("assessment_evaluations")
          .select("*")
          .eq("id", evaluationId)
          .single();
        if (evalErr || !evalRow) throw new Error("Evaluation not found or not accessible");

        const { data: pageRows, error: pageErr } = await supabase
          .from("assessment_page_annotations")
          .select("*")
          .eq("evaluation_id", evaluationId)
          .order("page_number", { ascending: true });
        if (pageErr) throw pageErr;
        if (!pageRows || pageRows.length === 0) {
          throw new Error("No page images found for this evaluation. Only PDF uploads are supported for AI evaluation.");
        }

        // Download each page image and encode as base64 for Gemini.
        const imageParts = [];
        for (const page of pageRows) {
          const { data: imgBlob, error: imgErr } = await supabase.storage
            .from("assessment-page-images")
            .download(page.image_path);
          if (imgErr || !imgBlob) throw new Error(`Could not download page ${page.page_number} image`);
          const arrayBuffer = await imgBlob.arrayBuffer();
          imageParts.push({
            inlineData: {
              mimeType: "image/png",
              data: base64FromArrayBuffer(arrayBuffer),
            },
          });
        }

        const geminiBody = {
          contents: [
            {
              role: "user",
              parts: [{ text: EVALUATION_PROMPT }, ...imageParts],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            maxOutputTokens: 16384,
          },
        };

        const geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${geminiApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
        });

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          throw new Error(`Gemini API error (${geminiRes.status}): ${errText.slice(0, 500)}`);
        }

        const geminiData = await geminiRes.json();
        const textPart = geminiData?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text;
        if (!textPart) throw new Error("Gemini returned no content");

        const report = JSON.parse(textPart);

        // Update summary fields on the evaluation row.
        const { error: updateErr } = await supabase
          .from("assessment_evaluations")
          .update({
            status: "ai_reviewed",
            ai_score: report.total_score,
            ai_feedback: report.overall_feedback,
            grade: report.grade,
            total_score: report.total_score,
            max_score: report.max_score,
            questions_attempted: report.questions_attempted,
            questions_total: report.questions_total,
            ai_reviewed_at: new Date().toISOString(),
          })
          .eq("id", evaluationId);
        if (updateErr) throw updateErr;

        // Replace question scores.
        await supabase.from("assessment_question_scores").delete().eq("evaluation_id", evaluationId);
        if (report.question_scores?.length) {
          const rows = report.question_scores.map((q: any) => ({
            evaluation_id: evaluationId,
            question_no: q.question_no,
            marks_awarded: q.marks_awarded,
            marks_total: q.marks_total,
            status: q.status,
            page_number: q.page_number,
          }));
          const { error } = await supabase.from("assessment_question_scores").insert(rows);
          if (error) throw error;
        }

        // Replace topic proficiency.
        await supabase.from("assessment_topic_proficiency").delete().eq("evaluation_id", evaluationId);
        if (report.topic_proficiency?.length) {
          const rows = report.topic_proficiency.map((t: any) => ({
            evaluation_id: evaluationId,
            topic: t.topic,
            proficiency_percent: t.proficiency_percent,
            status: t.status,
            evidence: {
              recall: t.evidence_recall ?? "not_tested",
              conceptual: t.evidence_conceptual ?? "not_tested",
              application: t.evidence_application ?? "not_tested",
              assertion_reason: t.evidence_assertion_reason ?? "not_tested",
              numerical: t.evidence_numerical ?? "not_tested",
              derivation: t.evidence_derivation ?? "not_tested",
            },
          }));
          const { error } = await supabase.from("assessment_topic_proficiency").insert(rows);
          if (error) throw error;
        }

        // Replace study plan.
        await supabase.from("assessment_study_plan").delete().eq("evaluation_id", evaluationId);
        if (report.study_plan?.length) {
          const rows = report.study_plan.map((p: any) => ({
            evaluation_id: evaluationId,
            priority: p.priority,
            title: p.title,
            description: p.description,
          }));
          const { error } = await supabase.from("assessment_study_plan").insert(rows);
          if (error) throw error;
        }

        // Update per-page annotations.
        if (report.pages?.length) {
          for (const pageResult of report.pages) {
            const matchingPage = pageRows.find((p) => p.page_number === pageResult.page_number);
            if (!matchingPage) continue;
            const { error } = await supabase
              .from("assessment_page_annotations")
              .update({ annotations: pageResult.annotations || [] })
              .eq("id", matchingPage.id);
            if (error) throw error;
          }
        }

        results.push({ evaluation_id: evaluationId, success: true });
      } catch (innerErr: any) {
        results.push({ evaluation_id: evaluationId, success: false, error: innerErr.message || String(innerErr) });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});