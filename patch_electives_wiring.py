import re

# ---------------------------------------------------------------------
# App.tsx: lazy imports + routes
# ---------------------------------------------------------------------
app_path = "src/App.tsx"
with open(app_path, "r") as f:
    app = f.read()

changes = []

# Lazy imports — anchor off the Worksheets lazy import line
lazy_anchor_match = re.search(r'const Worksheets = lazy\(\(\) => import\("\./pages/Worksheets"\)\);', app)
if lazy_anchor_match and "StudentElectives" not in app:
    new_imports = (
        lazy_anchor_match.group(0)
        + '\nconst StudentElectives = lazy(() => import("./pages/StudentElectives"));'
        + '\nconst TeacherElectives = lazy(() => import("./pages/TeacherElectives"));'
    )
    app = app.replace(lazy_anchor_match.group(0), new_imports)
    changes.append("Added lazy imports for StudentElectives and TeacherElectives")
else:
    changes.append("Lazy imports missing anchor or already present — check manually" if not lazy_anchor_match else "Lazy imports already present, skipping")

# Routes
worksheets_route = '<Route path="/worksheets" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><Worksheets /></RoleGuard></ProtectedRoute>} />'
new_student_route = '<Route path="/electives" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><StudentElectives /></RoleGuard></ProtectedRoute>} />'

entry_ticket_route = '<Route path="/entry-ticket" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><EntryTicket /></RoleGuard></ProtectedRoute>} />'
new_teacher_route = '<Route path="/teacher-electives" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><TeacherElectives /></RoleGuard></ProtectedRoute>} />'

if worksheets_route in app and "/electives\"" not in app:
    app = app.replace(worksheets_route, worksheets_route + "\n                      " + new_student_route)
    changes.append("Added /electives route")
else:
    changes.append("/electives route already present or anchor not found, skipping")

if entry_ticket_route in app and "/teacher-electives\"" not in app:
    app = app.replace(entry_ticket_route, entry_ticket_route + "\n                      " + new_teacher_route)
    changes.append("Added /teacher-electives route")
else:
    changes.append("/teacher-electives route already present or anchor not found, skipping")

with open(app_path, "w") as f:
    f.write(app)

# ---------------------------------------------------------------------
# AppSidebar.tsx: icon imports + nav entries
# ---------------------------------------------------------------------
sidebar_path = "src/components/layout/AppSidebar.tsx"
with open(sidebar_path, "r") as f:
    sidebar = f.read()

import_line_match = re.search(r'import\s*\{([^}]*)\}\s*from "lucide-react";', sidebar, re.DOTALL)
if import_line_match:
    icons = import_line_match.group(1)
    needed = [i for i in ["BookOpen", "Users2"] if i not in icons]
    if needed:
        new_icons = icons.rstrip().rstrip(",") + ", " + ", ".join(needed)
        sidebar = sidebar.replace(import_line_match.group(0), f'import {{{new_icons} }} from "lucide-react";')
        changes.append(f"Added missing icon imports: {needed}")
    else:
        changes.append("Needed icons already imported, skipping")
else:
    changes.append("Could not find lucide-react import block — check manually")

student_anchor = '{ title: "Worksheets", icon: FileText, path: "/worksheets", roles: ["student"], tourId: "nav-worksheets" },'
new_student_nav = '{ title: "Electives", icon: BookOpen, path: "/electives", roles: ["student"] },'
if student_anchor in sidebar and "/electives\"" not in sidebar:
    sidebar = sidebar.replace(student_anchor, student_anchor + "\n  " + new_student_nav)
    changes.append("Added student 'Electives' nav entry")
else:
    changes.append("Student nav entry already present or anchor not found, skipping")

teacher_anchor = '{ title: "Assessment Evaluation", icon: Sparkles, path: "/assessment-evaluation", roles: ["teacher"], module: "Lesson Plans" },'
new_teacher_nav = '{ title: "My Electives", icon: Users2, path: "/teacher-electives", roles: ["teacher"] },'
if teacher_anchor in sidebar and "/teacher-electives\"" not in sidebar:
    sidebar = sidebar.replace(teacher_anchor, teacher_anchor + "\n  " + new_teacher_nav)
    changes.append("Added teacher 'My Electives' nav entry")
else:
    changes.append("Teacher nav entry already present or anchor not found, skipping")

with open(sidebar_path, "w") as f:
    f.write(sidebar)

print("\n".join(changes))
