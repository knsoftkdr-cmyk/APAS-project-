// src/components/grouping/PeerGroupsPanel.tsx
// Peer Group Identification: students who share the same learning gaps (and strong students to extend),
// so a teacher can teach them together. Data: get-class-mastery { mode: "peer_groups" }.
import { AlertTriangle, Users, Sparkles, Lightbulb, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { usePeerGroups, type PeerGroup } from "@/hooks/useLearningGroups";

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n * 100)}%`);

const PACE_STYLE: Record<string, string> = {
  slow: "text-amber-700 border-amber-200", fast: "text-emerald-700 border-emerald-200",
};

function GroupCard({ group }: { group: PeerGroup }) {
  const isSupport = group.kind === "support";
  const paceEntries = Object.entries(group.pace_mix).filter(([k]) => k !== "insufficient_data");
  return (
    <Card className={isSupport ? "border-rose-200 dark:border-rose-900" : "border-emerald-200 dark:border-emerald-900"}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2 min-w-0">
            {isSupport ? <Users className="h-4 w-4 text-rose-600 shrink-0" /> : <Sparkles className="h-4 w-4 text-emerald-600 shrink-0" />}
            <span className="truncate">{group.label}</span>
          </CardTitle>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{group.size} students</Badge>
            <Badge variant="outline">avg {pct(group.avg_score)}</Badge>
            {isSupport && <Badge variant="outline" title="How alike the members' gaps are">{Math.round(group.cohesion * 100)}% alike</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {group.shared_needs.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">{isSupport ? "Shared gaps" : "Strongest topics (extend here)"}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.shared_needs.map((n) => (
                <Badge key={n.topic_id} variant="secondary" className="font-normal" title={n.chapter_name}>
                  {n.topic_name}
                  <span className="ml-1 text-muted-foreground">
                    {isSupport ? `${n.weak_count}/${n.member_count} weak · ${pct(n.avg_score)}` : pct(n.avg_score)}
                  </span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {group.shared_misconceptions.length > 0 && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 p-2.5 space-y-1.5">
            <p className="text-xs font-medium flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
              <Lightbulb className="h-3.5 w-3.5" /> Shared misconceptions
            </p>
            {group.shared_misconceptions.map((m, i) => (
              <div key={i} className="text-xs">
                <p><span className="font-medium">{m.misconception}</span> <span className="text-muted-foreground">({m.students_affected} students)</span></p>
                {m.correction_hint && <p className="text-muted-foreground">Try: {m.correction_hint}</p>}
              </div>
            ))}
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Members</p>
          <div className="flex flex-wrap gap-1.5">
            {group.members.map((m) => (
              <Badge key={m.student_id} variant="outline" className="font-normal gap-1">
                {m.full_name}
                <span className="text-muted-foreground">{pct(m.score)}</span>
                {m.pace && PACE_STYLE[m.pace] && <span className={`text-[10px] ${PACE_STYLE[m.pace]}`}>{m.pace}</span>}
                {m.risk === "high" && <span className="text-[10px] text-rose-600">at risk</span>}
              </Badge>
            ))}
          </div>
          {paceEntries.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Pace: {paceEntries.map(([k, v]) => `${v} ${k}`).join(" · ")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PeerGroupsPanel({ classId, bookId }: { classId: string; bookId?: number }) {
  const { data, isLoading, error, refetch, isFetching } = usePeerGroups(classId, bookId);

  if (isLoading) {
    return <Card><CardContent className="p-6 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-4 w-2/3" /></CardContent></Card>;
  }
  if (error) {
    return (
      <Card className="border-rose-200"><CardContent className="p-6 text-sm space-y-3">
        <p className="flex items-center gap-2 text-rose-600"><AlertTriangle className="h-4 w-4" /> {(error as Error).message}</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
      </CardContent></Card>
    );
  }
  if (!data) return null;

  const support = data.groups.filter((g) => g.kind === "support");
  const extension = data.groups.filter((g) => g.kind === "extension");

  if (data.roster_size === 0) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">This class has no students yet.</CardContent></Card>;
  }
  if (data.assessed_count === 0) {
    return (
      <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
        No student has enough assessed objectives yet, so there is nothing to group on. Groups appear once students have attempted a few questions.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {support.length} support group{support.length === 1 ? "" : "s"}, {extension.length} extension group{extension.length === 1 ? "" : "s"}
          {" "}from {data.assessed_count} of {data.roster_size} students with enough data.
        </p>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Refreshing…" : "Refresh"}</Button>
      </div>

      {data.warnings.map((w, i) => (
        <p key={i} className="text-xs text-amber-700 flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> {w}</p>
      ))}

      {support.length === 0 && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          No two students share enough of the same gaps to form a support group. Individual needs are listed below.
        </CardContent></Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {[...support, ...extension].map((g) => <GroupCard key={g.id} group={g} />)}
      </div>

      {data.individual.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Individual needs — no close peers ({data.individual.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {data.individual.map((s) => (
              <div key={s.student_id} className="text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{s.full_name}</span>
                <span className="text-xs text-muted-foreground">{pct(s.score)}</span>
                <span className="text-xs text-muted-foreground">weak in {s.weak_topics.slice(0, 3).map((t) => t.topic_name).join(", ")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(data.on_track.length > 0 || data.unassessed.length > 0) && (
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            {data.on_track.length > 0 && (
              <p><span className="font-medium">On track, no gaps ({data.on_track.length}):</span>{" "}
                <span className="text-muted-foreground">{data.on_track.map((s) => s.full_name).join(", ")}</span></p>
            )}
            {data.unassessed.length > 0 && (
              <p><span className="font-medium">Not enough data yet ({data.unassessed.length}):</span>{" "}
                <span className="text-muted-foreground">{data.unassessed.map((s) => s.full_name).join(", ")}</span></p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
