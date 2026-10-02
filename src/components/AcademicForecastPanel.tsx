import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { AlertTriangle, Info, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fetchForecastOverview, type Forecast, type GroupForecast } from "@/lib/academicForecast";

function DirectionBadge({ f }: { f: Forecast }) {
  if (!f.ok || !f.direction) return <Badge variant="outline" className="text-muted-foreground">Not enough data</Badge>;
  const map = {
    improving: { cls: "bg-green-100 text-green-800 hover:bg-green-100", Icon: TrendingUp, text: "Improving" },
    declining: { cls: "bg-red-100 text-red-800 hover:bg-red-100", Icon: TrendingDown, text: "Declining" },
    stable: { cls: "bg-gray-100 text-gray-700 hover:bg-gray-100", Icon: Minus, text: "Stable" },
  }[f.direction];
  return <Badge className={`gap-1 ${map.cls}`}><map.Icon className="h-3 w-3" />{map.text}</Badge>;
}

function ForecastChart({ f }: { f: Forecast }) {
  const rows = [
    ...f.history.map((h) => ({ month: h.month, actual: h.pct })),
    ...f.projection.map((p, i) => ({
      month: p.month, forecast: p.pct, low: p.low, high: p.high,
      // join the dashed line to the last real point
      ...(i === 0 && f.history.length ? { actual: f.history[f.history.length - 1].pct } : {}),
    })),
  ];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Line type="monotone" dataKey="actual" name="Average score %" stroke="hsl(var(--primary))" strokeWidth={2} dot />
        <Line type="monotone" dataKey="forecast" name="Forecast %" stroke="hsl(var(--primary))" strokeDasharray="5 4" strokeWidth={2} dot />
        <Line type="monotone" dataKey="low" name="Low (80%)" stroke="#94a3b8" strokeDasharray="2 3" dot={false} />
        <Line type="monotone" dataKey="high" name="High (80%)" stroke="#94a3b8" strokeDasharray="2 3" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function GroupTable({ title, groups, selected, onSelect }: {
  title: string; groups: GroupForecast[]; selected: string | null; onSelect: (key: string) => void;
}) {
  if (!groups.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{title.replace("By ", "")}</TableHead><TableHead>Students</TableHead><TableHead>Trend</TableHead>
              <TableHead>Next month</TableHead><TableHead>Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => {
              const next = g.forecast.projection[0];
              return (
                <TableRow key={g.key} className={`cursor-pointer ${selected === g.key ? "bg-muted" : ""}`} onClick={() => onSelect(g.key)}>
                  <TableCell className="font-medium">{g.label}</TableCell>
                  <TableCell>{g.students}</TableCell>
                  <TableCell><DirectionBadge f={g.forecast} /></TableCell>
                  <TableCell className="tabular-nums">{next ? `${next.pct}% (${next.low}–${next.high})` : "—"}</TableCell>
                  <TableCell className="capitalize">{g.forecast.confidence ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function AcademicForecastPanel() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["academic-forecast"],
    queryFn: () => fetchForecastOverview(),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner /></div>;
  if (error || !data) {
    return (
      <Card><CardContent className="py-8 text-center space-y-3">
        <p className="text-destructive font-medium">Couldn't load the forecast.</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Unknown error"}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
      </CardContent></Card>
    );
  }

  const all = [{ key: "school", label: data.scope === "teacher" ? "My classes" : "Whole school", forecast: data.school }, ...data.subjects, ...data.classes];
  const shown = all.find((g) => g.key === (selected ?? "school")) ?? all[0];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Academic Forecast</h3>
          <p className="text-sm text-muted-foreground">
            A recency-weighted, damped trend of monthly test averages with an 80% range. It is a statistical projection, not a guarantee.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {data.signals.length > 0 && (
        <div className="space-y-2">
          {data.signals.map((s, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${s.severity === "warning" ? "border-yellow-200 bg-yellow-50 text-yellow-800" : "border-blue-100 bg-blue-50 text-blue-800"}`}>
              {s.severity === "warning" ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> : <Info className="h-4 w-4 mt-0.5 shrink-0" />}
              <span>{s.message}</span>
            </div>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">{shown.label} <DirectionBadge f={shown.forecast} /></CardTitle>
          <CardDescription>
            {shown.forecast.ok
              ? `${shown.forecast.tests} tests over ${shown.forecast.months_with_data} months · ${shown.forecast.slope_per_month} points/month · ${shown.forecast.confidence} confidence`
              : shown.forecast.reason}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shown.forecast.ok ? <ForecastChart f={shown.forecast} /> : (
            <p className="text-sm text-muted-foreground py-6 text-center">No forecast yet. It needs at least {String(data.assumptions.min_months)} months of test data.</p>
          )}
        </CardContent>
      </Card>

      <GroupTable title="By subject" groups={data.subjects} selected={selected} onSelect={setSelected} />
      <GroupTable title="By class" groups={data.classes} selected={selected} onSelect={setSelected} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Student watch-list</CardTitle>
          <CardDescription>Students projected below {String(data.assumptions.low_score_threshold)}% or falling by 10+ points on their next test.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {data.watchlist.length === 0 ? <p className="text-sm text-muted-foreground">No students flagged.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Subject</TableHead><TableHead>Recent avg</TableHead><TableHead>Projected</TableHead><TableHead>Why</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.watchlist.map((w) => (
                  <TableRow key={`${w.student_id}-${w.subject}`}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>{w.subject}</TableCell>
                    <TableCell className="tabular-nums">{w.recent_avg}%</TableCell>
                    <TableCell className="tabular-nums">{w.projected_pct}%</TableCell>
                    <TableCell>{w.reason === "low_projection" ? "Projected low" : `Falling (${w.change})`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
