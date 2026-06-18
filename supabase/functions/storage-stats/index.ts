import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await supabase
    .schema("storage")
    .from("objects")
    .select("metadata")
    .not("metadata", "is", null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const totalFiles = data?.length ?? 0;
  const totalBytes = (data ?? []).reduce((sum: number, obj: any) => sum + (obj?.metadata?.size ?? 0), 0);
  const totalMb = totalBytes / (1024 * 1024);

  return new Response(JSON.stringify({ totalFiles, totalMb }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
