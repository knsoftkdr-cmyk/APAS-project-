import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    start += chunkSize - overlap;
  }
  return chunks;
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-ada-002",
      input: text.slice(0, 8000),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 429) {
      throw new Error("OPENAI_QUOTA_EXCEEDED");
    }
    throw new Error(`OpenAI embedding error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_KEY = Deno.env.get("OPEN_AI_KEY");
    if (!OPENAI_KEY) {
      return new Response(
        JSON.stringify({ error: "OPEN_AI_KEY not configured. Please add your OpenAI API key to use embedding features." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { file_name, content, subject, class_level, curriculum } = await req.json();

    if (!content || !file_name) {
      return new Response(JSON.stringify({ error: "file_name and content are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing "${file_name}": ${content.length} chars`);

    const chunks = chunkText(content);
    console.log(`Created ${chunks.length} chunks`);

    let processed = 0;
    let skipped = 0;
    const results = [];

    for (const chunk of chunks) {
      try {
        const embedding = await generateEmbedding(chunk, OPENAI_KEY);

        const { data: embData, error: embError } = await supabase
          .from("ai_embeddings")
          .insert({
            content: chunk,
            embedding: JSON.stringify(embedding),
            metadata: { file_name, subject, class_level, curriculum },
          })
          .select("id")
          .single();

        if (embError) {
          console.error("Embedding insert error:", embError);
          skipped++;
          continue;
        }

        const { error: chunkError } = await supabase
          .from("knowledge_chunks")
          .insert({
            file_name,
            chunk_text: chunk,
            subject: subject || null,
            class_level: class_level || null,
            curriculum: curriculum || null,
            embedding_id: embData.id,
          });

        if (chunkError) console.error("Chunk insert error:", chunkError);

        processed++;

        if (processed % 10 === 0) {
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (chunkErr: any) {
        if (chunkErr.message === "OPENAI_QUOTA_EXCEEDED") {
          console.error("OpenAI quota exceeded after processing", processed, "chunks");
          results.push({ file_name, total_chunks: chunks.length, processed, skipped: chunks.length - processed, error: "OpenAI quota exceeded. Partial processing completed." });
          return new Response(
            JSON.stringify({ success: false, error: "OpenAI API quota exceeded. Only " + processed + " of " + chunks.length + " chunks were processed. Please check your OpenAI billing.", results }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.error("Chunk processing error:", chunkErr);
        skipped++;
      }
    }

    results.push({ file_name, total_chunks: chunks.length, processed, skipped });

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("embed-knowledge error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
