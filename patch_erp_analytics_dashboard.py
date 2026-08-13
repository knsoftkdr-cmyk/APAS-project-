path = "src/pages/ERPTransport.tsx"
with open(path, "r") as f:
    c = f.read()

def do(old, new, label):
    global c
    assert old in c, f"anchor not found: {label}"
    assert c.count(old) == 1, f"anchor not unique: {label}"
    c = c.replace(old, new, 1)

# 1. Import
old_import_anchor = 'import { SpeedMonitoringTab } from "@/components/transport/SpeedMonitoringTab";'
do(
    old_import_anchor,
    old_import_anchor + '\nimport AnalyticsDashboardTab from "@/components/transport/AnalyticsDashboardTab";',
    "import",
)

# 2. TabsTrigger — find the speedmonitoring trigger block and insert a sibling after it
idx = c.index('<TabsTrigger value="speedmonitoring"')
open_tag_end = c.index(">", idx) + 1
close_idx = c.index("</TabsTrigger>", idx) + len("</TabsTrigger>")
speedmonitoring_trigger = c[idx:close_idx]

analytics_trigger = speedmonitoring_trigger.replace(
    'value="speedmonitoring"', 'value="analytics"'
)
# Replace the visible label text between the tags
import re
analytics_trigger = re.sub(r">\s*[^<]*\s*</TabsTrigger>", ">\n              Analytics Dashboard\n            </TabsTrigger>", analytics_trigger)

c = c[:close_idx] + "\n            " + analytics_trigger + c[close_idx:]

# 3. TabsContent — mirror the speedmonitoring TabsContent block
content_anchor_idx = c.index('<SpeedMonitoringTab schoolId={schoolId} />')
open_tag_start = c.rfind("<TabsContent", 0, content_anchor_idx)
close_tag_idx = c.index("</TabsContent>", content_anchor_idx) + len("</TabsContent>")
speedmonitoring_block = c[open_tag_start:close_tag_idx]

analytics_block = speedmonitoring_block.replace(
    'value="speedmonitoring"', 'value="analytics"'
).replace(
    '<SpeedMonitoringTab schoolId={schoolId} />', '<AnalyticsDashboardTab schoolId={schoolId} />'
)

c = c[:close_tag_idx] + "\n        " + analytics_block + c[close_tag_idx:]

with open(path, "w") as f:
    f.write(c)

print("Patched ERPTransport.tsx successfully.")
print("Added: import, 'Analytics Dashboard' TabsTrigger, and matching TabsContent.")
