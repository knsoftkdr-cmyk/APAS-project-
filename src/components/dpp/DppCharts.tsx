import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { weekdayLabel } from "@/lib/dpp";

/** Score per day (percent). Days with no practice show as gaps. */
export function WeekTrendChart({ data }: { data: { date: string; percent: number | null; attempts: number }[] }) {
  const rows = data.map((d) => ({ day: weekdayLabel(d.date), percent: d.percent }));
  if (!data.some((d) => d.percent != null)) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No practice this week yet.</p>;
  }
  return (
    <div className="h-52 w-full" role="img" aria-label="Daily practice score for the last 7 days">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="day" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
          <Tooltip formatter={(v: number) => [`${v}%`, "Score"]} />
          <Line type="monotone" dataKey="percent" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 4 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AccuracyBars({ data, nameKey, valueKey = "accuracy" }: { data: Record<string, unknown>[]; nameKey: string; valueKey?: string }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">Nothing to show yet.</p>;
  return (
    <div className="h-52 w-full" role="img" aria-label="Accuracy comparison">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey={nameKey} tick={{ fontSize: 12 }} interval={0} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
          <Tooltip formatter={(v: number) => [`${v}%`, "Accuracy"]} />
          <Bar dataKey={valueKey} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
