// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TOC_VERSION = "v4"; // bumped to clear old cache
const TOC_SOURCE_TYPE = `toc_${TOC_VERSION}`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileName, classLevel, subject } = await req.json();

    if (!fileName || !classLevel) {
      return new Response(
        JSON.stringify({ error: "fileName and classLevel are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rotate through multiple API keys to distribute rate limits (for future use)
    const allKeys = [
      Deno.env.get("GEMINI_ADVANCED_API_KEY"),
      Deno.env.get("GEMINI_KEY_2"),
      Deno.env.get("GOOGLE_GEMINI_API_KEY"),
    ].filter(Boolean) as string[];
    const _GEMINI_API_KEY = allKeys.length > 0 
      ? allKeys[Math.floor(Date.now() / 60000) % allKeys.length]
      : undefined;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── 1. Check cache ───────────────────────────────────────────────
    const { data: cached } = await supabase
      .from("knowledge_chunks")
      .select("chunk_text")
      .eq("file_name", fileName)
      .eq("class_level", classLevel)
      .eq("source_type", TOC_SOURCE_TYPE)
      .maybeSingle();

    if (cached?.chunk_text) {
      const chapters = JSON.parse(cached.chunk_text);
      return new Response(
        JSON.stringify({ chapters, fromCache: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Download PDF from Supabase Storage ────────────────────────
    const folderMap: Record<string, string> = {
      nursery: "nursery", lkg: "lkg", ukg: "ukg",
    };
    for (let i = 1; i <= 10; i++) folderMap[`${i}`] = `class ${i}`;
    const folder = folderMap[classLevel] || `class ${classLevel}`;
    const filePath = `${folder}/${fileName}`;

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("TextBooks")
      .download(filePath);

    if (downloadError || !fileData) {
      return new Response(
        JSON.stringify({ error: `Failed to download: ${downloadError?.message}`, chapters: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Get only first 5 pages of PDF ────────────────────────────
    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Extract just first 5 pages using pdf-parse to get text
    // then send that text to Gemini (much smaller than whole PDF)
    let extractedText = "";
    try {
      const pdfParse = (await import("npm:pdf-parse@1.1.1")).default;
      const data = await pdfParse(uint8Array, { max: 5 }); // first 5 pages only
      extractedText = data.text;
      console.log("Extracted text length:", extractedText.length);
      console.log("Extracted text sample (0-1000):", extractedText.slice(0, 1000));
      console.log("Extracted text sample (1000-2000):", extractedText.slice(1000, 2000));
    } catch (e) {
      console.error("pdf-parse error:", e);
      return new Response(
        JSON.stringify({ error: "Failed to parse PDF", chapters: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 4. Parse chapters from extracted text (simple regex, no API needed) ──
    const lines = extractedText.split('\n');
    const chapters: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Match "Unit 1 –", "Chapter 1.", "Chapter 1 –", "Lesson 1 :"
      const match = trimmed.match(
        /^((?:Unit|Chapter|Lesson|Topic|Section)\s+\d+\s*[–\-—:.]?\s*[–\-—]?)\s*([A-Za-z][^0-9\n]{2,})/i
      );
      if (!match) continue;

      const prefix = match[1].trim();
      let title = match[2].trim();

      // Remove dots and page numbers: "Born to Dance ......3" → "Born to Dance"
      title = title.replace(/[\s.]*\.{2,}[\s\d]*$/, "").trim();
      title = title.replace(/\s+\d+\s*$/, "").trim();

      // Only remove trailing words if they look like an author name
      // Author pattern: exactly 2-3 words, all Title Case, at end
      // BUT only if the title before them is meaningful (more than 2 words)
      const words = title.split(/\s+/);
      const titleWords = [];
      let foundAuthor = false;

      for (let i = 0; i < words.length; i++) {
        const remaining = words.slice(i);
        // Check if remaining 2-3 words look like an author name
        // Author: 2-3 consecutive Title Case words at the very end
        const isAuthorPattern2 = remaining.length === 2 &&
          /^[A-Z][a-z]+$/.test(remaining[0]) &&
          /^[A-Z][a-z]+$/.test(remaining[1]);
        const isAuthorPattern3 = remaining.length === 3 &&
          /^[A-Z][a-z]+$/.test(remaining[0]) &&
          /^[A-Z][a-z]+$/.test(remaining[1]) &&
          /^[A-Z][a-z]+$/.test(remaining[2]);

        if ((isAuthorPattern2 || isAuthorPattern3) && titleWords.length >= 2) {
          foundAuthor = true;
          break;
        }
        titleWords.push(words[i]);
      }

      title = titleWords.join(" ").trim();

      const chapterName = `${prefix} ${title}`.replace(/\s+/g, ' ').trim();

      if (chapterName.length > 8 && !chapters.includes(chapterName)) {
        chapters.push(chapterName);
      }
    }

    console.log("Parsed chapters:", chapters);

    // ── 5. Cache result in knowledge_chunks ──────────────────────────
    if (chapters.length > 0) {
      await supabase.from("knowledge_chunks").insert({
        file_name: fileName,
        chunk_text: JSON.stringify(chapters),
        class_level: classLevel,
        subject: subject || null,
        source_type: TOC_SOURCE_TYPE,
      });
    }

    return new Response(
      JSON.stringify({ chapters, fromCache: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("extract-chapters error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", chapters: [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
