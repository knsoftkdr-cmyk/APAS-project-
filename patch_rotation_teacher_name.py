path = "supabase/functions/get-rotation-schedule/index.ts"
with open(path, "r") as f:
    content = f.read()

changes = []

# ---------------------------------------------------------------------
# 1. Fetch teacher profiles for all teacher_ids referenced by blocks,
#    right after blocks are fetched (step 4 in the function).
# ---------------------------------------------------------------------
anchor = '''    if (blocksErr) throw blocksErr;

    // 5. Overrides for this exact date'''

new_step = '''    if (blocksErr) throw blocksErr;

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

    // 5. Overrides for this exact date'''

if "4b. Resolve teacher names" not in content:
    content = content.replace(anchor, new_step)
    changes.append("Added teacher-name lookup after blocks fetch")
else:
    changes.append("Teacher-name lookup already present, skipping")

# ---------------------------------------------------------------------
# 2. Add teacher_name to the override "found block" branch
# ---------------------------------------------------------------------
old_override_block = '''              const block = cycleBlocks.find((b) => b.id === override.rotation_block_id);
              return {
                group_id: group.id,
                group_name: group.group_name,
                block_id: block?.id ?? null,
                block_name: block?.block_name ?? null,
                subject: block?.subject ?? null,
                teacher_id: block?.teacher_id ?? null,
                room: block?.room ?? null,
                is_override: true,
                skipped: false,
              };'''

new_override_block = '''              const block = cycleBlocks.find((b) => b.id === override.rotation_block_id);
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
              };'''

if old_override_block in content:
    content = content.replace(old_override_block, new_override_block)
    changes.append("Added teacher_name to override-with-block branch")
else:
    changes.append("WARNING: override-with-block anchor not found, check manually")

# ---------------------------------------------------------------------
# 3. Add teacher_name to the skipped-override branch (null, for consistency)
# ---------------------------------------------------------------------
old_skip_block = '''                return {
                  group_id: group.id,
                  group_name: group.group_name,
                  block_id: null,
                  block_name: null,
                  subject: null,
                  teacher_id: null,
                  room: null,
                  is_override: true,
                  skipped: true,
                  reason: override.reason ?? null,
                };'''

new_skip_block = '''                return {
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
                };'''

if old_skip_block in content:
    content = content.replace(old_skip_block, new_skip_block)
    changes.append("Added teacher_name: null to skipped-override branch")
else:
    changes.append("WARNING: skipped-override anchor not found, check manually")

# ---------------------------------------------------------------------
# 4. Add teacher_name to the normal (non-override) assignment branch
# ---------------------------------------------------------------------
old_normal_block = '''            return {
              group_id: group.id,
              group_name: group.group_name,
              block_id: block.id,
              block_name: block.block_name,
              subject: block.subject,
              teacher_id: block.teacher_id,
              room: block.room,
              is_override: false,
              skipped: false,
            };'''

new_normal_block = '''            return {
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
            };'''

if old_normal_block in content:
    content = content.replace(old_normal_block, new_normal_block)
    changes.append("Added teacher_name to normal assignment branch")
else:
    changes.append("WARNING: normal-assignment anchor not found, check manually")

with open(path, "w") as f:
    f.write(content)

print("\n".join(changes))
