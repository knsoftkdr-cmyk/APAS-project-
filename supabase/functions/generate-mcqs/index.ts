import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── KEY ROTATION (same keys as generate-lessons / generate-period-plans) ────
function getGeminiKeys(): string[] {
  return [
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
  ].filter((k): k is string => !!k && k.trim().length > 0);
}

function getGroqKeys(): string[] {
  return [
    Deno.env.get("APAS_LESSON_GENERATOR"),
    Deno.env.get("GROK_API_KEY"),
  ].filter((k): k is string => !!k && k.trim().length > 0);
}

async function callGeminiWithRotation(
  systemPrompt: string,
  userPrompt: string,
  keys: string[]
): Promise<{ text: string } | null> {
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"];

  for (const key of keys) {
    for (const model of models) {
      console.log(`Trying Gemini ${model} with key ${key.slice(-6)}...`);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
            }),
          }
        );

        if (response.status === 429 || response.status === 503) {
          console.warn(`Key ${key.slice(-6)} / ${model} rate limited (${response.status}), rotating...`);
          break; // try next key for this model
        }

        if (!response.ok) {
          const err = await response.text();
          console.warn(`Key ${key.slice(-6)} / ${model} error ${response.status}: ${err.substring(0, 150)}`);
          continue;
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (text) return { text };
      } catch (e) {
        console.error(`Network error on key ${key.slice(-6)} / ${model}:`, e);
      }
    }
  }
  return null;
}

async function callGroqWithRotation(
  systemPrompt: string,
  userPrompt: string,
  keys: string[]
): Promise<{ text: string } | null> {
  for (const key of keys) {
    console.log(`Trying Groq key ${key.slice(-6)}...`);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
        }),
      });

      if (response.status === 429 || response.status === 401 || response.status === 402 || response.status === 403) {
        console.warn(`Groq key ${key.slice(-6)} failed with ${response.status}, rotating...`);
        continue;
      }

      if (!response.ok) {
        const err = await response.text();
        console.warn(`Groq key error ${response.status}: ${err.substring(0, 150)}`);
        continue;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (text) return { text };
    } catch (e) {
      console.error(`Network error on Groq key ${key.slice(-6)}:`, e);
    }
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { studentClass, section, subject, numQuestions = 10, questionType = "mcq", topic, difficulty = "medium" } = await req.json();

    const geminiKeys = getGeminiKeys();
    const groqKeys = getGroqKeys();

    if (geminiKeys.length === 0 && groqKeys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const count = Math.min(Math.max(Number(numQuestions) || 10, 5), 30);

    const difficultyInstruction = {
      easy: "All questions should be simple and straightforward, testing basic recall and understanding.",
      medium: "Start with easy questions and gradually increase to moderate difficulty.",
      hard: "Questions should be challenging, testing deep understanding, application, and analysis.",
      mixed: "Mix easy, medium, and hard questions evenly across the set.",
    }[difficulty] || "Start from easy questions and gradually increase difficulty.";

    const topicInstruction = topic ? `Focus specifically on the topic: "${topic}".` : "Questions should cover different topics within the subject.";

    let formatInstruction = "";
    let formatSchema = "";
    let cognitiveInstruction = "";

    const cognitiveTypes: Record<string, string> = {
      recall: "Generate RECALL/KNOWLEDGE questions that test if the student remembers facts, definitions, formulas, dates, and key terms from ${subject}. Use prompts like 'What is...', 'Define...', 'Name the...', 'List the...'.",
      understanding: "Generate UNDERSTANDING/COMPREHENSION questions that check if the student truly grasps ideas from ${subject} rather than just memorizing them. Ask 'Why do we need...?', 'Which of the following best explains the process of...?', 'Which statement best explains what ... means?'.",
      application: "Generate APPLICATION questions where the student must use ${subject} knowledge in new real-world situations, word problems, or practicalscenarios. Present a situation and ask them to solve, predict, or apply a concept.",
      analysis: "Generate ANALYSIS questions that require the student to break down ${subject} concepts into parts and examine relationships. Ask them to 'Compare and contrast...', 'What pattern do you observe...', 'How are ... and ... related?'.",
      evaluation: "Generate EVALUATION questions that require the student to judge or assess approaches in ${subject}. Ask 'Which method is more efficient?', 'Which of these best justifies whether this decision was appropriate?', 'Which statement best supports or challenges this idea?'.",
      creation: "Generate CREATION/SYNTHESIS questions that challenge the student to identify the best original idea using ${subject} knowledge. Ask 'Which model would best demonstrate...?', 'Which story best explains...?', 'Which proposed solution would work best for...?'.",
      hots: "Generate HIGHER-ORDER THINKING (HOTS) questions that push students to think deeply about ${subject}. Ask thought experiments like 'How would the world change if...', 'What would happen if...', 'Predict what occurs when...'.",
      diagnostic: "Generate DIAGNOSTIC questions that identify misconceptions or knowledge gaps in ${subject} before teaching. Ask 'When you hear the word ..., what comes to mind?', 'What do you already know about...?', 'Which of these is a common mistake?'.",
      formative: "Generate FORMATIVE ASSESSMENT questions to check understanding of ${subject} during the lesson. Ask 'What is one thing you understood well?', 'Which statement best summarizes...?', 'What confused you about this concept?'.",
      summative: "Generate SUMMATIVE questions to assess learning after completing a ${subject} topic/unit. Include comprehensive problems, chapter summaries, and full-cycle questions that test overall mastery.",
      open_ended: "Generate OPEN-ENDED questions about ${subject} that encourage detailed thinking and expression. Ask 'Explain how you arrived at your answer', 'Describe the impact of...', 'In your opinion, why is ... important?'. Present as MCQ with 4 possible detailed responses.",
      closed_ended: "Generate CLOSED-ENDED questions about ${subject} with one clear correct answer. Quick factual checks like 'What is the value of...?', 'Which of these is correct?'.",
      probing: "Generate PROBING questions that dig deeper into student thinking about ${subject}. Ask 'Which of the following best explains the reasoning behind...?', 'Which method would most likely be used and why?', 'Which piece of evidence best supports...?'.",
      reflective: "Generate REFLECTIVE questions that encourage self-awareness in learning ${subject}. Ask 'Which strategy would likely work best when learning about...?', 'Which approach would most improve understanding of...?', 'Which statement best reflects a change in understanding of...?'.",
      real_world: "Generate REAL-WORLD CONNECTION questions that help students see the relevance of ${subject} in daily life. Ask 'Where do you see ... being used around you?', 'How can we apply ... in our school/community?', 'Give a real-life example of...'.",
    };

    if (cognitiveTypes[questionType]) {
      cognitiveInstruction = cognitiveTypes[questionType].replace(/\$\{subject\}/g, subject);
      formatInstruction = "Each question must have exactly 4 options labeled A, B, C, D. Only one option should be correct. " + cognitiveInstruction;
      formatSchema = `[
  {
    "id": 1,
    "question": "Your subject-specific question here?",
    "options": { "A": "Option 1", "B": "Option 2", "C": "Option 3", "D": "Option 4" },
    "correct": "B",
    "explanation": "Detailed explanation of why this is correct"
  }
]`;
    } else if (questionType === "true_false") {
      formatInstruction = "Each question must be a True/False question with exactly 2 options: A (True) and B (False).";
      formatSchema = `[
  {
    "id": 1,
    "question": "The Earth revolves around the Sun.",
    "options": { "A": "True", "B": "False" },
    "correct": "A",
    "explanation": "The Earth orbits the Sun."
  }
]`;
    } else if (questionType === "fill_blank") {
      formatInstruction = "Each question must be a fill-in-the-blank question requiring the student to TYPE the missing word or short phrase themselves. Use '______' in the question text to indicate exactly where the blank goes. Do NOT provide multiple-choice options. The 'answer' field must contain the single correct word or short phrase (max 2-3 words) that belongs in the blank. Keep the expected answer simple and unambiguous so it can be matched against student text input.";
      formatSchema = `[
  {
    "id": 1,
    "question": "The capital of France is ______.",
    "answer": "Paris",
    "explanation": "Paris is the capital of France."
  }
]`;
    } else {
      formatInstruction = "Each question must have exactly 4 options labeled A, B, C, D. Only one option should be correct.";
      formatSchema = `[
  {
    "id": 1,
    "question": "What is 2 + 3?",
    "options": { "A": "4", "B": "5", "C": "6", "D": "7" },
    "correct": "B",
    "explanation": "2 + 3 equals 5"
  }
]`;
    }

    const systemPrompt = `You are an expert academic question paper generator. Generate exactly ${count} questions for a student.

RULES:
- ${formatInstruction}
- Questions should be age-appropriate for the given class level
- ${topicInstruction}
- ${difficultyInstruction}
- Use simple, clear language appropriate for the student's class level
- Return ONLY valid JSON, no markdown, no extra text

Return a JSON array of objects with this exact structure:
${formatSchema}`;

    const userPrompt = `Generate ${count} questions for:
- Class: ${studentClass}
${section ? `- Section: ${section}` : ""}
- Subject: ${subject}
${topic ? `- Topic: ${topic}` : ""}
- Difficulty: ${difficulty}
- Question Type: ${questionType}`;

    // Try Gemini keys first, fall back to Groq — same order as the lesson/period generators
    let result = geminiKeys.length > 0
      ? await callGeminiWithRotation(systemPrompt, userPrompt, geminiKeys)
      : null;

    if (!result && groqKeys.length > 0) {
      console.log("All Gemini keys failed/exhausted — falling back to Groq...");
      result = await callGroqWithRotation(systemPrompt, userPrompt, groqKeys);
    }

    if (!result) {
      return new Response(JSON.stringify({ error: "All API keys exhausted. Please try again later or check your key quotas." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Strip markdown code fences, then pull out just the JSON array/object
    // (models sometimes wrap the JSON in a sentence or two despite instructions).
    let content = result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let questions: any;
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      questions = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (e) {
      console.error("Failed to parse AI response:", content.substring(0, 500));
      return new Response(JSON.stringify({ error: "Failed to parse AI response. Please try again.", raw: content.substring(0, 200) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ questions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-mcqs error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});