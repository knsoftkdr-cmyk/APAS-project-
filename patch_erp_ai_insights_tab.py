path = "src/pages/ERPTransport.tsx"
with open(path, "r") as f:
    c = f.read()

def do(old, new, label):
    global c
    assert old in c, f"anchor not found: {label}"
    assert c.count(old) == 1, f"anchor not unique: {label}"
    c = c.replace(old, new, 1)

# 1. Import
old_import_anchor = 'import AnalyticsDashboardTab from "@/components/transport/AnalyticsDashboardTab";'
do(
    old_import_anchor,
    old_import_anchor + '\nimport AiInsightsTab from "@/components/transport/AiInsightsTab";',
    "import",
)

# 2. TabsTrigger — find the analytics trigger block and insert a sibling after it
idx = c.index('<TabsTrigger value="analytics"')
close_idx = c.index("</TabsTrigger>", idx) + len("</TabsTrigger>")
analytics_trigger = c[idx:close_idx]

import re
aiinsights_trigger = analytics_trigger.replace('value="analytics"', 'value="aiinsights"')
aiinsights_trigger = re.sub(r">\s*[^<]*\s*</TabsTrigger>", ">\n              AI Insights\n            </TabsTrigger>", aiinsights_trigger)

c = c[:close_idx] + "\n            " + aiinsights_trigger + c[close_idx:]

# 3. TabsContent — mirror the analytics TabsContent block
content_anchor_idx = c.index('<AnalyticsDashboardTab schoolId={schoolId} />')
open_tag_start = c.rfind("<TabsContent", 0, content_anchor_idx)
close_tag_idx = c.index("</TabsContent>", content_anchor_idx) + len("</TabsContent>")
analytics_block = c[open_tag_start:close_tag_idx]

aiinsights_block = analytics_block.replace(
    'value="analytics"', 'value="aiinsights"'
).replace(
    '<AnalyticsDashboardTab schoolId={schoolId} />', '<AiInsightsTab schoolId={schoolId} />'
)

c = c[:close_tag_idx] + "\n        " + aiinsights_block + c[close_tag_idx:]

with open(path, "w") as f:
    f.write(c)

print("Patched ERPTransport.tsx successfully.")
print("Added: import, 'AI Insights' TabsTrigger, and matching TabsContent.")
