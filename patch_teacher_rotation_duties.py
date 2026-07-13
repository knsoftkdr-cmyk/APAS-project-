path = "src/pages/TimetablePage.tsx"
with open(path, "r") as f:
    content = f.read()

changes = []

# ---------------------------------------------------------------------
# 1. Add state for teacher's today rotation duties
# ---------------------------------------------------------------------
anchor1 = '  const [rotationData, setRotationData] = useState<{ day_of_week: string; slots: any[] } | null>(null);'
new_state = anchor1 + '''
  const [teacherRotationDuties, setTeacherRotationDuties] = useState<any[]>([]);'''
if "teacherRotationDuties" not in content:
    content = content.replace(anchor1, new_state)
    changes.append("Added teacherRotationDuties state")
else:
    changes.append("teacherRotationDuties state already present, skipping")

# ---------------------------------------------------------------------
# 2. Fetch teacher's rotation duties inside fetchTeacherTimetable
# ---------------------------------------------------------------------
old_fetch = '''  // ── Auto-load teacher timetable ────────────────────────────────────────────
  const fetchTeacherTimetable = useCallback(async () => {
    if (!user?.id || !schoolId) { setLoading(false); return; }
    try {
      const { data } = await supabase
        .from("timetables")
        .select("*")
        .eq("school_id", schoolId)
        .eq("teacher_id", user.id)
        .eq("timetable_type", "teacher")
        .single();
      if (data) await loadAndParseFile(data.file_path, `My Timetable - ${profile?.full_name ?? "Teacher"}`);
    } catch (e: any) {
      console.warn("No teacher timetable found");
    } finally {
      setLoading(false);
    }
  }, [user, schoolId, profile]);'''

new_fetch = '''  // ── Auto-load teacher timetable ────────────────────────────────────────────
  const fetchTeacherTimetable = useCallback(async () => {
    if (!user?.id || !schoolId) { setLoading(false); return; }
    try {
      const { data } = await supabase
        .from("timetables")
        .select("*")
        .eq("school_id", schoolId)
        .eq("teacher_id", user.id)
        .eq("timetable_type", "teacher")
        .single();
      if (data) await loadAndParseFile(data.file_path, `My Timetable - ${profile?.full_name ?? "Teacher"}`);
    } catch (e: any) {
      console.warn("No teacher timetable found");
    } finally {
      setLoading(false);
    }
  }, [user, schoolId, profile]);

  // ── Fetch this teacher's rotation duties for today ─────────────────────────
  const fetchTeacherRotationDuties = useCallback(async () => {
    if (!user?.id || !schoolId) return;
    try {
      const { data, error } = await supabase.functions.invoke("get-teacher-rotation-schedule", {
        body: { school_id: schoolId, teacher_id: user.id },
      });
      if (error) { console.error("Failed to load teacher rotation duties", error); setTeacherRotationDuties([]); return; }
      setTeacherRotationDuties(data?.assignments ?? []);
    } catch (e) {
      console.error("Failed to load teacher rotation duties", e);
      setTeacherRotationDuties([]);
    }
  }, [user, schoolId]);

  useEffect(() => {
    if (!isPrincipal && !isHOD) {
      fetchTeacherRotationDuties();
    }
  }, [isPrincipal, isHOD, fetchTeacherRotationDuties]);'''

if "fetchTeacherRotationDuties" not in content:
    content = content.replace(old_fetch, new_fetch)
    changes.append("Added fetchTeacherRotationDuties + effect")
else:
    changes.append("fetchTeacherRotationDuties already present, skipping")

# ---------------------------------------------------------------------
# 3. Render a "Today's Rotation Duties" card in the teacher view,
#    shown above the existing timetable/empty-state block.
# ---------------------------------------------------------------------
old_render_block = '''        {viewingTimetable ? (
          <Card className="border-2 border-green-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-700">
                <User className="h-5 w-5" />{viewingLabel}
              </CardTitle>
              <CardDescription>Your assigned weekly timetable</CardDescription>
            </CardHeader>
            <CardContent>{renderTimetable()}</CardContent>
          </Card>
        ) : (
          <Card className="border-2 border-dashed border-slate-200">
            <CardContent className="py-16 text-center">
              <CalendarDays className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">No timetable assigned yet</p>
              <p className="text-slate-400 text-sm mt-1">Your principal hasn't assigned a timetable to you yet.</p>
            </CardContent>
          </Card>
        )}'''

new_render_block = '''        {teacherRotationDuties.length > 0 && (
          <Card className="border-2 border-indigo-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-indigo-700">
                <CalendarDays className="h-5 w-5" />Today's Rotation Duties
              </CardTitle>
              <CardDescription>Rotation-based classes you're teaching today, in addition to your regular timetable</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {teacherRotationDuties.map((duty, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3">
                    <div>
                      <span className="font-semibold text-indigo-800">Period {duty.period_number}</span>
                      <span className="text-slate-500 mx-2">·</span>
                      <span className="text-slate-700">Class {duty.class_grade} - Section {duty.section}</span>
                      {duty.group_name ? <span className="text-slate-400 text-sm ml-2">({duty.group_name})</span> : null}
                    </div>
                    <div className="text-sm text-indigo-700 font-medium">
                      {duty.block_name} {duty.subject && duty.subject !== duty.block_name ? `(${duty.subject})` : ""}
                      {duty.room ? <span className="text-slate-400 ml-2">· {duty.room}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {viewingTimetable ? (
          <Card className="border-2 border-green-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-700">
                <User className="h-5 w-5" />{viewingLabel}
              </CardTitle>
              <CardDescription>Your assigned weekly timetable</CardDescription>
            </CardHeader>
            <CardContent>{renderTimetable()}</CardContent>
          </Card>
        ) : teacherRotationDuties.length === 0 ? (
          <Card className="border-2 border-dashed border-slate-200">
            <CardContent className="py-16 text-center">
              <CalendarDays className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">No timetable assigned yet</p>
              <p className="text-slate-400 text-sm mt-1">Your principal hasn't assigned a timetable to you yet.</p>
            </CardContent>
          </Card>
        ) : null}'''

if old_render_block in content:
    content = content.replace(old_render_block, new_render_block)
    changes.append("Added Today's Rotation Duties card to teacher view")
elif "Today's Rotation Duties" in content:
    changes.append("Rotation duties card already present, skipping")
else:
    changes.append("WARNING: teacher render block anchor not found, check manually")

with open(path, "w") as f:
    f.write(content)

print("\n".join(changes))
