// supabase/functions/choose-elective/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Slot values that count as "free" in the timetable grid — ADJUST to match your data
const FREE_SLOT_VALUES = ["", "free", "games", "library", "study"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { elective_id } = await req.json();
    if (!elective_id) {
      return jsonResponse({ error: "elective_id is required" }, 400);
    }

    // 1. Get the authenticated user's profile
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    // FIXED: profiles has class_grade + section directly, not a class_id FK
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, school_id, class_grade, section")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    // 2. Fetch the elective
    const { data: elective, error: electiveError } = await supabase
      .from("electives")
      .select("*")
      .eq("id", elective_id)
      .eq("is_active", true)
      .single();

    if (electiveError || !elective) {
      return jsonResponse({ error: "Elective not found or inactive" }, 404);
    }

    if (elective.school_id !== profile.school_id) {
      return jsonResponse({ error: "Elective not available at your school" }, 403);
    }

    // 3. Capacity check — count confirmed choices for this elective
    const { count, error: countError } = await supabase
      .from("student_elective_choices")
      .select("*", { count: "exact", head: true })
      .eq("elective_id", elective_id);

    if (countError) {
      return jsonResponse({ error: "Failed to check capacity" }, 500);
    }

    if ((count ?? 0) >= elective.capacity) {
      return jsonResponse({ error: "This elective is full" }, 409);
    }

    // 4. Clash check — same slot already chosen (redundant with unique constraint,
    // but lets us return a friendly message instead of a raw Postgres error)
    const { data: existingSlotChoice } = await supabase
      .from("student_elective_choices")
      .select("id")
      .eq("student_profile_id", profile.id)
      .eq("day_of_week", elective.day_of_week)
      .eq("period_number", elective.period_number)
      .maybeSingle();

    if (existingSlotChoice) {
      return jsonResponse(
        { error: `You've already chosen another elective in this slot (${elective.day_of_week}, period ${elective.period_number})` },
        409
      );
    }

    // 5. Clash check against core timetable
    // FIXED: timetables table keyed by (school_id, class_grade, section), grid is {headers, rows}
    // ASSUMPTION: timetable_type = 'class' distinguishes student grids from teacher grids — confirm this value
    const { data: classTimetable, error: ttError } = await supabase
      .from("timetables")
      .select("parsed_grid")
      .eq("school_id", profile.school_id)
      .eq("class_grade", profile.class_grade)
      .eq("section", profile.section)
      .eq("timetable_type", "class")
      .maybeSingle();

    if (ttError) {
      return jsonResponse({ error: "Could not verify timetable" }, 500);
    }

    if (classTimetable?.parsed_grid) {
      const grid = classTimetable.parsed_grid as { headers: string[]; rows: string[][] };

      // Find which column matches the elective's day (headers[0] is the period-label column).
      // Matched on first 3 letters, not exact string — the source sheet has a typo
      // ("thusday" for Thursday), and this is resilient to that and to case differences.
      const dayPrefix = elective.day_of_week.trim().toLowerCase().slice(0, 3);
      const dayColIndex = grid.headers.findIndex(
        (h) => h.trim().toLowerCase().slice(0, 3) === dayPrefix
      );

      if (dayColIndex === -1) {
        // Day not found in grid headers — can't verify a clash, so block (same policy as missing grid).
        console.warn(`Day "${elective.day_of_week}" not found in timetable headers:`, grid.headers);
        return jsonResponse(
          { error: `Could not verify your timetable for ${elective.day_of_week}. Please contact your admin.` },
          409
        );
      } else {
        // Find the row whose period-label cell (row[0], e.g. "period 7") contains the elective's period number
        const matchingRow = grid.rows.find((row) => {
          const label = String(row[0] ?? "").toLowerCase();
          const numberMatch = label.match(/\d+/);
          return numberMatch && parseInt(numberMatch[0], 10) === elective.period_number;
        });

        if (matchingRow) {
          const slotValue = String(matchingRow[dayColIndex] ?? "").trim();
          const isFree = FREE_SLOT_VALUES.includes(slotValue.toLowerCase());

          if (!isFree) {
            return jsonResponse(
              {
                error: `This clashes with your regular timetable — you have "${slotValue}" scheduled on ${elective.day_of_week}, period ${elective.period_number}`,
              },
              409
            );
          }
        } else {
          console.warn(`Period ${elective.period_number} not found in timetable rows for grade ${profile.class_grade} section ${profile.section}`);
          return jsonResponse(
            {
              error: `This elective is scheduled for period ${elective.period_number}, but your class's timetable doesn't have that period defined. This is a setup issue on the school's side — please ask your admin to check the timetable for Class ${profile.class_grade} ${profile.section} or the elective's period assignment.`,
            },
            409
          );
        }
      }
    } else {
      // No uploaded/parsed timetable for this class — can't verify a clash, so block.
      return jsonResponse(
        {
          error: `No timetable is available yet for Class ${profile.class_grade} ${profile.section}. Please contact your admin before selecting an elective.`,
        },
        409
      );
    }

    // 6. All checks passed — insert the choice
    const { data: inserted, error: insertError } = await supabase
      .from("student_elective_choices")
      .insert({
        elective_id: elective.id,
        student_profile_id: profile.id,
        school_id: profile.school_id,
        day_of_week: elective.day_of_week,
        period_number: elective.period_number,
      })
      .select()
      .single();

    if (insertError) {
      // Unique constraint violations land here as a fallback safety net
      if (insertError.code === "23505") {
        return jsonResponse({ error: "You've already selected this elective or slot" }, 409);
      }
      return jsonResponse({ error: "Failed to save your choice" }, 500);
    }

    return jsonResponse({ success: true, choice: inserted }, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Unexpected server error" }, 500);
  }
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}