// Shared visuals for the Student Engagement Score: circular score, activity bars, trend graph, badges.
import { ArrowDownRight, ArrowUpRight, Minus, TrendingDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { ACTIVITY_META, ACTIVITY_ORDER, CATEGORY_META, type ActivityKey, type ActivityResult, type EngagementCategory, type EngagementScore } from "@/lib/engagement";

export function ScoreRing({ score, category, size = 132, label }: { score: number | null; category: EngagementCategory | null; size?: number; label?: string }) {
  const stroke = Math.max(8, Math.round(size / 12));
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.min(100, Math.max(0, score));
  const colour = category ? CATEGORY_META[category].ring : "#94a3b8";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={score === null ? "Not enough data" : `Engagement score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} style={{ transition: "stroke-dashoffset .8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
        {score === null ? (
          <span className="text-xs font-semibold text-slate-500 leading-tight">Not enough<br />data</span>
        ) : (
          <>
            <span className="font-bold text-blue-950 leading-none" style={{ fontSize: size / 3.2 }}>{Math.round(score)}</span>
            <span className="text-[10px] text-slate-500 mt-0.5">{label ?? "out of 100"}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function CategoryBadge({ category, className = "" }: { category: EngagementCategory | null; className?: string }) {
  if (!category) return <Badge variant="outline" className={`text-slate-500 ${className}`}>Not enough data</Badge>;
  const m = CATEGORY_META[category];
  return <Badge variant="outline" className={`${m.bg} ${m.text} font-semibold ${className}`}>{m.label}</Badge>;
}

export function DeltaBadge({ delta, trend, declining, className = "" }: { delta: number | null; trend: string; declining?: boolean; className?: string }) {
  if (delta === null || trend === "unknown") return <span className={`text-xs text-slate-400 ${className}`}>No earlier period to compare</span>;
  const Icon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const tone = trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-slate-500";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${tone} ${className}`}>
      <Icon className="h-3.5 w-3.5" />
      {delta > 0 ? "+" : ""}{delta} vs previous period
      {declining && <span className="ms-1 inline-flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700"><TrendingDown className="h-3 w-3" /> Declining</span>}
    </span>
  );
}

const barColour = (s: number) => (s >= 80 ? "bg-emerald-500" : s >= 60 ? "bg-blue-500" : s >= 40 ? "bg-amber-500" : "bg-red-500");

/** One bar per activity. Activities that never applied to the student are shown as "not assigned", not as zero. */
export function ActivityBars({ activities, compact = false }: { activities: Record<ActivityKey, ActivityResult>; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {ACTIVITY_ORDER.map((k) => {
        const a = activities[k];
        const meta = ACTIVITY_META[k];
        return (
          <div key={k}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-slate-700">{compact ? meta.short : meta.label}</span>
              {a?.available && a.score !== null
                ? <span className="tabular-nums text-slate-600"><b className="text-slate-900">{Math.round(a.score)}</b>/100 <span className="text-slate-400">· weight {a.effective_weight}%</span></span>
                : <span className="text-slate-400">Not assigned - not counted</span>}
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={a?.score ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={meta.label}>
              {a?.available && a.score !== null && <div className={`h-full rounded-full ${barColour(a.score)}`} style={{ width: `${Math.max(2, a.score)}%`, transition: "width .6s ease" }} />}
            </div>
            {!compact && a?.available && k !== "interaction" && (
              <p className="mt-0.5 text-[11px] text-slate-400">{a.credit} earned of {a.opportunities} {k === "video" ? "expected" : "due"}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TrendChart({ data, height = 160, ariaLabel = "Engagement trend" }: { data: { date: string; value: number | null }[]; height?: number; ariaLabel?: string }) {
  const pts = data.filter((d) => d.value !== null);
  if (pts.length < 2) return <p className="text-xs text-slate-400 py-6 text-center">The trend appears once there are scores from at least two days.</p>;
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v: number) => [Math.round(v * 10) / 10, "Score"]} labelFormatter={(l: string) => l} />
          <Line type="monotone" dataKey="value" stroke="#1e3a8a" strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 4, fill: "#f59e0b" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const periodText = (s: Pick<EngagementScore, "window_days">) => `last ${s.window_days} days`;

export function CategoryLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
      {(Object.keys(CATEGORY_META) as EngagementCategory[]).map((c) => (
        <span key={c} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_META[c].ring }} />{CATEGORY_META[c].label} ({CATEGORY_META[c].range})</span>
      ))}
    </div>
  );
}
