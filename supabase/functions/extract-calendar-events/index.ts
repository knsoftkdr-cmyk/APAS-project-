import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { document_text } = await req.json();

    if (!document_text || typeof document_text !== "string" || !document_text.trim()) {
      return new Response(
        JSON.stringify({ error: "document_text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("Worksheet_gemini_api_key");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const currentYear = new Date().getFullYear();

    const prompt = `Extract all academic calendar events from the document below.

Return ONLY a valid JSON array, with no markdown formatting, no code fences, no explanation text before or after.

Each item in the array must be an object with exactly these fields:
- "title": string (the event name, cleaned up, no bullet points or numbering)
- "event_type": one of exactly these four strings: "holiday", "exam", "class_period", "event"
- "start_date": string in YYYY-MM-DD format
- "end_date": string in YYYY-MM-DD format (same as start_date if it's a single day)
- "description": string (optional extra context, can be empty string "")

Rules for event_type:
- "holiday" = school holidays, festivals, breaks, vacations
- "exam" = tests, exams, assessments, unit tests, board exams
- "class_period" = term dates, semester dates, school open/close dates, working days
- "event" = anything else: sports day, annual day, functions, PTA meetings, etc.

Rules for dates:
- If no year is mentioned, assume ${currentYear}.
- If a date range is given (e.g. "Oct 20-21" or "5th to 10th August"), set start_date and end_date accordingly.
- If only one date is given, set start_date and end_date to the same value.
- Always output dates as YYYY-MM-DD, zero-padded.

If the document contains a table with columns, treat each row as one event using the column headers to figure out which column is the date and which is the title.

Document:
---
${document_text.slice(0, 8000)}
---

Return ONLY the JSON array now.`;

    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
    let lastError = "";

    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
            }),
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          lastError = `${model}: ${response.status} ${errText.slice(0, 200)}`;
          continue;
        }

        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const cleaned = rawText.replace(/```json|```/g, "").trim();

        let events;
        try {
          events = JSON.parse(cleaned);
        } catch {
          const match = cleaned.match(/\[[\s\S]*\]/);
          if (match) {
            events = JSON.parse(match[0]);
          } else {
            throw new Error("Could not parse model output as JSON");
          }
        }

        if (!Array.isArray(events)) {
          lastError = `${model}: response was not a JSON array`;
          continue;
        }

        const validTypes = ["holiday", "exam", "class_period", "event"];
        const dateRe = /^\d{4}-\d{2}-\d{2}$/;
        const cleanEvents = events
          .filter((e: any) => e && typeof e.title === "string" && e.title.trim())
          .map((e: any) => ({
            title: String(e.title).trim().slice(0, 200),
            event_type: validTypes.includes(e.event_type) ? e.event_type : "event",
            start_date: dateRe.test(e.start_date) ? e.start_date : null,
            end_date: dateRe.test(e.end_date) ? e.end_date : (dateRe.test(e.start_date) ? e.start_date : null),
            description: typeof e.description === "string" ? e.description.slice(0, 500) : "",
          }))
          .filter((e: any) => e.start_date && e.end_date);

        return new Response(
          JSON.stringify({ events: cleanEvents, model_used: model }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (modelErr) {
        lastError = `${model}: ${modelErr instanceof Error ? modelErr.message : String(modelErr)}`;
        continue;
      }
    }

    return new Response(
      JSON.stringify({ error: `All models failed. Last error: ${lastError}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});