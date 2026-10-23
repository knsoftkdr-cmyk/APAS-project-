import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { getMyChildren, type ChildOption } from "@/lib/appointments";
import { loadConsentHistory, loadConsents, saveConsent } from "@/lib/consentCenter";
import {
  CONSENT_CATEGORIES,
  STATUS_LABELS,
  applyDecision,
  describeChange,
  historyForChild,
  statusFor,
  summariseChild,
  type ConsentCategory,
  type ConsentHistoryEntry,
  type ConsentRecord,
  type ConsentStatus,
} from "@/lib/consentModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_BADGE: Record<ConsentStatus, string> = {
  granted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  denied: "bg-red-50 text-red-700 border-red-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function ConsentCenter() {
  const { profile } = useAuth();
  const parentId = profile?.id;

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [history, setHistory] = useState<ConsentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // "<studentId>:<category>" while a save is running

  const load = useCallback(async () => {
    if (!parentId) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const kids = await getMyChildren(parentId);
      const ids = kids.map((k) => k.studentId);
      const [consents, changes] = await Promise.all([loadConsents(ids), loadConsentHistory(ids)]);
      setChildren(kids);
      setSelectedId((current) => (kids.some((k) => k.studentId === current) ? current : kids[0]?.studentId ?? ""));
      setRecords(consents);
      setHistory(changes);
    } catch (error) {
      console.error("Failed to load consent center:", error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = children.find((c) => c.studentId === selectedId);
  const summary = useMemo(() => (selected ? summariseChild(records, selected.studentId) : null), [records, selected]);
  const changes = useMemo(
    () => (selected ? historyForChild(history, selected.studentId).slice(0, 10) : []),
    [history, selected],
  );

  const decide = async (category: ConsentCategory, status: "granted" | "denied") => {
    if (!parentId || !selected) return;
    const key = `${selected.studentId}:${category}`;
    setSaving(key);
    try {
      await saveConsent(parentId, selected.studentId, category, status);
      setRecords((current) => applyDecision(current, selected.studentId, category, status, new Date().toISOString()));
      toast.success(status === "granted" ? "Permission allowed" : "Permission not allowed");
      loadConsentHistory(children.map((c) => c.studentId)).then(setHistory).catch(() => undefined);
    } catch (error) {
      console.error("Failed to save consent:", error);
      toast.error("Couldn't save your choice. Please try again.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
            Consent center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose what the school can do for each of your children. You can change your answer at any time.
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your children's permissions
          </div>
        )}

        {!loading && loadFailed && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-sm">We couldn't load your permissions. Check your connection and try again.</p>
              <Button variant="outline" onClick={load}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {!loading && !loadFailed && children.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No children are linked to your account yet. Ask the school office to link your child, then come back here.
            </CardContent>
          </Card>
        )}

        {!loading && !loadFailed && selected && summary && (
          <>
            {children.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a child">
                {children.map((child) => (
                  <Button
                    key={child.studentId}
                    variant={child.studentId === selectedId ? "default" : "outline"}
                    size="sm"
                    aria-pressed={child.studentId === selectedId}
                    onClick={() => setSelectedId(child.studentId)}
                  >
                    {child.fullName}
                  </Button>
                ))}
              </div>
            )}

            <p className="text-sm text-muted-foreground" aria-live="polite">
              {selected.fullName}
              {selected.className ? `, class ${selected.className}` : ""}: {summary.granted} allowed,{" "}
              {summary.denied} not allowed, {summary.pending} waiting for your answer.
            </p>

            <div className="space-y-3">
              {CONSENT_CATEGORIES.map((category) => {
                const status = statusFor(records, selected.studentId, category.key);
                const busy = saving === `${selected.studentId}:${category.key}`;
                return (
                  <Card key={category.key}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base">{category.title}</CardTitle>
                        <Badge variant="outline" className={STATUS_BADGE[status]}>{STATUS_LABELS[status]}</Badge>
                      </div>
                      <CardDescription>{category.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={status === "granted" ? "default" : "outline"}
                        disabled={busy}
                        aria-label={`Allow ${category.title} for ${selected.fullName}`}
                        onClick={() => decide(category.key, "granted")}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                        Allow
                      </Button>
                      <Button
                        size="sm"
                        variant={status === "denied" ? "destructive" : "outline"}
                        disabled={busy}
                        aria-label={`Don't allow ${category.title} for ${selected.fullName}`}
                        onClick={() => decide(category.key, "denied")}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        Don't allow
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Recent changes</CardTitle>
                <CardDescription>Your last 10 changes for {selected.fullName}.</CardDescription>
              </CardHeader>
              <CardContent>
                {changes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No changes yet. Your answers will appear here.</p>
                ) : (
                  <ul className="divide-y">
                    {changes.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span>{describeChange(entry)}</span>
                        <span className="text-muted-foreground whitespace-nowrap">{formatDate(entry.changed_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
