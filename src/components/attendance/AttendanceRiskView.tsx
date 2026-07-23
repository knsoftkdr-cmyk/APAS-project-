import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

interface ClassRow { id: string; name: string; section: string; }

interface RiskRow {
  student_id: string;
  full_name: string;
  class: string;
  section: string;
  class_id: string;
  last_30_pct: number;
  prior_30_pct: number;
  overall_pct: number;
  current_streak: number;
  risk_level: 'high' | 'medium' | 'low';
  trend: 'improving' | 'worsening' | 'stable';
}

const RISK_STYLES: Record<string, { badge: string; label: string; dot: string }> = {
  high: { badge: 'bg-red-50 text-red-700 border border-red-200', label: 'High Risk', dot: 'bg-red-500' },
  medium: { badge: 'bg-amber-50 text-amber-700 border border-amber-200', label: 'Medium Risk', dot: 'bg-amber-500' },
  low: { badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200', label: 'Low Risk', dot: 'bg-emerald-500' },
};

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'improving') return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />;
  if (trend === 'worsening') return <TrendingDown className="h-3.5 w-3.5 text-red-600" />;
  return <Minus className="h-3.5 w-3.5 text-gray-400" />;
}

interface Props {
  schoolId: string | null;
  role: string | null;
  classes: ClassRow[];
}

export default function AttendanceRiskView({ schoolId, role, classes }: Props) {
  const [rows, setRows] = useState<RiskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [classFilter, setClassFilter] = useState<string>('all');

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      setLoading(true);
      const classIds = role === 'teacher' ? classes.map((c) => c.id) : null;
      const { data, error } = await supabase.rpc('calculate_attendance_risk', {
        p_school_id: schoolId,
        p_class_ids: classIds,
      });
      if (!error && data) {
        setRows(data as RiskRow[]);
      }
      setLoading(false);
    })();
  }, [schoolId, role, classes]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (role === 'admin' && classFilter !== 'all') {
      result = result.filter((r) => r.class_id === classFilter);
    }
    return [...result].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      if (order[a.risk_level] !== order[b.risk_level]) return order[a.risk_level] - order[b.risk_level];
      return a.last_30_pct - b.last_30_pct;
    });
  }, [rows, classFilter, role]);

  const counts = useMemo(() => ({
    high: rows.filter((r) => r.risk_level === 'high').length,
    medium: rows.filter((r) => r.risk_level === 'medium').length,
    low: rows.filter((r) => r.risk_level === 'low').length,
  }), [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="rounded-2xl border-2 border-red-200 bg-gradient-to-br from-red-50/60 via-white to-white">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-700">{counts.high}</div>
            <div className="text-xs text-red-600 font-medium">High Risk</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50/60 via-white to-white">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-amber-700">{counts.medium}</div>
            <div className="text-xs text-amber-600 font-medium">Medium Risk</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/60 via-white to-white">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-emerald-700">{counts.low}</div>
            <div className="text-xs text-emerald-600 font-medium">Low Risk</div>
          </CardContent>
        </Card>
      </div>

      {role === 'admin' && (
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-full md:w-64 bg-white border-emerald-100 rounded-xl">
            <SelectValue placeholder="Filter by class" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name} - {c.section}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {filteredRows.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No attendance data available yet for this view.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRows.map((r) => {
            const style = RISK_STYLES[r.risk_level];
            return (
              <div
                key={r.student_id}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-white border border-emerald-100 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${style.badge}`}>
                    {r.risk_level === 'high' ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <span className="text-sm font-bold">{r.full_name.charAt(0)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-slate-800 truncate">{r.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.class} - {r.section}
                      {r.current_streak > 0 && (
                        <span className="text-red-600 font-medium"> · {r.current_streak}d absence streak</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right hidden sm:block">
                    <div className="text-sm font-semibold text-slate-700">{r.last_30_pct}%</div>
                    <div className="text-[10px] text-muted-foreground">last 30 days</div>
                  </div>
                  <div className="flex items-center gap-1" title={`Trend: ${r.trend}`}>
                    <TrendIcon trend={r.trend} />
                  </div>
                  <span className={`text-xs font-medium px-3 py-1 rounded-full ${style.badge}`}>
                    {style.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
