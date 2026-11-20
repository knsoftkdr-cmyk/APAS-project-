import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeHistory, historyToContents, type HistoryTurn } from "../_shared/history.ts";
import { getTeacherData, TEACHER_DATA_TOPICS, TOPIC_PAGE, type TeacherDataTopic } from "../_shared/teacherAgentData.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getGeminiKeys(): string[] {
  return [
    Deno.env.get("Worksheet_gemini_api_key"),
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
  ].filter((k): k is string => !!k && k.trim().length > 0);
}

const INTENT_TOOL = {
  functionDeclarations: [
    {
      name: "create_lesson_plan_intent",
      description:
        "Call this whenever the teacher's message describes wanting a lesson plan created, even if some fields are missing. Leave a field null if not mentioned - do not guess.",
      parameters: {
        type: "OBJECT",
        properties: {
          class_level: { type: "STRING", description: "e.g. '4', 'Nursery', 'LKG'. Numeric classes as bare digit string." },
          section: { type: "STRING", description: "e.g. 'A'. Null if not mentioned." },
          subject_query: { type: "STRING", description: "Subject as the teacher said it, e.g. 'maths', 'science'. Null if not mentioned." },
          topic_query: { type: "STRING", description: "Topic/chapter as the teacher said it, e.g. 'fractions'. Null if not mentioned." },
          periods: { type: "NUMBER", description: "Number of periods. Null if not mentioned." },
          duration_minutes: { type: "NUMBER", description: "Minutes per period. Null if not mentioned." },
        },
        required: [],
      },
    },
  ],
};

// The teacher's own data (read with THEIR session, so RLS applies - see _shared/teacherAgentData.ts).
const DATA_TOOL = {
  name: "get_teacher_data",
  description:
    "Call this for ANY question about the teacher's own school data: homework (who has / hasn't submitted, pending), worksheet submissions to review, " +
    "today's attendance (absent / late students, classes not marked), student doubts, parent appointments, interventions / at-risk students, " +
    "upcoming exams or deadlines, assessment papers to evaluate, their classes and student counts, or 'what is pending today'. Never say you cannot access this data.",
  parameters: {
    type: "OBJECT",
    properties: {
      topic: { type: "STRING", enum: [...TEACHER_DATA_TOPICS], description: "overview = everything pending today." },
      class_level: { type: "STRING", description: "Class if the teacher named one, e.g. '5', 'LKG'. Null otherwise." },
      section: { type: "STRING", description: "Section if named, e.g. 'A'. Null otherwise." },
      subject: { type: "STRING", description: "Subject if named. Null otherwise." },
    },
    required: ["topic"],
  },
};

function openPageTool(pages: { title: string; path: string }[]) {
  return {
    name: "open_page",
    description: "Call this when the teacher asks to open / go to / show / take them to a page or module of the APAS app. Pick the closest page from the list.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", enum: pages.map((p) => p.path), description: "Pages: " + pages.map((p) => `${p.title} = ${p.path}`).join("; ") },
      },
      required: ["path"],
    },
  };
}

// Fetch with a hard per-attempt timeout so one slow/hanging key+model
// combination cannot stall the whole request - it just gets abandoned and
// the next candidate is tried immediately.
async function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A plain, tool-free text completion - separate from callGemini() below,
// which always forces the lesson-plan tool schema and returns a raw
// candidate object rather than a text string. This one is used only for
// the video-intent classifier.
async function callGeminiPlain(systemPrompt: string, userPrompt: string, keys: string[], history: HistoryTurn[] = [], maxOutputTokens = 300, timeoutMs = 5000): Promise<string | null> {
  const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
  for (const key of keys) {
    for (const model of models) {
      try {
        const response = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [...historyToContents(history), { role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens },
            }),
          },
          timeoutMs,
        );
        if (response.status === 429 || response.status === 503) continue;
        if (!response.ok) continue;
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      } catch (_e) {
        // try next key/model
      }
    }
  }
  return null;
}

// ---- Video-request classification (for video mode routing) ----
// A cheap Gemini call decides whether the teacher's message is something
// a YouTube video could genuinely answer (a topic/concept explanation, a
// classroom demo, a motivational/inspirational video, a story, a song, or
// an explicit "find me a video on X") vs a lesson-plan creation request or
// an APAS platform question, which stay on their existing paths. Since the
// teacher has already explicitly selected "Find a video" mode, this
// defaults to treating the message as a video request unless it clearly
// needs the lesson-builder or platform Q&A instead.
async function classifyVideoIntent(message: string, keys: string[], history: HistoryTurn[] = []): Promise<{ isVideo: boolean; query: string; topicWords: string[] }> {
  const classifierPrompt = `You classify a teacher's chat message to a school app assistant that is currently in "find a video" mode - the teacher has explicitly asked for a YouTube video suggestion. Reply with ONLY raw JSON, no markdown fences, no extra words, in exactly this shape:
{"is_video_request": boolean, "search_query": "string", "topic_keywords": ["string", ...]}

is_video_request = true for ANY message a YouTube video could reasonably answer - this includes explaining an academic concept/topic, a classroom demonstration, a motivational/inspirational speech, a story, a song, a "how to", or any explicit request for "a video about/on X". Default to true when in doubt, since the teacher already chose video mode.
is_video_request = false ONLY for: (a) a request to CREATE/GENERATE a lesson plan (e.g. "create a lesson plan on fractions for class 5") - that's a distinct action, not a video request, or (b) a question about the APAS platform itself (what it does, its features), or (c) pure greetings/small talk with no topic at all.

When true: "search_query" is a short, effective YouTube search query for a good, appropriate video on that exact topic. "topic_keywords" is 2-5 lowercase single-word keywords (the core subject words) that a genuinely relevant video's title/description should contain - used to reject off-topic results.
When false: "search_query" and "topic_keywords" can be empty.`;

  const raw = await callGeminiPlain(classifierPrompt, message, keys, history);
  if (!raw) return { isVideo: false, query: "", topicWords: [] };
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      isVideo: !!parsed.is_video_request,
      query: typeof parsed.search_query === "string" ? parsed.search_query.trim() : "",
      topicWords: Array.isArray(parsed.topic_keywords) ? parsed.topic_keywords.map((w: any) => String(w).toLowerCase().trim()).filter(Boolean) : [],
    };
  } catch {
    return { isVideo: false, query: "", topicWords: [] };
  }
}

interface VideoResult {
  title: string;
  url: string;
  channel: string;
  thumbnail: string | null;
}

// ---- YouTube video search ----
// Uses the real YouTube Data API when YOUTUBE_API_KEY is configured, then
// STRICTLY filters results down to ones that actually match the topic - a
// result only survives if its title/description contains at least half
// the classifier's topic keywords. Off-topic results are dropped rather
// than shown. Falls back to a plain, guaranteed-valid YouTube
// search-results link (never a fabricated/broken video id) when the API
// key is absent, the call fails, or nothing passes the relevance check.
function isRelevant(text: string, topicWords: string[]): boolean {
  if (topicWords.length === 0) return true;
  const lower = text.toLowerCase();
  const hits = topicWords.filter((w) => lower.includes(w));
  return hits.length >= Math.max(1, Math.ceil(topicWords.length / 2));
}

async function searchYouTube(query: string, topicWords: string[]): Promise<VideoResult[]> {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (apiKey) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&safeSearch=strict&maxResults=8&relevanceLanguage=en&q=${encodeURIComponent(query)}&key=${apiKey}`;
      const res = await fetchWithTimeout(url, {}, 6000);
      if (res.ok) {
        const data = await res.json();
        const items = (data?.items || [])
          .filter((it: any) => it?.id?.videoId)
          .map((it: any) => ({
            title: it.snippet?.title || "Educational video",
            url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
            channel: it.snippet?.channelTitle || "YouTube",
            thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || null,
            _desc: it.snippet?.description || "",
          }))
          .filter((v: any) => isRelevant(`${v.title} ${v._desc}`, topicWords))
          .slice(0, 3)
          .map(({ _desc, ...v }: any) => v);
        if (items.length > 0) return items;
      }
    } catch (e) {
      console.error("[extract-lesson-intent] YouTube API search failed:", e);
    }
  }
  return [{
    title: `Search YouTube for "${query}"`,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    channel: "YouTube search",
    thumbnail: null,
  }];
}

async function callGemini(systemPrompt: string, userPrompt: string, keys: string[], history: HistoryTurn[] = [], tools: any[] = [INTENT_TOOL]): Promise<any | null> {
  // Trimmed to the two fastest/most reliable models - this endpoint only needs
  // to extract a few fields, not generate long content, so a heavier fallback
  // chain just adds latency without adding value.
  const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
  for (const key of keys) {
    for (const model of models) {
      try {
        const response = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [...historyToContents(history), { role: "user", parts: [{ text: userPrompt }] }],
              tools,
              generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
            }),
          },
          6000, // give each attempt 6s max before moving on
        );
        if (response.status === 429 || response.status === 503) { console.warn(`Key ${key.slice(-6)} / ${model} rate limited, rotating...`); continue; }
        if (!response.ok) {
          const err = await response.text();
          console.warn(`Key ${key.slice(-6)} / ${model} error ${response.status}: ${err.substring(0, 150)}`);
          continue;
        }
        const data = await response.json();
        const candidate = data?.candidates?.[0];
        if (!candidate) continue;
        return candidate;
      } catch (e: any) {
        if (e?.name === "AbortError") {
          console.warn(`Key ${key.slice(-6)} / ${model} timed out after 6s, moving on`);
        } else {
          console.error(`Network error on key ${key.slice(-6)} / ${model}:`, e);
        }
      }
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { message, mode, history: rawHistory, pages: rawPages } = await req.json();
    const history = sanitizeHistory(rawHistory);
    // Pages in THIS teacher's sidebar (sent by the widget); only these can be opened.
    const pages: { title: string; path: string }[] = (Array.isArray(rawPages) ? rawPages : [])
      .filter((p: any) => p && typeof p.path === "string" && p.path.startsWith("/") && !p.path.startsWith("//") && typeof p.title === "string")
      .slice(0, 120)
      .map((p: any) => ({ title: String(p.title).slice(0, 60), path: String(p.path).slice(0, 120) }));
    const authHeader = req.headers.get("Authorization") ?? "";
    const keys = getGeminiKeys();

    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Video mode: only routes to a real video when the message isn't
    // a lesson-plan creation request or a platform question - those keep
    // working exactly as before regardless of the toggle.
    if (mode === "video" && typeof message === "string" && message.trim()) {
      const { isVideo, query, topicWords } = await classifyVideoIntent(message, keys, history);
      if (isVideo && query) {
        const videos = await searchYouTube(query, topicWords);
        return new Response(JSON.stringify({
          type: "video",
          chatReply: "Here's a video that should help explain this:",
          videos,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Not a video-answerable message - fall through to the normal flow.
    }

    const systemPrompt = `You are APAS AI Teaching Assistant, a friendly assistant for teachers using the APAS platform.

ABOUT APAS (Adaptive Pedagogy & Analytics System) - use this to answer any questions about the platform accurately, never guess or invent features:
- A multi-school, multi-role EdTech platform for students, teachers, HODs, principals, school admins, and KNSoft admins.
- Academics: lesson plan generation, curative/differentiated lesson plans by VARK learning style, diagnostic tests, academic tests, worksheets & homework, syllabus tracking, semester/timetable engine, exam seating, hall tickets.
- Analytics & AI: AI Tutor, AI Teacher Assistant, AI Knowledge Hub, predictive analytics, risk prediction, competency heatmaps, school quality index, knowledge graph dashboard.
- Student life: gamification (learning games, leaderboard), skills passport, group projects, virtual classroom, attendance marking & risk analysis, behaviour analytics, SEN management, safeguarding/incident reporting.
- Admin & ERP: admissions, fee management, inventory, library, HR/people, billing, ID card generator, multi-tenant dashboard, branch management, security center.
- Transport: bus tracking, route planning, driver management, geofencing, delay prediction, weather/traffic alerts.
- Communication: parent/teacher/student/driver communication centers, notifications, alerts, appointment booking.
- Built with React/TypeScript, Supabase (Postgres + Edge Functions), and Google Gemini/Groq for AI features.

YOU CAN DO THREE THINGS WITH TOOLS:
1. create_lesson_plan_intent - the teacher wants a lesson plan created. Extract whatever fields you can; leave the rest null, do not guess.
2. get_teacher_data - ANY question about the teacher's own students, classes or work in APAS: homework submitted / not submitted / pending,
   worksheets to review, attendance today (absent, late, not marked), student doubts, parent appointments, interventions / at-risk students,
   upcoming exams / deadlines / events, assessment papers to evaluate, "my classes", "how many students", "what is pending today".
   ALWAYS use this tool for such questions. NEVER answer that you cannot access student data - you can, through this tool.
3. open_page - the teacher asks to open / go to / show / take them to a page or module ("open attendance", "take me to doubts", "show my timetable").
Otherwise, do NOT call a tool. Instead reply naturally and conversationally:
- For greetings/small talk, keep it to 1-2 short sentences.
- For questions about APAS itself, answer accurately using the knowledge above in 2-4 sentences - be specific about which module/feature handles what.
- If asked about something APAS does NOT do (not listed above), say so honestly rather than inventing an answer.
- If asked to explain an academic topic/concept (e.g. "explain fractions", "what is photosynthesis"), you may use your own general subject-matter knowledge to give a clear, accurate, classroom-appropriate explanation - this isn't an APAS feature question.
You can mention you're able to build lesson plans if it fits naturally, but don't force it into every reply.

NEVER include a URL, hyperlink, or "[Video Link: ...]" style placeholder in your response, for any reason, even if asked directly for a link. You have no ability to browse or verify real links, so any link you wrote would be fabricated. Actual video links are only ever attached separately by the app itself when the teacher uses "Find a video" mode - if they want a video, tell them to tap "Find a video" and ask again, rather than describing or linking one yourself.
${mode === "video" ? `\nNOTE: The teacher is currently in "video" answer mode, but this message didn't need a video (it's a lesson-plan request, a platform question, or small talk) - answer normally in text, with no links.` : ""}

CONVERSATION MEMORY: Earlier turns are provided. Use them to resolve short follow-ups such as "give me an example", "explain it simpler", "for class 7", "and for section B" - they refer to the earlier topic or request. If the teacher is supplying missing details for a lesson plan requested earlier, call create_lesson_plan_intent combining the earlier details with the new ones.

VOICE CONVERSATION RULES:
- Treat every user message as exactly one conversation turn.
- Answer only the user's current message.
- Never generate multiple answers for one message.
- Never invent a second user message.
- After answering, stop and wait for the next user message.
- For greetings such as "hi", "hello", or "hey", give one short friendly response and nothing more.`;

    const startedAt = Date.now();
    const tools = [{ functionDeclarations: [...INTENT_TOOL.functionDeclarations, DATA_TOOL, ...(pages.length ? [openPageTool(pages)] : [])] }];
    const candidate = await callGemini(systemPrompt, message, keys, history, tools);
    console.log(`extract-lesson-intent resolved in ${Date.now() - startedAt}ms`);

    const parts = candidate?.content?.parts || [];
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;

    if (!fnCall) {
      const chatReply = parts.find((p: any) => p.text)?.text?.trim()
        || "Hi! I'm here whenever you'd like to build a lesson plan - just tell me the class, subject and topic.";
      return new Response(JSON.stringify({ isLessonRequest: false, chatReply }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reply = (body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // ---- "Open attendance" style requests the on-device matcher did not catch.
    if (fnCall.name === "open_page") {
      const page = pages.find((p) => p.path === fnCall.args?.path);
      if (!page) return reply({ isLessonRequest: false, chatReply: "I couldn't find that page in your menu." });
      return reply({ isLessonRequest: false, navigate: page.path, chatReply: `Opening ${page.title}.` });
    }

    // ---- Questions about the teacher's own data.
    if (fnCall.name === "get_teacher_data") {
      const topic = (TEACHER_DATA_TOPICS as readonly string[]).includes(fnCall.args?.topic) ? fnCall.args.topic as TeacherDataTopic : "overview";
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user) return reply({ isLessonRequest: false, chatReply: "Please log in again so I can look at your classes." });

      const facts = await getTeacherData(userClient, userData.user.id, topic, {
        class_level: fnCall.args?.class_level ?? null, section: fnCall.args?.section ?? null, subject: fnCall.args?.subject ?? null,
      });
      const detailPage = pages.find((p) => p.path === TOPIC_PAGE[topic].path) ?? null;
      const answerPrompt = `You are the APAS teaching assistant answering a teacher's question by voice and text.
Answer ONLY from the FACTS (JSON from the school database, already limited to what this teacher may see). Never invent names or numbers.
- Answer in the same language the teacher used. Keep it short and natural for speaking: 2-5 sentences.
- When listing students, say up to 10 names, then "and N more".
- If a list is empty or a count is 0, say that clearly (e.g. "Everyone has submitted").
- If a part says "unavailable", just say you couldn't read that part right now.
- Use plain text only: no markdown, no bullet symbols, no URLs.
${detailPage ? `- End with one short line that they can say "open ${detailPage.title}" to see the details.` : ""}

FACTS:
${JSON.stringify(facts).slice(0, 12000)}`;
      const answer = await callGeminiPlain(answerPrompt, message, keys, [], 700, 9000);
      console.log(`extract-lesson-intent data answer (${topic}) in ${Date.now() - startedAt}ms`);
      return reply({
        isLessonRequest: false,
        chatReply: answer || `I found the details, but couldn't summarise them right now.${detailPage ? ` Say "open ${detailPage.title}" to see them.` : ""}`,
        data_topic: topic,
        details_page: detailPage,
      });
    }

    return new Response(JSON.stringify({ isLessonRequest: true, intent: fnCall.args }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-lesson-intent error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
