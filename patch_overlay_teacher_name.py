path = "src/pages/TimetablePage.tsx"
with open(path, "r") as f:
    content = f.read()

changes = []

old_span = '''                            {rotationAssignments.map((a: any) => (
                              <span key={a.group_id} className="text-xs">
                                {rotationAssignments.length > 1 ? `${a.group_name}: ` : ""}{a.block_name} ({a.subject})
                              </span>
                            ))}'''

new_span = '''                            {rotationAssignments.map((a: any) => (
                              <span key={a.group_id} className="text-xs">
                                {rotationAssignments.length > 1 ? `${a.group_name}: ` : ""}{a.block_name} ({a.subject}{a.teacher_name ? ` \u2013 ${a.teacher_name}` : ""})
                              </span>
                            ))}'''

if old_span in content:
    content = content.replace(old_span, new_span)
    changes.append("Added teacher_name display to rotation overlay cell")
elif "teacher_name" in content:
    changes.append("teacher_name already displayed, skipping")
else:
    changes.append("WARNING: overlay span anchor not found, check manually")

with open(path, "w") as f:
    f.write(content)

print("\n".join(changes))
