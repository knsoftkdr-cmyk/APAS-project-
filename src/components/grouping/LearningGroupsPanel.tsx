// src/components/grouping/LearningGroupsPanel.tsx
// Dynamic Student Grouping: remedial / regular / enrichment groups from live performance, with saved history.
// Data: get-class-mastery { mode: "dynamic_groups", op: preview | apply | current | override }.
import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Info, MoreVertical, Pin, PinOff, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  useApplyGroups, useGroupsPreview, useOverrideGroup, useSavedGroups,
  type GroupThresholds, type Tier, type TierPlacement,
} from "@/hooks/useLearningGroups";

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n * 100)}%`);

const TIERS: Array<{ tier: Tier; title: string; blurb: string; box: string; badge: string }> = [
  { tier: "remedial", title: "Remedial", blurb: "Needs re-teaching and guided practice", box: "border-rose-200 dark:border-rose-900", badge: "bg-rose-100 text-rose-700" },
  { tier: "regular", title: "Regular", blurb: "On the core programme", box: "border-sky-200 dark:border-sky-900", badge: "bg-sky-100 text-sky-700" },
  { tier: "enrichment", title: "Enrichment", blurb: "Ready for extension and depth", box: "border-emerald-200 dark:border-emerald-900", badge: "bg-emerald-100 text-emerald-700" },
];
const TIER_LABEL: Record<Tier, string> = { remedial: "Remedial", regular: "Regular", enrichment: "Enrichment" };

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function StudentRow({ p, onPin, onUnpin, busy }: {
  p: TierPlacement; busy: boolean;
  onPin: (tier: Tier) => void; onUnpin: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm truncate flex items-center gap-1.5">
          {p.full_name}
          {p.moved === "up" && <ArrowUp className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-label={`Moved up from ${p.previous_tier}`} />}
          {p.moved === "down" && <ArrowDown className="h-3.5 w-3.5 text-rose-600 shrink-0" aria-label={`Moved down from ${p.previous_tier}`} />}
          {p.pinned && <Pin className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Pinned by teacher" />}
        </p>
        <p className="text-[11px] text-muted-foreground truncate" title={p.reasons.join(" · ")}>
          {p.provisional ? "Not enough data yet" : p.reasons[0]}
        </p>
      </div>
      <span className="text-xs font-medium tabular-nums">{pct(p.composite)}</span>
      {p.risk === "high" && <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-200 px-1">risk</Badge>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={busy} aria-label={`Options for ${p.full_name}`}><MoreVertical className="h-3.5 w-3.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">Pin {p.full_name.split(" ")[0]} to…</DropdownMenuLabel>
          {(["remedial", "regular", "enrichment"] as Tier[]).filter((t) => t !== p.tier || !p.pinned).map((t) => (
            <DropdownMenuItem key={t} onClick={() => onPin(t)}><Pin className="h-3.5 w-3.5 mr-2" /> {TIER_LABEL[t]}</DropdownMenuItem>
          ))}
          {p.pinned && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={onUnpin}><PinOff className="h-3.5 w-3.5 mr-2" /> Unpin (follow performance)</DropdownMenuItem></>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function LearningGroupsPanel({ classId, bookId }: { classId: string; bookId?: number }) {
  const { toast } = useToast();
  const [remedial, setRemedial] = useState("45");
  const [enrichment, setEnrichment] = useState("80");
  const [thresholds, setThresholds] = useState<GroupThresholds | undefined>(undefined);

  const preview = useGroupsPreview(classId, bookId, thresholds);
  const saved = useSavedGroups(classId, bookId);
  const apply = useApplyGroups(classId, bookId);
  const override = useOverrideGroup(classId, bookId);

  const recalc = () => {
    const r = Number(remedial), e = Number(enrichment);
    if (!Number.isFinite(r) || !Number.isFinite(e) || r <= 0 || e > 100 || e - r <= 10) {
      toast({ title: "Check the thresholds", description: "Remedial must be below Enrichment with room for a Regular group between them.", variant: "destructive" });
      return;
    }
    setThresholds({ remedial_below: r / 100, enrichment_at_least: e / 100 });
  };

  const onSave = async () => {
    try {
      const res = await apply.mutateAsync(thresholds);
      toast({ title: "Groups saved", description: `${res.placements.length} students placed. ${res.changes.up.length} moved up, ${res.changes.down.length} moved down.` });
    } catch (e) {
      toast({ title: "Couldn't save groups", description: (e as Error).message, variant: "destructive" });
    }
  };
  const pin = async (studentId: string, tier: Tier | null) => {
    try {
      await override.mutateAsync({ studentId, tier });
      toast({ title: tier ? `Pinned to ${TIER_LABEL[tier]}` : "Unpinned" });
    } catch (e) {
      toast({ title: "Couldn't update", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (preview.isLoading) {
    return <Card><CardContent className="p-6 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-32 w-full" /></CardContent></Card>;
  }
  if (preview.error) {
    return (
      <Card className="border-rose-200"><CardContent className="p-6 text-sm space-y-3">
        <p className="flex items-center gap-2 text-rose-600"><AlertTriangle className="h-4 w-4" /> {(preview.error as Error).message}</p>
        <Button size="sm" variant="outline" onClick={() => preview.refetch()}>Try again</Button>
      </CardContent></Card>
    );
  }
  const data = preview.data;
  if (!data) return null;
  if (data.roster_size === 0) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">This class has no students yet.</CardContent></Card>;
  }

  const savedInfo = saved.data;
  const persistence = data.persistence_available;
  const changeCount = data.changes.up.length + data.changes.down.length;
  const recentMoves = savedInfo?.recent_moves.slice(0, 6) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-end gap-4 justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Groups from current performance</p>
            <p className="text-xs text-muted-foreground">
              {persistence
                ? savedInfo?.saved ? `Last saved ${timeAgo(savedInfo.computed_at)}.` : "Not saved yet."
                : "Saving is not available yet."}
              {persistence && savedInfo?.saved && (changeCount > 0
                ? ` Since then: ${data.changes.up.length} would move up, ${data.changes.down.length} down.`
                : " No one would move since then.")}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground block">Remedial below (%)</label>
              <Input value={remedial} onChange={(e) => setRemedial(e.target.value)} inputMode="numeric" className="h-8 w-24" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground block">Enrichment from (%)</label>
              <Input value={enrichment} onChange={(e) => setEnrichment(e.target.value)} inputMode="numeric" className="h-8 w-24" />
            </div>
            <Button size="sm" variant="outline" onClick={recalc} disabled={preview.isFetching}>Recalculate</Button>
            <Button size="sm" onClick={onSave} disabled={apply.isPending || !persistence}>
              <Save className="h-3.5 w-3.5 mr-1.5" /> {apply.isPending ? "Saving…" : "Save these groups"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.warnings.map((w, i) => (
        <p key={i} className="text-xs text-amber-700 flex items-center gap-1.5"><Info className="h-3.5 w-3.5 shrink-0" /> {w}</p>
      ))}

      <div className="grid gap-4 lg:grid-cols-3">
        {TIERS.map(({ tier, title, blurb, box, badge }) => {
          const summary = data.tiers.find((t) => t.tier === tier);
          const members = data.placements.filter((p) => p.tier === tier).sort((a, b) => (a.composite ?? 2) - (b.composite ?? 2));
          return (
            <Card key={tier} className={box}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">{title}</CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Badge className={badge}>{summary?.count ?? 0}</Badge>
                    <Badge variant="outline">avg {pct(summary?.avg_composite)}</Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{blurb}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {(summary?.focus_topics.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground mb-1">
                      {tier === "remedial" ? "Re-teach first" : tier === "enrichment" ? "Extend in" : "Watch"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {summary!.focus_topics.slice(0, 3).map((f) => (
                        <Badge key={f.topic_id} variant="secondary" className="font-normal text-[11px]" title={f.chapter_name}>
                          {f.topic_name} {pct(f.avg_score)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  {members.length === 0 && <p className="text-xs italic text-muted-foreground">No students in this group.</p>}
                  {members.map((p) => (
                    <StudentRow key={p.student_id} p={p} busy={override.isPending}
                      onPin={(t) => pin(p.student_id, t)} onUnpin={() => pin(p.student_id, null)} />
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {recentMoves.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent moves (last 30 days)</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {recentMoves.map((m, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{m.full_name}</span>{" "}
                {m.from_tier ? `${TIER_LABEL[m.from_tier]} → ${TIER_LABEL[m.to_tier]}` : `placed in ${TIER_LABEL[m.to_tier]}`}
                {m.source === "manual" && " (pinned by teacher)"} · {timeAgo(m.changed_at)}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground">
        Performance = 75% topic mastery + 25% learning pace (mastery gained per attempt). A student must clear a boundary by {Math.round(data.thresholds.hysteresis * 100)} points
        to change group, so groups don't flip week to week. High early-warning risk keeps a student out of Enrichment.
      </p>
    </div>
  );
}
