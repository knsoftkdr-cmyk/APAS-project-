app_path = "src/App.tsx"
with open(app_path, "r") as f:
    app = f.read()

changes = []

worksheets_route = '<Route path="/worksheets" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><Worksheets /></RoleGuard></ProtectedRoute>} />'
new_student_route = '<Route path="/electives" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><StudentElectives /></RoleGuard></ProtectedRoute>} />'

if 'path="/electives"' in app:
    changes.append("Student /electives route already exists, skipping")
elif worksheets_route in app:
    app = app.replace(worksheets_route, worksheets_route + "\n                      " + new_student_route)
    changes.append("Added /electives route")
else:
    changes.append("WARNING: Worksheets route anchor not found, could not add student route")

with open(app_path, "w") as f:
    f.write(app)

sidebar_path = "src/components/layout/AppSidebar.tsx"
with open(sidebar_path, "r") as f:
    sidebar = f.read()

student_anchor = '{ title: "Worksheets", icon: FileText, path: "/worksheets", roles: ["student"], tourId: "nav-worksheets" },'
new_student_nav = '{ title: "Electives", icon: BookOpen, path: "/electives", roles: ["student"] },'

if 'path: "/electives"' in sidebar:
    changes.append("Student nav entry already exists, skipping")
elif student_anchor in sidebar:
    sidebar = sidebar.replace(student_anchor, student_anchor + "\n  " + new_student_nav)
    changes.append("Added student 'Electives' nav entry")
else:
    changes.append("WARNING: Worksheets nav anchor not found, could not add student nav entry")

with open(sidebar_path, "w") as f:
    f.write(sidebar)

print("\n".join(changes))
