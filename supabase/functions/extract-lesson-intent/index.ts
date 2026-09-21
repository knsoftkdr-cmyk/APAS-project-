import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
async function callGeminiPlain(systemPrompt: string, userPrompt: string, keys: string[]): Promise<string | null> {
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
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
            }),
          },
          5000,
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
async function classifyVideoIntent(message: string, keys: string[]): Promise<{ isVideo: boolean; query: string; topicWords: string[] }> {
  const classifierPrompt = `You classify a teacher's chat message to a school app assistant that is currently in "find a video" mode - the teacher has explicitly asked for a YouTube video suggestion. Reply with ONLY raw JSON, no markdown fences, no extra words, in exactly this shape:
{"is_video_request": boolean, "search_query": "string", "topic_keywords": ["string", ...]}

is_video_request = true for ANY message a YouTube video could reasonably answer - this includes explaining an academic concept/topic, a classroom demonstration, a motivational/inspirational speech, a story, a song, a "how to", or any explicit request for "a video about/on X". Default to true when in doubt, since the teacher already chose video mode.
is_video_request = false ONLY for: (a) a request to CREATE/GENERATE a lesson plan (e.g. "create a lesson plan on fractions for class 5") - that's a distinct action, not a video request, or (b) a question about the APAS platform itself (what it does, its features), or (c) pure greetings/small talk with no topic at all.

When true: "search_query" is a short, effective YouTube search query for a good, appropriate video on that exact topic. "topic_keywords" is 2-5 lowercase single-word keywords (the core subject words) that a genuinely relevant video's title/description should contain - used to reject off-topic results.
When false: "search_query" and "topic_keywords" can be empty.`;

  const raw = await callGeminiPlain(classifierPrompt, message, keys);
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

async function callGemini(systemPrompt: string, userPrompt: string, keys: string[]): Promise<any | null> {
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
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              tools: [INTENT_TOOL],
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
    const { message, mode } = await req.json();
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
      const { isVideo, query, topicWords } = await classifyVideoIntent(message, keys);
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

If the teacher's message is asking you to create/generate a lesson plan, call the create_lesson_plan_intent tool with whatever fields you can extract - leave the rest null, do not guess.
Otherwise, do NOT call the tool. Instead reply naturally and conversationally:
- For greetings/small talk, keep it to 1-2 short sentences.
- For questions about APAS itself, answer accurately using the knowledge above in 2-4 sentences - be specific about which module/feature handles what.
- If asked about something APAS does NOT do (not listed above), say so honestly rather than inventing an answer.
- If asked to explain an academic topic/concept (e.g. "explain fractions", "what is photosynthesis"), you may use your own general subject-matter knowledge to give a clear, accurate, classroom-appropriate explanation - this isn't an APAS feature question.
You can mention you're able to build lesson plans if it fits naturally, but don't force it into every reply.

NEVER include a URL, hyperlink, or "[Video Link: ...]" style placeholder in your response, for any reason, even if asked directly for a link. You have no ability to browse or verify real links, so any link you wrote would be fabricated. Actual video links are only ever attached separately by the app itself when the teacher uses "Find a video" mode - if they want a video, tell them to tap "Find a video" and ask again, rather than describing or linking one yourself.
${mode === "video" ? `\nNOTE: The teacher is currently in "video" answer mode, but this message didn't need a video (it's a lesson-plan request, a platform question, or small talk) - answer normally in text, with no links.` : ""}

VOICE CONVERSATION RULES:
- Treat every user message as exactly one conversation turn.
- Answer only the user's current message.
- Never generate multiple answers for one message.
- Never invent a second user message.
- After answering, stop and wait for the next user message.
- For greetings such as "hi", "hello", or "hey", give one short friendly response and nothing more.`;

    const startedAt = Date.now();
    const candidate = await callGemini(systemPrompt, message, keys);
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
