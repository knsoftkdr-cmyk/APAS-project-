path = "src/App.tsx"
with open(path) as f:
    c = f.read()

old = '<Route path="/exam-seating" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin"]}><ExamSeating /></RouteGuard></ProtectedRoute>} />'
if old not in c:
    print("EXACT STRING NOT FOUND — paste sed -n '209p' src/App.tsx output instead")
else:
    new = old.replace("</RouteGuard>", "</RoleGuard>")
    c = c.replace(old, new)
    with open(path, "w") as f:
        f.write(c)
    print("Fixed RouteGuard -> RoleGuard typo")
