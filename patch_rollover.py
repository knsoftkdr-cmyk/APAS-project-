path = "src/pages/SemesterEngine.tsx"
with open(path) as f:
    c = f.read()

old = '''  const doRollover = async () => {
    if (!activeSemester || !activeYear) return;
    if (!confirm("This will update class grades for all promoted students. Continue?")) return;
    setSaving(true);
    const promoted = Object.entries(progressions).filter(([, p]) => p.promotion_status === "promoted");
    let count = 0;
    for (const [studentId, prog] of promoted) {
      if (prog.to_class && prog.to_class !== prog.from_class) {
        const displayClass = /^\\d+$/.test(prog.to_class) ? `Class ${prog.to_class}` : prog.to_class.charAt(0).toUpperCase() + prog.to_class.slice(1);
        await supabase.from("students").update({ class: displayClass }).eq("id", studentId);
        const pid = students.find((s) => s.id === studentId)?.profile_id;
        if (pid) await supabase.from("profiles").update({ class_grade: prog.to_class }).eq("id", pid);
        count++;
      }
    }
    await supabase.from("semester_rollover_logs").insert({
      school_id: profile!.school_id,
      from_academic_year: activeYear.id,
      processed_students: promoted.length,
      promoted_count: count,
      retained_count: promoted.length - count,
      completed_at: new Date().toISOString(),
      status: "completed",
      triggered_by: profile!.id,
    });
    setSaving(false);
    toast.success(`Rollover complete — ${count} students moved to next class`);
    fetchAll();
  };'''

assert old in c, "doRollover block not found — file may have changed"

new = '''  const doRollover = async () => {
    if (!activeSemester || !activeYear) return;
    if (!confirm("This will update class grades for all promoted students. Continue?")) return;
    setSaving(true);
    const promoted = Object.entries(progressions).filter(([, p]) => p.promotion_status === "promoted");
    let count = 0;
    let graduatedCount = 0;

    const { data: schoolRow } = await supabase
      .from("schools")
      .select("terminal_class")
      .eq("id", profile!.school_id)
      .single();
    const terminalClass = schoolRow?.terminal_class ?? null;

    for (const [studentId, prog] of promoted) {
      const isGraduating = terminalClass && prog.from_class === terminalClass;

      if (isGraduating) {
        const pid = students.find((s) => s.id === studentId)?.profile_id;
        await supabase.from("alumni_profiles").insert({
          student_id: pid ?? studentId,
          school_id: profile!.school_id,
          graduated_class: /^\\d+$/.test(prog.from_class) ? `Class ${prog.from_class}` : prog.from_class,
          batch_year: activeYear.name,
          graduation_date: new Date().toISOString().slice(0, 10),
        });
        graduatedCount++;
      } else if (prog.to_class && prog.to_class !== prog.from_class) {
        const displayClass = /^\\d+$/.test(prog.to_class) ? `Class ${prog.to_class}` : prog.to_class.charAt(0).toUpperCase() + prog.to_class.slice(1);
        await supabase.from("students").update({ class: displayClass }).eq("id", studentId);
        const pid = students.find((s) => s.id === studentId)?.profile_id;
        if (pid) await supabase.from("profiles").update({ class_grade: prog.to_class }).eq("id", pid);
        count++;
      }
    }

    await supabase.from("semester_rollover_logs").insert({
      school_id: profile!.school_id,
      from_academic_year: activeYear.id,
      processed_students: promoted.length,
      promoted_count: count,
      retained_count: promoted.length - count - graduatedCount,
      completed_at: new Date().toISOString(),
      status: "completed",
      triggered_by: profile!.id,
    });
    setSaving(false);
    toast.success(`Rollover complete — ${count} moved up, ${graduatedCount} graduated to alumni`);
    fetchAll();
  };'''

c = c.replace(old, new)
with open(path, "w") as f:
    f.write(c)
print("Patched doRollover")
