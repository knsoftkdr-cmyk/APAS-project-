// supabase/functions/get-teacher-rotation-schedule/index.ts
//
// Resolves which rotation blocks a given TEACHER is assigned to teach today,
// across all classes/groups they're scheduled for — the reverse of
// get-rotation-schedule (which is keyed by class, not teacher).
//
// Input (POST body):
//   {
//     "school_id": "uuid",
//     "teacher_id": "uuid",
//     "date": "2026-07-14"          // optional, defaults to today
//   }
//
// Output:
//   {
//     "date": "2026-07-14",
//     "day_of_week": "tuesday",
//     "assignments": [
//       {
//         "cycle_id": "...",
//         "cycle_name": "Specials Rotation - Class 5A",
//         "period_number": 1,
//         "class_grade": "5",
//         "section": "A",
//         "group_id": "...",
//         "group_name": "5A",
//         "block_name": "science",
//         "subject": "science",
//         "room": null,
//         "is_override": false,
//         "skipped": false
//       }
//       // ...one entry per (slot x group) where this teacher is assigned
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
    const { school_id, teacher_id, date } = await req.json();

    if (!school_id || !teacher_id) {
      return new Response(
        JSON.stringify({ error: "school_id and teacher_id are required" }),
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

    // 1. Active cycles for this school covering this date
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
        JSON.stringify({ date: targetDateStr, day_of_week: dayOfWeek, assignments: [] }),
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
        JSON.stringify({ date: targetDateStr, day_of_week: dayOfWeek, assignments: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const activeCycleIds = [...new Set(slots.map((s) => s.rotation_cycle_id))];

    // 3. ALL blocks for these cycles (we filter to this teacher after resolving,
    //    since which group lands on which block depends on rotation iteration)
    const { data: blocks, error: blocksErr } = await supabase
      .from("rotation_blocks")
      .select("*")
      .in("rotation_cycle_id", activeCycleIds)
      .order("sequence_order", { ascending: true });

    if (blocksErr) throw blocksErr;

    // Quick short-circuit: if this teacher isn't on any block in these cycles, nothing to do
    const teacherBlockIds = new Set(
      (blocks ?? []).filter((b) => b.teacher_id === teacher_id).map((b) => b.id),
    );
    if (teacherBlockIds.size === 0) {
      return new Response(
        JSON.stringify({ date: targetDateStr, day_of_week: dayOfWeek, assignments: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. ALL groups for these cycles (any class/section, not filtered)
    const { data: groups, error: groupsErr } = await supabase
      .from("rotation_groups")
      .select("*")
      .in("rotation_cycle_id", activeCycleIds);

    if (groupsErr) throw groupsErr;

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

    // 6. Resolve each cycle's slot -> group assignments, keep only this teacher's
    const assignments: any[] = [];

    for (const cycle of cycles) {
      if (!activeCycleIds.includes(cycle.id)) continue;

      const cycleSlots = slots.filter((s) => s.rotation_cycle_id === cycle.id);
      const cycleGroups = (groups ?? []).filter((g) => g.rotation_cycle_id === cycle.id);
      const cycleBlocks = (blocks ?? [])
        .filter((b) => b.rotation_cycle_id === cycle.id)
        .sort((a, b) => a.sequence_order - b.sequence_order);

      if (cycleBlocks.length === 0 || cycleGroups.length === 0) continue;

      const startDate = new Date(cycle.start_date);
      const daysSinceStart = Math.floor(
        (targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const iteration = Math.floor(daysSinceStart / cycle.cycle_length_days);

      for (const slot of cycleSlots) {
        for (const group of cycleGroups) {
          const override = overrides.find(
            (o) => o.rotation_group_id === group.id && o.rotation_cycle_id === cycle.id,
          );

          let resolvedBlock: any = null;
          let isOverride = false;
          let skipped = false;

          if (override) {
            isOverride = true;
            if (!override.rotation_block_id) {
              skipped = true;
            } else {
              resolvedBlock = cycleBlocks.find((b) => b.id === override.rotation_block_id) ?? null;
            }
          } else {
            const blockIndex =
              ((group.group_sequence_order + iteration) % cycleBlocks.length +
                cycleBlocks.length) % cycleBlocks.length;
            resolvedBlock = cycleBlocks[blockIndex];
          }

          if (skipped || !resolvedBlock) continue;
          if (resolvedBlock.teacher_id !== teacher_id) continue; // not this teacher's block

          assignments.push({
            cycle_id: cycle.id,
            cycle_name: cycle.name,
            period_number: slot.period_number,
            class_grade: group.class_grade,
            section: group.section,
            group_id: group.id,
            group_name: group.group_name,
            block_name: resolvedBlock.block_name,
            subject: resolvedBlock.subject,
            room: resolvedBlock.room,
            is_override: isOverride,
            skipped: false,
          });
        }
      }
    }

    // Sort by period for a clean teacher-facing schedule
    assignments.sort((a, b) => a.period_number - b.period_number);

    return new Response(
      JSON.stringify({ date: targetDateStr, day_of_week: dayOfWeek, assignments }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
