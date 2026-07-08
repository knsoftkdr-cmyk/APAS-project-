path = "src/pages/AlumniPage.tsx"
with open(path) as f:
    c = f.read()

old = '''                        {filteredStudents.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.full_name} {s.class ? `(Class ${s.class})` : ""}
                          </SelectItem>
                        ))}'''
assert old in c, "student SelectItem block not found"

new = '''                        {filteredStudents.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.full_name} {s.class ? `(${s.class})` : ""}
                          </SelectItem>
                        ))}'''
c = c.replace(old, new)

old_filter = '''  const filteredStudents = students.filter((s) =>
    (s.full_name ?? "").toLowerCase().includes(studentSearch.toLowerCase())
  );'''
assert old_filter in c, "filteredStudents filter not found"

new_filter = '''  const TERMINAL_CLASS_LABEL = "Class 10";
  const filteredStudents = students
    .filter((s) => (s.class ?? "").trim() === TERMINAL_CLASS_LABEL)
    .filter((s) => (s.full_name ?? "").toLowerCase().includes(studentSearch.toLowerCase()));'''
c = c.replace(old_filter, new_filter)

with open(path, "w") as f:
    f.write(c)
print("Patched AlumniPage.tsx")
