path = "supabase/functions/choose-elective/index.ts"
with open(path, "r") as f:
    content = f.read()

changes = []

old = '''        } else {
          console.warn(`Period ${elective.period_number} not found in timetable rows for grade ${profile.class_grade} section ${profile.section}`);
          return jsonResponse(
            { error: `Could not verify your timetable for period ${elective.period_number}. Please contact your admin.` },
            409
          );
        }'''

new = '''        } else {
          console.warn(`Period ${elective.period_number} not found in timetable rows for grade ${profile.class_grade} section ${profile.section}`);
          return jsonResponse(
            {
              error: `This elective is scheduled for period ${elective.period_number}, but your class's timetable doesn't have that period defined. This is a setup issue on the school's side — please ask your admin to check the timetable for Class ${profile.class_grade} ${profile.section} or the elective's period assignment.`,
            },
            409
          );
        }'''

if old in content:
    content = content.replace(old, new)
    changes.append("Clarified 'period not found' error message")
elif "setup issue on the school's side" in content:
    changes.append("Message already clarified, skipping")
else:
    changes.append("WARNING: anchor not found, check manually")

with open(path, "w") as f:
    f.write(content)

print("\n".join(changes))
