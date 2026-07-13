// supabase/functions/get-rotation-schedule/index.ts
//
// Resolves which rotation block (subject/teacher/room) each rotation_group
// is assigned to on a given date, for a given class/section.
//
// Input (POST body):
//   {
//     "school_id": "uuid",
//     "class_grade": "5",
//     "section": "A",
//     "date": "2026-07-15"          // optional, defaults to today
//   }
//
// Output:
//   {
//     "date": "2026-07-15",
//     "day_of_week": "wednesday",
//     "slots": [
//       {
//         "cycle_id": "...",
//         "cycle_name": "Specials Rotation - Term 1",
//         "period_number": 7,
//         "split_mode": "sub_group",
//         "assignments": [
//           {
//             "group_id": "...",
//             "group_name": "5A Group 1",
//             "block_id": "...",
//             "block_name": "PE",
//             "subject": "Physical Education",
//             "teacher_id": "...",
//             "room": "Ground",
//             "is_override": false,
//             "skipped": false
//           }
//           // ...one entry per group
//         ]
//       }
//     ]
//   }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { school_id, class_grade, section, date } = await req.json();

    if (!school_id || !class_grade || !section) {
      return new Response(
        JSON.stringify({ error: "school_id, class_grade, and section are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const targetDate = date ? new Date(date) : new Date();
    const targetDateStr = targetDate.toISOString().slice(0, 10);
    const dayOfWeek = DAY_NAMES[targetDate.getUTCDay()];

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1. Find active cycles for this school covering this date
    const { data: cycles, error: cyclesErr } = await supabase
      .from("rotation_cycles")
      .select("*")
      .eq("school_id", school_id)
      .eq("is_active", true)
      .lte("start_date", targetDateStr)
      .or(`end_date.is.null,end_date.gte.${targetDateStr}`);

    if (cyclesErr) throw cyclesErr;
    if (!cycles || cycles.length === 0) {
      return new Response(
        JSON.stringify({ date: targetDateStr, day_of_week: dayOfWeek, slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cycleIds = cycles.map((c) => c.id);

    // 2. Slots active on this day of week, for these cycles
    const { data: slots, error: slotsErr } = await supabase
      .from("rotation_slots")
      .select("*")
      .in("rotation_cycle_id", cycleIds)
      .eq("day_of_week", dayOfWeek);

    if (slotsErr) throw slotsErr;
    if (!slots || slots.length === 0) {
      return new Response(
        JSON.stringify({ date: targetDateStr, day_of_week: dayOfWeek, slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const activeCycleIds = [...new Set(slots.map((s) => s.rotation_cycle_id))];

    // 3. Groups for this class/section within the active cycles
    const { data: groups, error: groupsErr } = await supabase
      .from("rotation_groups")
      .select("*")
      .in("rotation_cycle_id", activeCycleIds)
      .eq("class_grade", class_grade)
      .eq("section", section);

    if (groupsErr) throw groupsErr;

    // 4. Blocks for the active cycles
    const { data: blocks, error: blocksErr } = await supabase
      .from("rotation_blocks")
      .select("*")
      .in("rotation_cycle_id", activeCycleIds)
      .order("sequence_order", { ascending: true });

    if (blocksErr) throw blocksErr;

    // 4b. Resolve teacher names for all blocks (teacher_id -> profiles.full_name)
    const teacherIds = [...new Set((blocks ?? []).map((b) => b.teacher_id).filter(Boolean))];
    let teacherNameById = new Map<string, string>();
    if (teacherIds.length > 0) {
      const { data: teacherProfiles, error: teacherErr } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", teacherIds);
      if (teacherErr) throw teacherErr;
      teacherNameById = new Map((teacherProfiles ?? []).map((p) => [p.id, p.full_name]));
    }

    // 5. Overrides for this exact date
    const groupIds = (groups ?? []).map((g) => g.id);
    let overrides: any[] = [];
    if (groupIds.length > 0) {
      const { data: overridesData, error: overridesErr } = await supabase
        .from("rotation_overrides")
        .select("*")
        .in("rotation_group_id", groupIds)
        .eq("override_date", targetDateStr);
      if (overridesErr) throw overridesErr;
      overrides = overridesData ?? [];
    }

    // 6. Resolve each cycle's slot -> group assignments
    const result = cycles
      .filter((cycle) => activeCycleIds.includes(cycle.id))
      .map((cycle) => {
        const cycleSlots = slots.filter((s) => s.rotation_cycle_id === cycle.id);
        const cycleGroups = (groups ?? []).filter((g) => g.rotation_cycle_id === cycle.id);
        const cycleBlocks = (blocks ?? [])
          .filter((b) => b.rotation_cycle_id === cycle.id)
          .sort((a, b) => a.sequence_order - b.sequence_order);

        if (cycleBlocks.length === 0 || cycleGroups.length === 0) return null;

        // days since cycle start / cycle_length_days = which iteration we're on
        const startDate = new Date(cycle.start_date);
        const daysSinceStart = Math.floor(
          (targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        const iteration = Math.floor(daysSinceStart / cycle.cycle_length_days);

        return cycleSlots.map((slot) => ({
          cycle_id: cycle.id,
          cycle_name: cycle.name,
          period_number: slot.period_number,
          split_mode: cycle.split_mode,
          assignments: cycleGroups.map((group) => {
            const override = overrides.find(
              (o) => o.rotation_group_id === group.id && o.rotation_cycle_id === cycle.id,
            );

            if (override) {
              if (!override.rotation_block_id) {
                return {
                  group_id: group.id,
                  group_name: group.group_name,
                  block_id: null,
                  block_name: null,
                  subject: null,
                  teacher_id: null,
                  teacher_name: null,
                  room: null,
                  is_override: true,
                  skipped: true,
                  reason: override.reason ?? null,
                };
              }
              const block = cycleBlocks.find((b) => b.id === override.rotation_block_id);
              return {
                group_id: group.id,
                group_name: group.group_name,
                block_id: block?.id ?? null,
                block_name: block?.block_name ?? null,
                subject: block?.subject ?? null,
                teacher_id: block?.teacher_id ?? null,
                teacher_name: block?.teacher_id ? (teacherNameById.get(block.teacher_id) ?? null) : null,
                room: block?.room ?? null,
                is_override: true,
                skipped: false,
              };
            }

            const blockIndex =
              ((group.group_sequence_order + iteration) % cycleBlocks.length +
                cycleBlocks.length) % cycleBlocks.length; // guard against negative iterations
            const block = cycleBlocks[blockIndex];

            return {
              group_id: group.id,
              group_name: group.group_name,
              block_id: block.id,
              block_name: block.block_name,
              subject: block.subject,
              teacher_id: block.teacher_id,
              teacher_name: block.teacher_id ? (teacherNameById.get(block.teacher_id) ?? null) : null,
              room: block.room,
              is_override: false,
              skipped: false,
            };
          }),
        }));
      })
      .filter(Boolean)
      .flat();

    return new Response(
      JSON.stringify({ date: targetDateStr, day_of_week: dayOfWeek, slots: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});