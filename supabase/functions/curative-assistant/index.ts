import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const encoder = new TextEncoder();

type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const toGeminiContents = (messages: OpenAIMessage[]) =>
  messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

// Fallback: wrap a complete text response into our OpenAI-compatible SSE format.
const buildSseStream = (text: string) =>
  new ReadableStream({
    start(controller) {
      const chunkSize = 80;
      for (let index = 0; index < text.length; index += chunkSize) {
        const chunk = text.slice(index, index + chunkSize);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
          ),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

// Pipe Gemini's native SSE (streamGenerateContent?alt=sse) into OpenAI-style
// SSE chunks. If Gemini stops with finishReason=MAX_TOKENS (or stream ends
// without a STOP signal), automatically request a continuation so the lesson
// plan completes fully instead of being cut off mid-generation.
const pipeGeminiSseToOpenAi = (
  initialBody: ReadableStream<Uint8Array>,
  continueRequest: (accumulated: string) => Promise<ReadableStream<Uint8Array> | null>,
) => {
  const decoder = new TextDecoder("utf-8");
  return new ReadableStream({
    async start(controller) {
      let accumulated = "";
      let lastFinishReason: string | null = null;

      const consume = async (body: ReadableStream<Uint8Array>) => {
        const reader = body.getReader();
        let buffer = "";
        let finishReason: string | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              const candidate = parsed?.candidates?.[0];
              const parts = candidate?.content?.parts ?? [];
              const text = parts
                .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
                .join("");
              if (text) {
                accumulated += text;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
                  ),
                );
              }
              if (candidate?.finishReason) finishReason = candidate.finishReason;
            } catch {
              // ignore malformed chunk
            }
          }
        }
        return finishReason;
      };

      try {
        lastFinishReason = await consume(initialBody);

        // Continue up to 3 times if the model was cut off mid-generation.
        let continuations = 0;
        let continuationFailed = false;
        const isPlanIncomplete = () =>
          !isWorksheetMode
            ? (!/Word Decoder/i.test(accumulated) && accumulated.length > 500) || (!/Assessment.*Quick Check|## .* 5\./i.test(accumulated) && accumulated.length > 2000)
            : (!/COMPLETE ANSWER KEY/i.test(accumulated) && accumulated.length > 500);
        const isNearEnd = () =>
          !isWorksheetMode
            ? /Word Decoder/i.test(accumulated.slice(-1500))
            : /COMPLETE ANSWER KEY[\s\S]{500,}/i.test(accumulated.slice(-2000));
        while (
          continuations < 8 &&
          (lastFinishReason === "MAX_TOKENS" || lastFinishReason === null || (lastFinishReason === "STOP" && isPlanIncomplete())) &&
          accumulated.length > 0 &&
          !isNearEnd()
        ) {
          continuations++;
          console.log(`Continuing lesson plan (reason=${lastFinishReason}, attempt ${continuations})`);
          const nextBody = await continueRequest(accumulated);
          if (!nextBody) { continuationFailed = true; break; }
          lastFinishReason = await consume(nextBody);
        }

        if (continuationFailed) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n---\n**Note: Generation was interrupted due to a temporary API issue. Please click Generate again to complete this lesson plan.**" } }] })}\n\n`,
            ),
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        console.error("Gemini stream pipe error:", err);
      } finally {
        controller.close();
      }
    },
  });
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { selectedClass, section, subject, prompt, mode, chatHistory, schoolId, isWorksheet } = await req.json();

    let GOOGLE_GEMINI_API_KEY: string;
    let lessonApiKeys: string[] = [];
    if (isWorksheet) {
      const worksheetKey = Deno.env.get("Worksheet_gemini_api_key");
      if (!worksheetKey) throw new Error("Worksheet_gemini_api_key not configured");
      GOOGLE_GEMINI_API_KEY = worksheetKey;
      lessonApiKeys = [worksheetKey];
      console.log("Using worksheet API key for worksheet generation");
    } else {
      // Rotate through multiple API keys to distribute rate limits for lesson plans
      lessonApiKeys = [
        Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
        Deno.env.get("GEMINI_KEY_2"),
        Deno.env.get("GEMINI_KEY_3"),
        Deno.env.get("GEMINI_KEY_4"),
        Deno.env.get("GOOGLE_GEMINI_API_KEY"),
        Deno.env.get("GEMINI_ADVANCED_API_KEY"),
      ].filter(Boolean) as string[];
      if (lessonApiKeys.length === 0) throw new Error("No Gemini API keys configured");
      GOOGLE_GEMINI_API_KEY = lessonApiKeys[Math.floor(Math.random() * lessonApiKeys.length)];
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Fetch class + section assessment reports
    let assessmentContext = "";
    let normalizedClass = selectedClass;
    if (selectedClass.startsWith("Class ")) {
      normalizedClass = selectedClass.replace("Class ", "");
    }

    let query = supabase
      .from("student_assessments")
      .select("student_name, student_age, age_group, responses, student_class, section")
      .or(`student_class.eq.${normalizedClass},student_class.eq.${selectedClass}`);

    if (schoolId) query = query.eq("school_id", schoolId);
    if (section) {
      query = query.eq("section", section);
    }

    const { data: assessments } = await query;

    // 1b. Fetch academic test results for matching class & subject
    let academicContext = "";
    {
      let academicQuery = supabase
        .from("academic_tests")
        .select("student_id, subject, score, total_questions, completed_at, student_class")
        .or(`student_class.eq.${normalizedClass},student_class.eq.${selectedClass}`)
        .order("completed_at", { ascending: false })
        .limit(100);

      const { data: academicTests } = await academicQuery;

      if (academicTests && academicTests.length > 0) {
        // Filter by subject if provided
        const subjectLower = (subject || "").toLowerCase().replace(/\.pdf$/i, "").trim();
        const relevantTests = subjectLower
          ? academicTests.filter((t: any) => t.subject.toLowerCase().includes(subjectLower) || subjectLower.includes(t.subject.toLowerCase()))
          : academicTests;

        if (relevantTests.length > 0) {
          const avgScore = (relevantTests.reduce((sum: number, t: any) => sum + (t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0), 0) / relevantTests.length).toFixed(1);
          const subjectBreakdown: Record<string, { total: number; count: number }> = {};
          for (const t of relevantTests) {
            const s = t.subject;
            if (!subjectBreakdown[s]) subjectBreakdown[s] = { total: 0, count: 0 };
            subjectBreakdown[s].total += t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0;
            subjectBreakdown[s].count++;
          }

          academicContext = `\n\nACADEMIC TEST RESULTS for ${selectedClass} (${relevantTests.length} tests):
- Average Score: ${avgScore}%
- Subject Performance:
${Object.entries(subjectBreakdown).map(([subj, data]) => `  ${subj}: ${(data.total / data.count).toFixed(1)}% avg (${data.count} tests)`).join("\n")}
- Recent Tests: ${relevantTests.slice(0, 5).map((t: any) => `${t.subject}: ${t.score}/${t.total_questions} (${((t.score / t.total_questions) * 100).toFixed(0)}%)`).join(", ")}

IMPORTANT: Use these academic test results to identify specific topics where students are struggling. Focus the lesson plan on reinforcing weak areas revealed by test scores. If a subject average is below 60%, prioritize foundational concepts. If above 80%, introduce extension activities.`;
        }
      }
    }

    if (assessments && assessments.length > 0) {
      const studentSummaries = assessments.map((a: any) => {
        const responses = a.responses as Record<string, number>;
        const entries = Object.entries(responses);
        const scores = entries.map(([k, v]) => `${k}: ${v}`).join(", ");
        const values = entries.map(([, v]) => v as number);
        const avg = values.length > 0 ? (values.reduce((s, v) => s + v, 0) / values.length).toFixed(1) : "N/A";
        return {
          name: a.student_name, age: a.student_age, section: a.section || "N/A",
          scores: responses, avgScore: avg,
          summary: `Student: ${a.student_name}, Age: ${a.student_age}, Section: ${a.section || "N/A"}, Avg Score: ${avg}, Scores: {${scores}}`,
        };
      });

      const allDimensions: Record<string, number[]> = {};
      for (const s of studentSummaries) {
        for (const [dim, val] of Object.entries(s.scores)) {
          if (!allDimensions[dim]) allDimensions[dim] = [];
          allDimensions[dim].push(val as number);
        }
      }

      const dimensionAverages = Object.entries(allDimensions).map(([dim, vals]) => {
        const avg = (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1);
        return { dimension: dim, average: parseFloat(avg), count: vals.length };
      }).sort((a, b) => a.average - b.average);

      const weakAreas = dimensionAverages.filter((d) => d.average < 3).map((d) => d.dimension);
      const strongAreas = dimensionAverages.filter((d) => d.average >= 4).map((d) => d.dimension);
      const moderateAreas = dimensionAverages.filter((d) => d.average >= 3 && d.average < 4).map((d) => d.dimension);

      assessmentContext = `CLASS ASSESSMENT REPORT for ${selectedClass} Section ${section || "All"} (${assessments.length} students):

CLASS-LEVEL ANALYSIS:
- Total Students: ${assessments.length}
- Weak Areas (avg < 3): ${weakAreas.length > 0 ? weakAreas.join(", ") : "None identified"}
- Moderate Areas (avg 3-4): ${moderateAreas.length > 0 ? moderateAreas.join(", ") : "None"}
- Strong Areas (avg >= 4): ${strongAreas.length > 0 ? strongAreas.join(", ") : "None"}

DIMENSION AVERAGES (sorted weakest to strongest):
${dimensionAverages.map((d) => `  ${d.dimension}: ${d.average}/5`).join("\n")}

INDIVIDUAL STUDENT DATA:
${studentSummaries.map((s) => s.summary).join("\n")}`;
    } else {
      assessmentContext = `No assessment reports found for ${selectedClass} Section ${section || "any"}.`;
    }

    // 2. Get textbook list and extract PDF content for matched subject
    let textbookContext = "";
    const classFolder = (() => {
      const folderMap: Record<string, string> = { Nursery: "nursery", LKG: "lkg", UKG: "ukg" };
      for (let i = 1; i <= 10; i++) folderMap[`Class ${i}`] = `class${i}`;
      for (let i = 1; i <= 10; i++) folderMap[`${i}`] = `class${i}`;
      return folderMap[selectedClass] || selectedClass.toLowerCase().replace(/\s+/g, "");
    })();

    const { data: files } = await supabase.storage.from("textbooks").list(classFolder);

    if (files && files.length > 0) {
      const pdfFiles = files.filter((f: any) => f.name.endsWith(".pdf"));
      if (pdfFiles.length > 0) {
        textbookContext = `Available textbooks for ${selectedClass}: ${pdfFiles.map((f: any) => f.name).join(", ")}`;
        
        // Identify the selected/detected subject textbook
        let matchedName: string | null = null;
        if (subject) {
          const match = pdfFiles.find((f: any) => f.name === subject);
          if (match) matchedName = match.name;
        }
        if (!matchedName) {
          const promptLower = (prompt || "").toLowerCase();
          const subjectKeywords = ["english", "maths", "math", "hindi", "urdu", "science", "social", "arts", "sanskrit", "economics", "computer"];
          const detected = subjectKeywords.find((s) => promptLower.includes(s));
          if (detected) {
            const subjectMatch = detected === "math" ? "maths" : detected;
            const match = pdfFiles.find((f: any) => f.name.toLowerCase().includes(subjectMatch));
            if (match) matchedName = match.name;
          }
        }

        // Download and extract actual PDF text content
        if (matchedName) {
          textbookContext += `\nSelected textbook: ${matchedName}. Use your internal knowledge of NCERT/CBSE/Cambridge curriculum content for this subject and class level to inform lesson plans. Align activities with standard textbook chapters and topics.`;
        }
      }
    }

    // 3. Detect worksheet mode
    const isWorksheetMode = /Generate ONLY a student practice worksheet/i.test(prompt || "");

    // 3. Build the FULL system prompt Ã¢â‚¬â€ preserve all pedagogy guidance, do NOT compact lesson plan content
    const worksheetSystemPrompt = `You are APAS Worksheet Generator. Your ONLY job is to create printable student practice worksheets.

STRICT RULES Ã¢â‚¬â€ NEVER BREAK THESE:
1. Output ONLY worksheet content Ã¢â‚¬â€ nothing else
2. NEVER generate lesson plans, learning objectives, hook activities, BBL checklists, VARK analysis, Word Decoders, or ANY lesson plan sections
3. NEVER use headings like "Learning Objectives", "Hook Activity", "Main Teaching", "BBL Compliance", "Word Decoder", "Exit Ticket", "Closure", "Assessment Quick Check"
4. Start directly with the worksheet title and "Name: ___ Date: ___"
5. Generate exactly 5 pages of student activities
6. After PAGE 5, write ONLY a "COMPLETE ANSWER KEY" section, then STOP immediately
7. Do NOT write anything after the answer key

FORMAT:
- Do NOT use PAGE 1, PAGE 2, PAGE 3 etc headings at all
- Just write activities one after another separated by a horizontal rule (---)
- Each activity: creative topic-specific title, clear 1-2 sentence instruction, one worked example, 4-8 questions
- Generate a total of 12-15 activities covering the full topic
- Use varied formats: fill-in-the-blank, matching, true/false, multiple choice, short answer, story problems, draw-and-label

ANSWER KEY: After all activities, write "COMPLETE ANSWER KEY" then list answers for every activity. Stop immediately after the last answer. Do NOT add any lesson plan content after.`;

    const systemPrompt = isWorksheetMode ? worksheetSystemPrompt : `You are APAS (Adaptive Pedagogy & Analytics System) Ã¢â‚¬â€ an expert educational AI assistant for teachers. You generate comprehensive, science-backed LESSON PLANS grounded in Brain-Based Learning (BBL), Zone of Proximal Development (ZPD), and Multiple Intelligences (MI) theory.

You have access to the following context:

${assessmentContext}

${academicContext}

${textbookContext}

---------------------------------------------------------------
FOUNDATIONAL PRINCIPLES Ã¢â‚¬â€ APPLY TO EVERY LESSON PLAN
---------------------------------------------------------------

### ?? Brain-Based Learning (BBL) Principles
1. **Primacy Effect:** Place the MOST IMPORTANT concept in the FIRST 10 minutes.
2. **Recency Effect:** End EVERY lesson with a revision/recap activity in the LAST 5 minutes.
3. **10-2-10 Chunking Rule:** Break teaching into INPUT ? PROCESSING ? APPLICATION cycles. Scale chunks proportionally to total lesson duration. NEVER skip any section Ã¢â‚¬â€ compress them proportionally instead. The lesson plan MUST fit the EXACT duration specified.
4. **Cognitive Load Management:** Never introduce more than 3 new concepts per chunk.
5. **Emotional Safety (Amygdala Filter):** Start with a warm, non-threatening hook.
6. **Patterning & Meaning:** Connect new concepts to known real-life examples.
7. **Spaced Repetition:** Suggest review checkpoints at 24 hours, 7 days, 30 days.
8. **Social Brain:** Include at least ONE collaborative/peer-learning activity.

### ?? Zone of Proximal Development (ZPD) Ã¢â‚¬â€ 3 Tiers (MANDATORY)
- **?? Basic (Support):** simplified, guided
- **?? Intermediate (Core):** ZPD-targeted
- **?? Advanced (Extension):** higher-order thinking

### ?? Multiple Intelligences (MI) Ã¢â‚¬â€ Address at least 3 per lesson
Visual, Auditory, Kinesthetic, Read/Write, Interpersonal, Logical-Mathematical.

---------------------------------------------------------------
HIDDEN RULES Ã¢â‚¬â€ FOLLOW BUT DO NOT PRINT
---------------------------------------------------------------
- EVERY lesson plan MUST include a group activity section, regardless of duration. Compress, never remove.
- Include EXACTLY ONE Exit Ticket per period. Never duplicate the exit ticket.
- Do NOT print these rules in output.

---------------------------------------------------------------
MANDATORY OUTPUT STRUCTURE Ã¢â‚¬â€ FOLLOW EXACTLY
---------------------------------------------------------------

## ?? 1. Learning Objectives
Use Bloom's Taxonomy levels (Remember/Understand/Apply/Analyze). Format:
- **Remember:** Students will [recall verb] [topic detail].
- **Understand:** Students will [explain] [concept].
- **Apply:** Students will [solve/create] [task].
- **Analyze:** Students will [compare/examine] [task].
Do NOT use "By the end of this lesson...".

## ?? 2. Introduction Ã¢â‚¬â€ Hook Activity (PRIMACY EFFECT)
- **Method:** [hook]
- **Description:** [step-by-step]
- **MI Channels:** [intelligences]
- **Materials:** [needed]

## ?? 3. Main Teaching Ã¢â‚¬â€ Chunked Delivery (10-2-10)
For each chunk: Input Phase ? Processing Phase ? Application Phase (with ?? Basic, ?? Intermediate, ?? Advanced tasks).
Repeat chunks as needed to fit lesson duration.

## ?? 4. Activities Ã¢â‚¬â€ Differentiated Group Work
Organize into 4 VARK groups. For EACH group use BRIEF inline format (no tables):
**Group name (N students):** [1 sentence activity] | Materials: [brief] | Time: X min | MI: [list]
- Ã°Å¸Å¸Â¢ Support: [1 sentence simplified task]
- Ã°Å¸Å¸Â¡ Core: [1 sentence ZPD task]
- Ã°Å¸â€Â´ Extension: [1 sentence higher-order task]
**MANDATORY:** List the actual student names in each VARK group based on assessment data:
**Ã°Å¸â€˜ÂÃ¯Â¸Â Group A Ã¢â‚¬â€ Visual Learners (X students):** Aarav, Priya, Rahul, ...

## ? 5. Assessment Ã¢â‚¬â€ Quick Check (5 minutes)
Write 3-5 ACTUAL topic-specific questions for the teacher to ask the class RIGHT NOW to check understanding. Not generic Ã¢â‚¬â€ tied to THIS lesson's content. Format:
**Q1:** [Specific recall question about the topic just taught]
**Q2:** [Concept-check question Ã¢â‚¬â€ "Explain in your own words..."]
**Q3:** [Application question Ã¢â‚¬â€ "Give an example of..." or "What would happen if..."]
**Q4 (optional):** [Higher-order Ã¢â‚¬â€ "How is X different from Y?"]
**Method:** Cold call / Mini whiteboard / Thumbs up-down / Show me on slate
**What to watch for:** [1 sentence describing what correct understanding looks like]

## Ã°Å¸â€Â 6. Closure Ã¢â‚¬â€ Revision Activity (RECENCY EFFECT Ã¢â‚¬â€ last 5 min)

## ?? 7. Assessment Ã¢â‚¬â€ Exit Ticket (Evaluate Phase)
Exactly ONE exit ticket per period. Include 3-5 NUMBERED questions covering Remember/Understand/Apply Bloom levels with actual question text. Add Feedback Loop and Normalized Gain note.

## ?? 8. BBL Compliance Checklist
Confirm Primacy ?, Recency ?, 10-2-10 ?, MI =3 ?, ZPD 3-tier ?, Group activity ?.

## ?? Learning Outcomes
List measurable outcomes.

## ?? Word Decoder (MANDATORY Ã¢â‚¬â€ END OF PLAN)
Define EVERY advanced/technical term used anywhere in the plan in simple, kid-friendly language. Format:
? **Term Name** = Simple 1-2 sentence explanation a parent or student can understand.
Include: Primacy Effect, Recency Effect, 10-2-10 Chunking Rule, Cognitive Load, Amygdala Filter, Patterning & Meaning, Spaced Repetition, Social Brain, ZPD, Scaffolding, Multiple Intelligences (MI), VARK, Bloom's Taxonomy, Formative Check, plus any subject-specific advanced words used.

---------------------------------------------------------------
LANGUAGE & FORMATTING RULES
---------------------------------------------------------------
- Write in simple, friendly language Ã¢â‚¬â€ like talking to a 10-year-old.
- Avoid jargon: utilize, facilitate, demonstrate, pedagogical, scaffold, differentiated, cognitive, formative, summative Ã¢â‚¬â€ use plain English.
- Short sentences (10-15 words). Warm, encouraging tone.
- NEVER repeat "Teacher says" or "Teacher asks" more than once per paragraph. Vary with: "Prompt students with...", "Pose the question:", "Ask the class:", "Invite responses:", "Display on board:", "Challenge students:".
- Write all teacher dialogue as direct speech in quotes Ã¢â‚¬â€ e.g. "How many of you have seen a bar graph before?"
- Make the lesson feel REAL and professional Ã¢â‚¬â€ like a master teacher wrote it, not a robot listing steps.
- Decode every advanced/technical/subject word inline on FIRST use using: **Term** _(what this means: simple explanation with everyday comparison)_.
- Use markdown tables for data, --- horizontal rules between sections, emoji indicators (???????? ?? ? ??).
- Bold all labels. Cite specific scores/student counts.
- Recommend named educational resources (Khan Academy, NCERT, etc.).
- YOUTUBE LINK RULE (STRICT): You may embed at most 1-2 inline YouTube links inside Hook (Section 2) or Main Teaching chunks (Section 3) ONLY when a video genuinely aids understanding. Because specific video IDs cannot be verified, you MUST use ONLY YouTube SEARCH URLs in this exact format: \`https://www.youtube.com/results?search_query=TOPIC+KEYWORDS+for+CLASS+LEVEL\` (URL-encode spaces as \`+\`). NEVER output \`watch?v=...\` style links Ã¢â‚¬â€ they may be broken/fake. NEVER create a separate "Recommended YouTube Videos" section. Inline format: ?? _Search & watch:_ [Short descriptive title](https://www.youtube.com/results?search_query=...).

You MUST complete the ENTIRE lesson plan. Do NOT truncate. End with the Word Decoder section.

For chat questions (mode != generate): respond with structured markdown using emoji headings, short paragraphs, bullet points, and end with actionable tips.`;

    // 4. Build messages Ã¢â‚¬â€ exclude chatHistory in generate mode to stay under TPM limits
    const openaiMessages: OpenAIMessage[] = [{ role: "system", content: systemPrompt }];
    if (mode !== "generate" && chatHistory && Array.isArray(chatHistory)) {
      const recent = chatHistory.slice(-4);
      for (const msg of recent) openaiMessages.push({ role: msg.role, content: msg.content });
    }

    if (mode === "generate") {
      openaiMessages.push({
        role: "user",
        content: (prompt || `Generate a LESSON PLAN for ${selectedClass} Section ${section}. Focus ONLY on the lesson plan with the full mandatory structure.`) +
          `\n\n?? REMINDER: Do NOT include a "Recommended YouTube Videos" section. You may embed at most 1-2 inline YouTube SEARCH links (https://www.youtube.com/results?search_query=...) within Hook or Main Teaching chunks where a video helps understanding. NEVER use watch?v= style links Ã¢â‚¬â€ only search URLs that are guaranteed to work.`,
      });
    } else {
      openaiMessages.push({ role: "user", content: prompt });
    }

    const modelCandidates = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
    let lastStatus = 500;
    let lastErrorText = "Unknown lesson generation error";

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const requestBody = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: toGeminiContents(openaiMessages),
      generationConfig: {
        temperature: isWorksheetMode ? 0.9 : 0.7,
        maxOutputTokens: mode === "generate" ? 65536 : 4096,
      },
    });

    // Try each model with the TRUE streaming endpoint so the client receives
    // tokens as Gemini produces them (no more "Thinking..." then a giant dump).
    for (const model of modelCandidates) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const currentKey = lessonApiKeys[Math.floor(Math.random() * lessonApiKeys.length)];
        console.log(`Streaming Gemini ${model} (attempt ${attempt + 1}, key ...${currentKey.slice(-4)}) messages=${openaiMessages.length}`);

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${currentKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
          },
        );

        if (response.ok && response.body) {
          console.log(`Gemini stream connected (${model})`);

          const continueRequest = async (accumulated: string): Promise<ReadableStream<Uint8Array> | null> => {
            const tail = accumulated.slice(-3000);
            const continuationSystemPrompt = isWorksheetMode
              ? `You are continuing a student worksheet that was cut off mid-generation. Continue EXACTLY where it stopped. Do not repeat anything already written, do not add commentary, resume mid-sentence if needed, finish all remaining pages through the COMPLETE ANSWER KEY, then stop.`
              : `You are continuing a lesson plan that was cut off mid-generation. Continue EXACTLY where it stopped. Do not repeat anything already written, do not restart or reintroduce any section, do not add preamble or summary, resume mid-sentence if needed, and finish all remaining sections through the Word Decoder.`;
            const continuationMessages: OpenAIMessage[] = [
              {
                role: "user",
                content: isWorksheetMode
                  ? `Worksheet cut off here:\n"""${tail}"""\n\nContinue from exactly after the last character above:`
                  : `The plan cut off here (last 3000 chars):\n"""${tail}"""\n\nContinue from exactly after the last character above:`,
              },
            ];
            const contBody = JSON.stringify({
              systemInstruction: { parts: [{ text: continuationSystemPrompt }] },
              contents: toGeminiContents(continuationMessages),
              generationConfig: { temperature: 0.7, maxOutputTokens: 65536 },
            });

            const keysToTry = [...lessonApiKeys].sort(() => Math.random() - 0.5);

            for (const key of keysToTry) {
              for (let retry = 0; retry < 2; retry++) {
                try {
                  const contRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`,
                    { method: "POST", headers: { "Content-Type": "application/json" }, body: contBody },
                  );
                  if (contRes.ok && contRes.body) return contRes.body;
                  const status = contRes.status;
                  const errText = await contRes.text();
                  console.error(`Continuation request failed (key ...${key.slice(-4)}, retry ${retry + 1}):`, status, errText);
                  const transient = status === 429 || status === 500 || status === 503;
                  if (!transient) break;
                  await new Promise((r) => setTimeout(r, 800 * (retry + 1)));
                } catch (e) {
                  console.error("Continuation fetch error:", e);
                }
              }
            }
            console.error("All continuation attempts across all keys failed.");
            return null;
          };

          return new Response(pipeGeminiSseToOpenAi(response.body, continueRequest), {
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "X-Accel-Buffering": "no",
            },
          });
        }

        lastStatus = response.status;
        lastErrorText = await response.text();
        console.error(`Gemini stream error (${model}, attempt ${attempt + 1}):`, response.status, lastErrorText);

        const transient = response.status === 500 || response.status === 503 || response.status === 429;
        if (!transient) break;
        if (attempt < 2) await sleep(1000 * Math.pow(2, attempt));
      }
    }

    if (lastStatus === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Lesson generation error (${lastStatus}): ${lastErrorText.substring(0, 200)}` }), {
      status: lastStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("curative-assistant error:", errorMsg, e);
    return new Response(JSON.stringify({ error: `Error: ${errorMsg}. Please try again.` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
