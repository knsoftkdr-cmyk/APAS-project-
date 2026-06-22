import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { worksheet_id, worksheet_content, topic, vark_type } = await req.json();

    const geminiKey = Deno.env.get("Worksheet_gemini_api_key");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Use only the activities part (before COMPLETE ANSWER KEY) to keep prompt focused
    const contentOnly = worksheet_content.split("COMPLETE ANSWER KEY")[0].trim();
    // Limit to avoid token overflow
    const truncated = contentOnly.slice(0, 3000);

    const imagePrompt = `You are an expert educational worksheet designer specializing in creating visually appealing printable worksheets for primary and middle school students.

Your task is to convert the given worksheet text into a professionally designed educational poster.

##############################
INPUT
##############################

Worksheet Title: ${topic ?? "Science Worksheet"}
Date: ___________________________
Worksheet Content:
${truncated}

##############################
DESIGN REQUIREMENTS
##############################

Create a SINGLE PAGE printable worksheet poster.
Page Size: A4 Portrait
Resolution: 2480 x 3508 pixels
Print Quality: 300 DPI
Overall appearance should resemble premium CBSE/ICSE school worksheets.

##############################
LAYOUT
##############################

- Automatically detect the number of activities.
- Arrange activities in a balanced multi-column grid.
- Use either 2 columns or 3 columns depending on content length.
- Every activity should be placed inside an independent rounded rectangle.
- Maintain equal spacing between sections.
- Do not allow text overlap.
- Do not crop content.
- Entire worksheet must fit inside one page.

##############################
STYLING
##############################

Background: Pure White
Borders: Thin soft green
Section Headers: Dark Green
Text: Black
Boxes: Rounded Corners
Fonts: Modern Sans Serif (Nunito, Poppins, Arial Rounded, Comic Neue)
Use large readable fonts. Keep text crisp and sharp.

##############################
ILLUSTRATIONS
##############################

Add small classroom-friendly illustrations relevant to the worksheet topic: ${topic ?? "science"}.
Do NOT use decorative elements unrelated to the worksheet topic.

##############################
TEXT HANDLING
##############################

Preserve ALL worksheet text exactly.
Do not rewrite sentences.
Do not summarize content.
Do not remove questions.
Do not change numbering.
Do not alter examples.

##############################
SPECIAL CONTENT
##############################

If worksheet contains Tables, Matching exercises, MCQs, True or False, Fill in the blanks, Drawing Activities, Pattern Activities, Sorting Activities, Short Answer Questions, Diagram Labeling - render them visually in an educational style:
- Matching Questions -> two-column tables
- MCQs -> circular options
- Fill blanks -> horizontal lines
- Drawing Questions -> empty bordered boxes
- Sorting Activities -> categorized tables
- Pattern Activities -> sequence placeholders
- Diagram Questions -> illustration + blank area

##############################
VISUAL QUALITY
##############################

Maintain a cheerful classroom aesthetic.
Use soft greens, light blues, yellow accents.
Avoid saturated colors.
Provide sufficient whitespace.
Make worksheet look similar to professionally printed worksheets distributed in schools.

##############################
STRICT RULES
##############################

DO NOT: crop activities, truncate text, hide questions, merge sections, overlap content, cut off borders, use dark backgrounds, use cursive fonts, produce blurry text, place content outside margins.

##############################
OUTPUT
##############################

Generate a high-resolution educational worksheet poster.
The final image should appear as if it was designed by a professional educational content designer.
Preserve every activity and question from the input worksheet.`;

    const imagenResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: imagePrompt }] }],
          generation_config: { response_modalities: ["IMAGE"] },
        }),
      }
    );

    if (!imagenResponse.ok) {
      const err = await imagenResponse.text();
      throw new Error(`Imagen API error: ${err}`);
    }

    const imagenData = await imagenResponse.json();
    const parts = imagenData.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
    if (!imagePart) throw new Error("No image returned. Parts: " + JSON.stringify(parts).slice(0, 300));

    const base64Image = imagePart.inlineData.data;
    const mimeType = imagePart.inlineData.mimeType;
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const imageBytes = Uint8Array.from(atob(base64Image), (c) => c.charCodeAt(0));

    const fileName = `worksheet-${worksheet_id}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("worksheet-images")
      .upload(fileName, imageBytes, { contentType: mimeType, upsert: true });

    if (uploadError) throw new Error(`Storage upload error: ${uploadError.message}`);

    const { data: urlData } = supabase.storage.from("worksheet-images").getPublicUrl(fileName);
    const imageUrl = urlData.publicUrl;

    const { error: updateError } = await supabase
      .from("worksheets")
      .update({ image_url: imageUrl })
      .eq("id", worksheet_id);

    if (updateError) throw new Error(`DB update error: ${updateError.message}`);

    return new Response(JSON.stringify({ success: true, image_url: imageUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("generate-worksheet-image error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
