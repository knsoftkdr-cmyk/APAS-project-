import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { format } from "date-fns";

export interface TrendPoint {
  responded_at: string;
  p_mastery: number;
  is_correct: boolean;
}

function formatTick(iso: string) {
  try {
    return format(new Date(iso), "MMM d");
  } catch {
    return iso;
  }
}

export function MasteryTrendChart({ points, height = 220 }: { points: TrendPoint[]; height?: number }) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No attempts recorded yet — the chart fills in as answers come in.</p>;
  }

  const data = points.map((p) => ({
    ...p,
    pct: Math.round(p.p_mastery * 100),
    label: formatTick(p.responded_at),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="label" fontSize={11} tickMargin={6} />
        <YAxis domain={[0, 100]} fontSize={11} tickFormatter={(v) => `${v}%`} />
        <ReferenceLine y={85} stroke="hsl(var(--emerald-500, 142 71% 45%))" strokeDasharray="4 4" opacity={0.4} />
        <Tooltip
          formatter={(value: number, _name, item) => [
            `${value}% mastery`,
            item.payload.is_correct ? "Correct answer" : "Incorrect answer",
          ]}
          labelFormatter={(label) => label}
        />
        <Line
          type="monotone"
          dataKey="pct"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={(props: { cx: number; cy: number; payload: { is_correct: boolean } }) => (
            <circle
              cx={props.cx} cy={props.cy} r={3.5}
              fill={props.payload.is_correct ? "#10b981" : "#f43f5e"}
              stroke="none"
            />
          )}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
