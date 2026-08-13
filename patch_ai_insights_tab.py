path = "src/pages/TransportManagement.tsx"
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

# 2. TabsTrigger — add right after Analytics Dashboard's trigger
do(
    '''            <TabsTrigger value="analytics" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              Analytics Dashboard
            </TabsTrigger>''',
    '''            <TabsTrigger value="analytics" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              Analytics Dashboard
            </TabsTrigger>
            <TabsTrigger value="aiinsights" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              AI Insights
            </TabsTrigger>''',
    "TabsTrigger",
)

# 3. TabsContent — mirror AnalyticsDashboardTab's TabsContent block
old_content_anchor = '<AnalyticsDashboardTab schoolId={schoolId} />'
assert old_content_anchor in c, "AnalyticsDashboardTab TabsContent anchor not found"
idx = c.index(old_content_anchor)
open_tag_start = c.rfind("<TabsContent", 0, idx)
close_tag_idx = c.index("</TabsContent>", idx) + len("</TabsContent>")
analytics_block = c[open_tag_start:close_tag_idx]

aiinsights_block = analytics_block.replace(
    'value="analytics"', 'value="aiinsights"'
).replace(
    '<AnalyticsDashboardTab schoolId={schoolId} />', '<AiInsightsTab schoolId={schoolId} />'
)

c = c[:close_tag_idx] + "\n            " + aiinsights_block + c[close_tag_idx:]

with open(path, "w") as f:
    f.write(c)

print("Patched TransportManagement.tsx successfully.")
print("Added: import, 'AI Insights' TabsTrigger, and matching TabsContent.")
