path = "src/components/layout/AppSidebar.tsx"
with open(path) as f:
    c = f.read()

old = '{ title: "Student Transfers", icon: ArrowRightLeft, path: "/student-transfers", roles: ["admin", "principal", "school_admin"], module: "Student Transfers" },'
assert old in c, "Student Transfers navItem not found"

new = '{ title: "Student Transfers", icon: ArrowRightLeft, path: "/student-transfers", roles: ["school_admin"], module: "Student Transfers" },'
c = c.replace(old, new)

with open(path, "w") as f:
    f.write(c)
print("Patched navItem")
