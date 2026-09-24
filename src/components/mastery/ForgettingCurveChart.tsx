import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot } from "recharts";
import { format, isPast } from "date-fns";
import type { RetentionCurve } from "@/hooks/useForgettingCurve";

function formatTick(iso: string) {
  try {
    return format(new Date(iso), "MMM d");
  } catch {
    return iso;
  }
}

// Ebbinghaus-style decay curve for one learning objective: today's position
// on the curve, projected forward to the next review date and beyond.
export function ForgettingCurveChart({ curve, height = 220 }: { curve: RetentionCurve | null; height?: number }) {
  if (!curve || curve.points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Not reviewed yet — the curve appears after the first review.
      </p>
    );
  }

  const now = new Date();
  const data = curve.points.map((p) => ({
    ...p,
    pct: Math.round(p.retention * 100),
    label: formatTick(p.date),
    isFuture: new Date(p.date) > now,
  }));

  // The point closest to "today" on the curve, to mark current retention.
  const todayPoint = data.reduce((closest, p) =>
    Math.abs(new Date(p.date).getTime() - now.getTime()) < Math.abs(new Date(closest.date).getTime() - now.getTime())
      ? p
      : closest,
  );

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="retentionFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="label" fontSize={11} tickMargin={6} />
          <YAxis domain={[0, 100]} fontSize={11} tickFormatter={(v) => `${v}%`} />
          <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="4 4" opacity={0.5} label={{ value: "50%", fontSize: 10, position: "insideTopLeft" }} />
          {!isPast(new Date(curve.due_at)) && (
            <ReferenceDot
              x={formatTick(curve.due_at)}
              y={90}
              r={4}
              fill="hsl(var(--primary))"
              stroke="none"
              label={{ value: "next review", fontSize: 10, position: "top" }}
            />
          )}
          <Tooltip
            formatter={(value: number, _name, item) => [
              `${value}% predicted retention`,
              item.payload.isFuture ? "Projected" : "Past",
            ]}
            labelFormatter={(label) => label}
          />
          <Area type="monotone" dataKey="pct" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#retentionFill)" />
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground text-center">
        Estimated half-life: ~{Math.round(curve.half_life_days)} day{Math.round(curve.half_life_days) === 1 ? "" : "s"} · today ~{Math.round(todayPoint.retention * 100)}% predicted retention
      </p>
    </div>
  );
}
