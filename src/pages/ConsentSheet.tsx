import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { loadConsentSheet } from "@/lib/consentSheet";
import { CONSENT_CATEGORIES, type ConsentStatus } from "@/lib/consentModel";
import {
  SHEET_STATUS_LABELS,
  buildSheetRows,
  filterByClass,
  sheetClasses,
  toCsv,
  type SheetRow,
} from "@/lib/consentSheetModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_BADGE: Record<ConsentStatus, string> = {
  granted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  denied: "bg-red-50 text-red-700 border-red-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function ConsentSheet() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id;

  const [rows, setRows] = useState<SheetRow[]>([]);
  const [className, setClassName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!schoolId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        const data = await loadConsentSheet(schoolId);
        if (!cancelled) setRows(buildSheetRows(data.children, data.links, data.parents, data.consents));
      } catch (error) {
        console.error("Failed to load consent sheet:", error);
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const classes = useMemo(() => sheetClasses(rows), [rows]);
  const visible = useMemo(() => filterByClass(rows, className), [rows, className]);

  const downloadCsv = () => {
    const blob = new Blob([toCsv(visible)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "consent-sheet.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Consent Sheet</h1>
              <p className="text-sm text-muted-foreground">
                What each parent has allowed for their child. Read-only, your school only.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              aria-label="Filter by class"
            >
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={downloadCsv} disabled={visible.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Parents and children</CardTitle>
            <CardDescription>
              {visible.length} {visible.length === 1 ? "row" : "rows"}. "No response" means the parent has not answered yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : loadFailed ? (
              <p className="py-8 text-sm text-red-600">Could not load the consent sheet. Please try again later.</p>
            ) : visible.length === 0 ? (
              <p className="py-8 text-sm text-muted-foreground">No parent-child links found for this school.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="px-2 py-2 font-medium">Parent</th>
                      <th className="px-2 py-2 font-medium">Child</th>
                      <th className="px-2 py-2 font-medium">Class</th>
                      {CONSENT_CATEGORIES.map((c) => (
                        <th key={c.key} className="px-2 py-2 font-medium">
                          {c.title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.key} className="border-b last:border-0">
                        <td className="px-2 py-2">{r.parentName}</td>
                        <td className="px-2 py-2">{r.childName}</td>
                        <td className="px-2 py-2">
                          {r.className}
                          {r.section ? ` - ${r.section}` : ""}
                        </td>
                        {CONSENT_CATEGORIES.map((c) => (
                          <td key={c.key} className="px-2 py-2">
                            <Badge variant="outline" className={STATUS_BADGE[r.statuses[c.key]]}>
                              {SHEET_STATUS_LABELS[r.statuses[c.key]]}
                            </Badge>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}