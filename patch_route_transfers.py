path = "src/App.tsx"
with open(path) as f:
    c = f.read()

old = '<Route path="/student-transfers" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin"]}><StudentTransfers /></RoleGuard></ProtectedRoute>} />'
assert old in c, "student-transfers route not found"

new = '<Route path="/student-transfers" element={<ProtectedRoute><RoleGuard allowedRoles={["school_admin"]}><StudentTransfers /></RoleGuard></ProtectedRoute>} />'
c = c.replace(old, new)

with open(path, "w") as f:
    f.write(c)
print("Patched route")
