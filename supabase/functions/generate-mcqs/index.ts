import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { studentClass, section, subject, numQuestions = 10, questionType = "mcq", topic, difficulty = "medium" } = await req.json();
    const GROQ_API_KEY = Deno.env.get("GROK_API_KEY");
    if (!GROQ_API_KEY) throw new Error("GROK_API_KEY is not configured");

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
      understanding: "Generate UNDERSTANDING/COMPREHENSION questions that check if the student can explain ideas from ${subject} in their own words. Ask 'Why do we need...', 'Explain the process of...', 'What does ... mean in your own words?'.",
      application: "Generate APPLICATION questions where the student must use ${subject} knowledge in new real-world situations, word problems, or practical scenarios. Present a situation and ask them to solve, predict, or apply a concept.",
      analysis: "Generate ANALYSIS questions that require the student to break down ${subject} concepts into parts and examine relationships. Ask them to 'Compare and contrast...', 'What pattern do you observe...', 'How are ... and ... related?'.",
      evaluation: "Generate EVALUATION questions that require the student to justify opinions, make judgments, or assess approaches in ${subject}. Ask 'Which method is more efficient and why?', 'Was this decision appropriate? Support your answer.', 'Do you agree? Justify.'.",
      creation: "Generate CREATION/SYNTHESIS questions that challenge the student to create something new using ${subject} knowledge. Ask them to 'Design a model to demonstrate...', 'Create a story to explain...', 'Propose a solution for...'.",
      hots: "Generate HIGHER-ORDER THINKING (HOTS) questions that push students to think deeply about ${subject}. Ask thought experiments like 'How would the world change if...', 'What would happen if...', 'Predict what occurs when...'.",
      diagnostic: "Generate DIAGNOSTIC questions that identify misconceptions or knowledge gaps in ${subject} before teaching. Ask 'When you hear the word ..., what comes to mind?', 'What do you already know about...?', 'Which of these is a common mistake?'.",
      formative: "Generate FORMATIVE ASSESSMENT questions to check understanding of ${subject} during the lesson. Ask 'What is one thing you understood well?', 'Which statement best summarizes...?', 'What confused you about this concept?'.",
      summative: "Generate SUMMATIVE questions to assess learning after completing a ${subject} topic/unit. Include comprehensive problems, chapter summaries, and full-cycle questions that test overall mastery.",
      open_ended: "Generate OPEN-ENDED questions about ${subject} that encourage detailed thinking and expression. Ask 'Explain how you arrived at your answer', 'Describe the impact of...', 'In your opinion, why is ... important?'. Present as MCQ with 4 possible detailed responses.",
      closed_ended: "Generate CLOSED-ENDED questions about ${subject} with one clear correct answer. Quick factual checks like 'What is the value of...?', 'Which of these is correct?'.",
      probing: "Generate PROBING questions that dig deeper into student thinking about ${subject}. Ask 'Can you explain your reasoning?', 'What made you choose this method?', 'What evidence supports your answer?'.",
      reflective: "Generate REFLECTIVE questions that encourage self-awareness in learning ${subject}. Ask 'What strategy worked best for you?', 'What would you do differently?', 'How has your understanding changed?'.",
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
      formatInstruction = "Each question must be a fill-in-the-blank style presented as MCQ with 4 options A, B, C, D. Use '______' in the question to indicate the blank.";
      formatSchema = `[
  {
    "id": 1,
    "question": "The capital of France is ______.",
    "options": { "A": "London", "B": "Paris", "C": "Berlin", "D": "Madrid" },
    "correct": "B",
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

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
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

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "API credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("API error:", response.status, t);
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    
    // Strip markdown code blocks if present
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    
    const questions = JSON.parse(content);

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
