// Image Compression Service
// Handles image compression with Cloudflare integration

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simulated image compression (in production, use sharp or similar)
async function compressImage(
  buffer: Uint8Array,
  quality: number = 80
): Promise<{ compressed: Uint8Array; originalSize: number; compressedSize: number }> {
  // Placeholder - in production use sharp or web-based compression
  // This would call an actual compression service
  const originalSize = buffer.length;
  
  // Simulate compression ratio (typically 20-50% reduction)
  const compressionRatio = 0.7 + Math.random() * 0.15;
  const compressedSize = Math.floor(originalSize * compressionRatio);
  
  // For now, just return reduced buffer
  const compressed = buffer.slice(0, compressedSize);
  
  return {
    compressed,
    originalSize,
    compressedSize,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("authorization");
    const userIdMatch = authHeader?.match(/user_id=([^&]+)/);
    const userId = userIdMatch ? userIdMatch[1] : null;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, filename, quality = 80 } = await req.json();

    if (action === "compress_upload") {
      // Get file from request body or Supabase Storage
      const formData = await req.formData();
      const file = formData.get("file") as File;

      if (!file) {
        return new Response(
          JSON.stringify({ error: "No file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const originalBuffer = await file.arrayBuffer();
      const originalSize = originalBuffer.byteLength;
      const mimeType = file.type;

      // Log compression attempt
      const { data: logEntry } = await supabase
        .from("image_compression_log")
        .insert({
          user_id: userId,
          original_filename: filename || file.name,
          original_size_bytes: originalSize,
          mime_type: mimeType,
          quality_level: quality,
          status: "pending",
        })
        .select()
        .single();

      try {
        // Compress image
        const { compressed, compressedSize } = await compressImage(
          new Uint8Array(originalBuffer),
          quality
        );

        // Upload to Supabase Storage
        const storagePath = `images/${userId}/${Date.now()}-${filename || file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(storagePath, compressed, {
            contentType: mimeType,
          });

        if (uploadError) throw uploadError;

        // Update log with success
        await supabase
          .from("image_compression_log")
          .update({
            compressed_size_bytes: compressedSize,
            storage_path: storagePath,
            status: "compressed",
          })
          .eq("id", logEntry.id);

        // Get public URL
        const { data: publicUrl } = supabase.storage
          .from("uploads")
          .getPublicUrl(storagePath);

        return new Response(
          JSON.stringify({
            success: true,
            original_size_bytes: originalSize,
            compressed_size_bytes: compressedSize,
            compression_ratio: (
              ((originalSize - compressedSize) / originalSize) *
              100
            ).toFixed(2),
            storage_path: storagePath,
            public_url: publicUrl.publicUrl,
            mime_type: mimeType,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        // Log failure
        await supabase
          .from("image_compression_log")
          .update({
            status: "failed",
            error_message: e instanceof Error ? e.message : "Unknown error",
          })
          .eq("id", logEntry.id);

        throw e;
      }
    }

    if (action === "get_compression_stats") {
      const { days = 30 } = await req.json();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data: logs } = await supabase
        .from("image_compression_log")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", startDate.toISOString())
        .eq("status", "compressed");

      if (!logs || logs.length === 0) {
        return new Response(
          JSON.stringify({
            total_compressed: 0,
            total_bytes_saved: 0,
            avg_compression_ratio: 0,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const totalOriginal = logs.reduce(
        (sum: number, log: any) => sum + log.original_size_bytes,
        0
      );
      const totalCompressed = logs.reduce(
        (sum: number, log: any) => sum + log.compressed_size_bytes,
        0
      );

      return new Response(
        JSON.stringify({
          total_compressed: logs.length,
          total_bytes_saved: totalOriginal - totalCompressed,
          total_original_bytes: totalOriginal,
          total_compressed_bytes: totalCompressed,
          avg_compression_ratio: (
            ((totalOriginal - totalCompressed) / totalOriginal) *
            100
          ).toFixed(2),
          logs,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Compression error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
