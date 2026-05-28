import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { studentClass } = await req.json();
    if (!studentClass) throw new Error("studentClass is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Map class value to folder name
    let folder: string;
    const numericClasses = ["1","2","3","4","5","6","7","8","9","10"];
    if (numericClasses.includes(studentClass)) {
      folder = `class${studentClass}`;
    } else {
      // nursery, lkg, ukg - no textbooks uploaded for these
      return new Response(JSON.stringify({ subjects: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: files, error } = await supabase.storage
      .from("textbooks")
      .list(folder, { limit: 100 });

    if (error) throw error;

    // Extract subject names from filenames like "class 3 maths.pdf"
    const subjects: string[] = [];
    const classPattern = new RegExp(`^class\\s*${studentClass}\\s+`, "i");

    for (const file of files || []) {
      if (file.name === ".lovkeep" || !file.name.endsWith(".pdf")) continue;
      // Remove "class X " prefix and ".pdf" suffix
      let subjectName = file.name.replace(/\.pdf$/i, "").replace(classPattern, "").trim();
      // Title case
      subjectName = subjectName
        .split(" ")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
      if (subjectName) subjects.push(subjectName);
    }

    // Sort and deduplicate
    const unique = [...new Set(subjects)].sort();

    return new Response(JSON.stringify({ subjects: unique }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("list-subjects error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
