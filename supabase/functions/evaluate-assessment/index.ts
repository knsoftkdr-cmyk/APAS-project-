import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Structured output schema -- Gemini returns exactly this shape as JSON.
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
          subtopic: { type: "STRING", description: "The specific granular sub-skill this question tests, e.g. 'Prime Factorization', 'Coincident Lines Condition', 'Graphical solution of linear equations'. Must NOT be a broad chapter name." },
          identified_final_answer: { type: "STRING", description: "The students final, non-crossed-out answer only - ignore scratch attempts and any pre-existing red-pen marks already on the scan." },
          reasoning: { type: "STRING", description: "Your own independent derivation of the correct answer, compared to the students final answer. Do not defer to check marks, crosses, or circles already visible on the page." },
          rubric_criteria: {
            type: "ARRAY",
            description: "2-5 discrete scoring criteria checked for this question, each independently marked met or not, that together justify marks_awarded.",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING", description: "Short code like F1, F2, F3" },
                description: { type: "STRING", description: "What this criterion checks, e.g. 'Correct formula used'" },
                met: { type: "BOOLEAN" },
              },
              required: ["label", "description", "met"],
              propertyOrdering: ["label", "description", "met"],
            },
          },
          marks_awarded: { type: "NUMBER" },
          marks_total: { type: "NUMBER" },
          status: { type: "STRING", enum: ["full", "partial", "low_zero", "needs_review"] },
          page_number: { type: "INTEGER" },
        },
        required: ["question_no", "subtopic", "identified_final_answer", "reasoning", "rubric_criteria", "marks_awarded", "marks_total", "status", "page_number"],
        propertyOrdering: ["question_no", "subtopic", "identified_final_answer", "reasoning", "rubric_criteria", "marks_awarded", "marks_total", "status", "page_number"],
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
                status: { type: "STRING", enum: ["full", "partial", "low_zero", "needs_review"] },
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

You will be given TWO groups of images/files, clearly labeled with text markers before each group:

1. "QUESTION PAPER (ground truth - use this to know the actual questions, marks, and options)" - one or more pages/files showing the printed question paper for this assessment. This is the authoritative source for what each question asks, how many marks it carries, and what sub-parts or options exist. Do NOT infer the questions from the student's handwriting alone - always cross-check against this question paper first.
2. "STUDENT ANSWER SHEET (grade this)" - one or more images, each a full page of the student's handwritten answer sheet, in page order.

IMPORTANT - READING THE PAGES CORRECTLY:
- The answer sheet pages may already contain markings made by someone else before you: a human teacher's original red-pen ticks, crosses, circles, or scores from an earlier manual grading pass, invigilator signatures, stamps, or the student's own rough working in the margins. NONE of these pre-existing marks are reliable signals of correctness. Do not infer that an answer is right or wrong because it has been circled, boxed, ticked, or crossed by someone else on the page.
- Use the question paper to confirm exactly what each question asks and how many marks it is worth, then independently work out the correct answer or method yourself, then compare it to what the student wrote. Your grading must come from your own independent check against the question paper, never from pattern-matching existing pen marks.
- If the student crossed out or scratched out an attempt and then wrote a new answer, grade ONLY the student's final, non-crossed-out answer. Only fall back to grading the crossed-out work if no final answer was given for that question.
- If a question has multiple parts or sub-options (e.g. "OR" choices, multi-part a/b/c), use the question paper to see exactly what options were offered, identify which option or sub-part the student actually attempted, and grade that one.

For each question you can identify on the answer sheet pages (cross-referenced against the question paper):
1. Determine the question number as written on the question paper (e.g. "1", "12.a)", "18.2 OR").
2. Read the student's handwritten work carefully, including crossed-out attempts, corrections, and final answers - but grade only the final answer per the rules above.
3. State in your own words what the student's final answer/selected option actually is (this goes in identified_final_answer).
4. Independently derive the correct answer/method yourself using the question paper as the source of truth for what was actually asked, and briefly compare it to the student's final answer (this goes in reasoning). Be explicit about why marks are or aren't awarded.
5. Award marks out of the total marks for that question as shown on the question paper, based on standard grading (working, method, final answer).
6. Classify status: "full" (full marks), "partial" (some marks), "low_zero" (little to no marks, incorrect), "needs_review" (illegible or genuinely ambiguous after your own independent check - flag for teacher).
6a. Score the question against 2-5 explicit rubric_criteria, labeled F1, F2, F3... in the order checked, each with a short description of what it checks (e.g. "Correct formula used", "Correct substitution", "Correct final simplification") and whether the student met it. These criteria together must justify marks_awarded - if a criterion is unmet, that is where marks were lost.
7. Identify the specific, granular sub-skill each question tests - NOT the broad chapter/unit name, and NOT limited to any one subject. This applies to every subject (Maths, Science, English, Social Studies, etc.) - always go one level below the chapter/unit into the specific skill or concept actually being tested. Use labels like "Graphical solution of linear equations", "Prime Factorization", "Relationship between zeroes and coefficients of a polynomial", "Coincident Lines Condition", "Composite Number Identification" for Maths, or the equivalent granular skill for whatever subject this assessment is in (e.g. "Photosynthesis - light reactions" not "Biology", "Subject-verb agreement" not "Grammar"). Do NOT use broad chapter names as the topic value - these hide critical gaps by averaging distinct sub-skills together. Two questions from the same chapter almost always test different sub-skills and should get different topic values unless they genuinely test the identical one.
8. For each question, give a bounding box (box_2d: [ymin, xmin, ymax, xmax], normalized 0-1000 relative to the page image) tightly around that question's answer region on the STUDENT ANSWER SHEET page it appears on (never on the question paper), and a short comment (1-2 sentences) explaining what was right or wrong. Be specific: name the exact mistake (e.g. "Sign error when transposing -6y to the other side" rather than "incorrect answer").

BOUNDING BOX ACCURACY - this is critical and frequently gets it wrong, so follow these rules exactly:
- Before drawing a box, locate the actual handwritten ink for that question's answer on the STUDENT ANSWER SHEET page. Never draw a box over a blank ruled line, empty margin, or gap between answers just because it is near the right question number. Never draw a box on the question paper itself - boxes are only for the student's answer sheet.
- The box must tightly enclose only the handwritten content itself (the answer/working in that student's handwriting), not the surrounding blank lines above or below it.
- Self-check before finalizing each box: silently read what text/ink actually sits inside your proposed box_2d coordinates. If that row is blank, or contains only the printed question number/ruled line with no handwritten answer content, your coordinates are wrong by at least one row - shift down to the row where the handwritten ink actually starts and redo the check. The single most common error is anchoring on the ruled line directly above the answer (where the printed question number sits) instead of the line containing the actual handwritten ink - when in doubt, shift down one text-line height and re-verify.
- Question numbers are typically written in the left margin (e.g. "1", "2", "3") followed immediately by the student's answer on the same or next line. The box must start at the row containing the first stroke of handwritten ink, not the row containing only the question number label.
- If a question's answer spans multiple lines, the box should cover the full vertical span of that handwritten answer, still without including trailing blank lines.
- If you cannot confidently locate the handwritten answer for a question on any page, omit that question from the pages/annotations array entirely rather than guessing a box location.
- page_number in question_scores and pages must always refer to a STUDENT ANSWER SHEET page number, never a question paper page.

Then aggregate:
- Overall grade (letter grade appropriate to score, e.g. "A+", "B", "C-").
- total_score and max_score across all questions (max_score should reflect the marks shown on the question paper).
- questions_attempted and questions_total counts (questions_total from the question paper, questions_attempted from what the student actually answered).
- overall_feedback: 2-3 sentence summary of overall performance.
- topic_proficiency: for each distinct topic tested, compute a proficiency_percent (0-100) based on performance on that topic across all questions testing it, a status ("strong" >=70%, "weak" 40-69%, "critical_gap" <40%), and which question-types (recall/conceptual/application/assertion_reason/numerical/derivation) were tested for that topic and whether the student got them correct/partial/wrong (use "not_tested" if that type wasn't tested for this topic).
- study_plan: prioritized list (priority 1 = most urgent) of 2-4 topics to fix first, based on which critical_gap or weak topics have the most marks impact, each with a short actionable description.

Be strict, specific, and independent. Do not guess marks generously, and do not defer to any marks already present on the page - grade based on what is actually mathematically/factually correct in the handwriting shown, verified against the question paper and your own working.

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

// Deterministically recompute topic status/proficiency from the evidence values themselves,
// rather than trusting Gemini's own status/proficiency_percent fields directly. This guarantees
// a topic with any wrong evidence can never be labeled strong, and any partial can never be
// labeled strong either - closing the gap where the model's self-reported status and its own
// evidence marks could drift apart and contradict each other.
const EVIDENCE_KEYS = [
  "evidence_recall", "evidence_conceptual", "evidence_application",
  "evidence_assertion_reason", "evidence_numerical", "evidence_derivation",
] as const;

function computeTopicStatus(t: any): { status: string; proficiency_percent: number } {
  const values = EVIDENCE_KEYS
    .map((k) => t[k])
    .filter((v) => v && v !== "not_tested");

  if (values.length === 0) {
    return { status: t.status ?? "strong", proficiency_percent: t.proficiency_percent ?? 0 };
  }

  const hasWrong = values.some((v) => v === "wrong");
  const hasPartial = values.some((v) => v === "partial");

  const scoreOf = (v: string) => {
    if (v === "correct") return 100;
    if (v === "partial") return 50;
    return 0;
  };
  const proficiency_percent = Math.round(
    values.reduce((sum, v) => sum + scoreOf(v), 0) / values.length
  );

  const status = hasWrong ? "critical_gap" : hasPartial ? "weak" : "strong";

  return { status, proficiency_percent };
}

function mimeTypeForFile(fileName: string, fallback: string | null): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return fallback || "application/octet-stream";
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

    const body = await req.json();
    // Accept either a single evaluation_id, or an evaluation_ids array containing exactly one id.
    // Multi-evaluation batches must be fanned out as separate HTTP requests by the caller --
    // this function intentionally processes ONE evaluation per invocation to stay well under
    // the edge function wall-clock execution limit (a Gemini 2.5 Pro vision call with this
    // schema can take 60-90+ seconds on its own).
    let evaluationId: string | undefined = body.evaluation_id;
    if (!evaluationId && Array.isArray(body.evaluation_ids) && body.evaluation_ids.length > 0) {
      evaluationId = body.evaluation_ids[0];
    }
    if (!evaluationId) {
      return new Response(JSON.stringify({ error: "evaluation_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      // Mark as processing immediately so the frontend can show live status.
      await supabase
        .from("assessment_evaluations")
        .update({ status: "ai_processing" })
        .eq("id", evaluationId);

      const { data: evalRow, error: evalErr } = await supabase
        .from("assessment_evaluations")
        .select("*")
        .eq("id", evaluationId)
        .single();
      if (evalErr || !evalRow) throw new Error("Evaluation not found or not accessible");

      // A question paper must be linked before we can grade anything -- without it there is no
      // ground truth for what each question asks or how many marks it carries, so we fail
      // clearly here instead of letting Gemini guess the questions from the handwriting alone.
      if (!evalRow.assessment_paper_id) {
        throw new Error("No question paper linked to this evaluation. Please attach a question paper before running AI evaluation.");
      }

      const { data: paperRow, error: paperErr } = await supabase
        .from("assessment_papers")
        .select("*")
        .eq("id", evalRow.assessment_paper_id)
        .single();
      if (paperErr || !paperRow) throw new Error("Linked question paper not found or not accessible");

      const { data: paperBlob, error: paperDownloadErr } = await supabase.storage
        .from("assessment-question-papers")
        .download(paperRow.file_path);
      if (paperDownloadErr || !paperBlob) throw new Error("Could not download the linked question paper file");

      const paperArrayBuffer = await paperBlob.arrayBuffer();
      const paperMimeType = mimeTypeForFile(paperRow.file_name, paperRow.file_type);
      const questionPaperPart = {
        inlineData: {
          mimeType: paperMimeType,
          data: base64FromArrayBuffer(paperArrayBuffer),
        },
      };

      const { data: pageRows, error: pageErr } = await supabase
        .from("assessment_page_annotations")
        .select("*")
        .eq("evaluation_id", evaluationId)
        .order("page_number", { ascending: true });
      if (pageErr) throw pageErr;
      if (!pageRows || pageRows.length === 0) {
        throw new Error("No page images found for this evaluation. Only PDF uploads are supported for AI evaluation.");
      }

      // Download all answer sheet page images in parallel.
      const answerImageParts = await Promise.all(
        pageRows.map(async (page) => {
          const { data: imgBlob, error: imgErr } = await supabase.storage
            .from("assessment-page-images")
            .download(page.image_path);
          if (imgErr || !imgBlob) throw new Error(`Could not download page ${page.page_number} image`);
          const arrayBuffer = await imgBlob.arrayBuffer();
          return {
            inlineData: {
              mimeType: "image/png",
              data: base64FromArrayBuffer(arrayBuffer),
            },
          };
        })
      );

      const geminiBody = {
        contents: [
          {
            role: "user",
            parts: [
              { text: EVALUATION_PROMPT },
              { text: "QUESTION PAPER (ground truth - use this to know the actual questions, marks, and options):" },
              questionPaperPart,
              { text: "STUDENT ANSWER SHEET (grade this):" },
              ...answerImageParts,
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 2048 },
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
          subtopic: q.subtopic ?? null,
          identified_final_answer: q.identified_final_answer,
          reasoning: q.reasoning,
          rubric_criteria: q.rubric_criteria ?? [],
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
        const rows = report.topic_proficiency.map((t: any) => {
          const computed = computeTopicStatus(t);
          return {
            evaluation_id: evaluationId,
            topic: t.topic,
            proficiency_percent: computed.proficiency_percent,
            status: computed.status,
            evidence: {
              recall: t.evidence_recall ?? "not_tested",
              conceptual: t.evidence_conceptual ?? "not_tested",
              application: t.evidence_application ?? "not_tested",
              assertion_reason: t.evidence_assertion_reason ?? "not_tested",
              numerical: t.evidence_numerical ?? "not_tested",
              derivation: t.evidence_derivation ?? "not_tested",
            },
          };
        });
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

      return new Response(JSON.stringify({ results: [{ evaluation_id: evaluationId, success: true }] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (innerErr: any) {
      console.error(`evaluate-assessment error for evaluation_id=${evaluationId}:`, innerErr?.stack || innerErr?.message || String(innerErr));
      await supabase
        .from("assessment_evaluations")
        .update({ status: "ai_review_failed" })
        .eq("id", evaluationId)
        .then(() => {}, () => {});
      return new Response(
        JSON.stringify({ results: [{ evaluation_id: evaluationId, success: false, error: innerErr.message || String(innerErr) }] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
