path = "src/App.tsx"
with open(path) as f:
    c = f.read()

old_import = 'const ReportCards = lazy(() => import("./pages/ReportCards"));'
assert old_import in c, "ReportCards import line not found"
new_import = old_import + '\nconst AlumniPage = lazy(() => import("./pages/AlumniPage"));'
c = c.replace(old_import, new_import)

old_route = '<Route path="/report-cards" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "teacher", "student", "parent"]}><ReportCards /></RoleGuard></ProtectedRoute>} />'
assert old_route in c, "report-cards route not found"
new_route = old_route + '\n                      <Route path="/alumni" element={<ProtectedRoute><RoleGuard allowedRoles={["school_admin"]}><AlumniPage /></RoleGuard></ProtectedRoute>} />'
c = c.replace(old_route, new_route)

with open(path, "w") as f:
    f.write(c)
print("Patched App.tsx")
