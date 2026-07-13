import re

path = "src/pages/TimetablePage.tsx"
with open(path, "r") as f:
    content = f.read()

changes = []

# ---------------------------------------------------------------------
# 1. Add state: viewingClassInfo (tracks which class/section is shown)
#    and rotationData (holds the get-rotation-schedule response)
# ---------------------------------------------------------------------
anchor1 = 'const [viewingLabel, setViewingLabel] = useState("");'
new_state = anchor1 + '''
  const [viewingClassInfo, setViewingClassInfo] = useState<{ class_grade: string; section: string } | null>(null);
  const [rotationData, setRotationData] = useState<{ day_of_week: string; slots: any[] } | null>(null);'''
if "viewingClassInfo" not in content:
    content = content.replace(anchor1, new_state)
    changes.append("Added viewingClassInfo/rotationData state")
else:
    changes.append("State already present, skipping")

# ---------------------------------------------------------------------
# 2. Update loadAndParseFile signature + body to accept/track classInfo
# ---------------------------------------------------------------------
old_fn_sig = "const loadAndParseFile = async (filePath: string, label: string) => {"
new_fn_sig = "const loadAndParseFile = async (filePath: string, label: string, classInfo?: { class_grade: string; section: string }) => {"
if new_fn_sig not in content:
    content = content.replace(old_fn_sig, new_fn_sig)
    changes.append("Updated loadAndParseFile signature")
else:
    changes.append("Function signature already updated, skipping")

old_set_label = '''      setViewingTimetable({ headers: (json[0] ?? []).map(String), rows: json.slice(1).map(r => r.map(String)) });
      setViewingLabel(label);'''
new_set_label = '''      setViewingTimetable({ headers: (json[0] ?? []).map(String), rows: json.slice(1).map(r => r.map(String)) });
      setViewingLabel(label);
      setViewingClassInfo(classInfo ?? null);'''
if "setViewingClassInfo(classInfo" not in content:
    content = content.replace(old_set_label, new_set_label)
    changes.append("Set viewingClassInfo inside loadAndParseFile")
else:
    changes.append("viewingClassInfo already set inside function, skipping")

# ---------------------------------------------------------------------
# 3. Update class-timetable call sites to pass classInfo
#    (teacher-timetable call sites intentionally left untouched —
#     rotation groups are keyed by class/section, not by teacher)
# ---------------------------------------------------------------------
replacements = [
    (
        'await loadAndParseFile(data.file_path, `Class ${data.class_grade} - Section ${data.section}`);',
        'await loadAndParseFile(data.file_path, `Class ${data.class_grade} - Section ${data.section}`, { class_grade: data.class_grade, section: data.section });'
    ),
    (
        'onClick={() => loadAndParseFile(tt.file_path, `Class ${tt.class_grade} - Section ${tt.section}`)}>',
        'onClick={() => loadAndParseFile(tt.file_path, `Class ${tt.class_grade} - Section ${tt.section}`, { class_grade: tt.class_grade ?? "", section: tt.section ?? "" })}>'
    ),
    (
        'onClick={e => { e.stopPropagation(); loadAndParseFile(tt.file_path, `Class ${tt.class_grade} - Section ${tt.section}`); }}>',
        'onClick={e => { e.stopPropagation(); loadAndParseFile(tt.file_path, `Class ${tt.class_grade} - Section ${tt.section}`, { class_grade: tt.class_grade ?? "", section: tt.section ?? "" }); }}>'
    ),
]

for old, new in replacements:
    count = content.count(old)
    if count > 0 and "classInfo" not in old:
        content = content.replace(old, new)
        changes.append(f"Updated call site ({count}x)")
    elif count == 0:
        changes.append(f"WARNING: anchor not found, check manually: {old[:70]}...")
    else:
        changes.append("Call site already updated, skipping")

# ---------------------------------------------------------------------
# 4. Fetch rotation data whenever viewingClassInfo changes
# ---------------------------------------------------------------------
fetch_effect_anchor = "  // ── Upload class timetable ─────────────────────────────────────────────────"
fetch_effect = '''  // ── Fetch live rotation schedule overlay for the currently viewed class ────
  useEffect(() => {
    if (!viewingClassInfo || !schoolId) { setRotationData(null); return; }
    (async () => {
      const { data, error } = await supabase.functions.invoke("get-rotation-schedule", {
        body: { school_id: schoolId, class_grade: viewingClassInfo.class_grade, section: viewingClassInfo.section },
      });
      if (error) { console.error("Failed to load rotation schedule", error); setRotationData(null); return; }
      setRotationData({ day_of_week: data?.day_of_week ?? "", slots: data?.slots ?? [] });
    })();
  }, [viewingClassInfo, schoolId]);

''' + fetch_effect_anchor

if "Fetch live rotation schedule overlay" not in content:
    content = content.replace(fetch_effect_anchor, fetch_effect)
    changes.append("Added rotation-fetching useEffect")
else:
    changes.append("Rotation useEffect already present, skipping")

# ---------------------------------------------------------------------
# 5. Overlay rotation data onto matching cells in renderTimetable
#    Only overlays TODAY's column (see explanation above) to stay correct.
# ---------------------------------------------------------------------
old_render = '''          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                {row.map((cell, ci) => (
                  <td key={ci} className={`px-3 py-2.5 border-b border-slate-100 whitespace-nowrap
                    ${ci === 0 ? "font-semibold text-slate-700 bg-slate-50" : ""}
                    ${ci > 0 && cell && !cell.includes("BREAK") && !cell.includes("LUNCH") ? dayColors[(ci-1) % dayColors.length] + " font-medium" : ""}
                    ${cell.includes("BREAK") || cell.includes("LUNCH") ? "text-slate-400 italic text-center" : ""}
                  `}>
                    {cell || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>'''

new_render = '''          <tbody>
            {rows.map((row, ri) => {
              const periodMatch = row[0]?.match(/\\d+/);
              const periodNumber = periodMatch ? parseInt(periodMatch[0], 10) : null;
              const STANDARD_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
              return (
                <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  {row.map((cell, ci) => {
                    const dayForColumn = ci > 0 ? STANDARD_DAYS[ci - 1] : null;
                    const isTodayColumn = dayForColumn && rotationData && dayForColumn === rotationData.day_of_week;
                    const rotationSlot = isTodayColumn && periodNumber != null
                      ? rotationData!.slots.find((s: any) => s.period_number === periodNumber)
                      : null;
                    const rotationAssignments = rotationSlot?.assignments?.filter((a: any) => !a.skipped) ?? [];
                    const hasRotation = Boolean(isTodayColumn && rotationSlot && rotationAssignments.length > 0);
                    return (
                      <td key={ci} className={`px-3 py-2.5 border-b border-slate-100 whitespace-nowrap
                        ${ci === 0 ? "font-semibold text-slate-700 bg-slate-50" : ""}
                        ${ci > 0 && cell && !cell.includes("BREAK") && !cell.includes("LUNCH") && !hasRotation ? dayColors[(ci-1) % dayColors.length] + " font-medium" : ""}
                        ${cell.includes("BREAK") || cell.includes("LUNCH") ? "text-slate-400 italic text-center" : ""}
                        ${hasRotation ? "bg-indigo-50 text-indigo-800 font-medium border border-indigo-200 rounded" : ""}
                      `}>
                        {hasRotation ? (
                          <div className="flex flex-col gap-0.5">
                            {rotationAssignments.map((a: any) => (
                              <span key={a.group_id} className="text-xs">
                                {rotationAssignments.length > 1 ? `${a.group_name}: ` : ""}{a.block_name} ({a.subject})
                              </span>
                            ))}
                          </div>
                        ) : (cell || "—")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>'''

if "hasRotation" not in content:
    content = content.replace(old_render, new_render)
    changes.append("Overlaid rotation data onto renderTimetable grid")
else:
    changes.append("Render overlay already present, skipping")

with open(path, "w") as f:
    f.write(content)

print("\n".join(changes))
