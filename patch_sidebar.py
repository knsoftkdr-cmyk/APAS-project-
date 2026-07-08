path = "src/components/layout/AppSidebar.tsx"
with open(path) as f:
    c = f.read()

old = '{ title: "Report Cards", icon: FileText, path: "/report-cards", roles: ["admin", "principal", "school_admin", "teacher", "student", "parent"], module: "Report Cards" },'
assert old in c, "Report Cards navItem not found"

new = old + '\n  { title: "Alumni", icon: Users, path: "/alumni", roles: ["school_admin"] },'
c = c.replace(old, new)

with open(path, "w") as f:
    f.write(c)
print("Patched AppSidebar.tsx")
