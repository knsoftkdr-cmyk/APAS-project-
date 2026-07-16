// src/components/collaboration/TeacherGroupProjectsSummary.tsx
// Compact summary card for the teacher dashboard. Shows active project count,
// groups needing grading, and quick links into the full Group Projects page.
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Users2, ArrowRight, ClipboardCheck } from 'lucide-react';

interface SummaryRow {
  id: string;
  title: string;
  class_name: string;
  group_count: number;
  pending_submissions: number;
  due_date: string | null;
}

// ADJUST this path to wherever GroupProjectsPage is actually routed.
const GROUP_PROJECTS_ROUTE = '/teacher/group-projects';

export function TeacherGroupProjectsSummary() {
  const { user } = useAuth();
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('group_projects')
      .select(`
        id, title, due_date,
        classes(name),
        project_groups(id),
        project_group_submissions(id, status)
      `)
      .eq('teacher_id', user.id)
      .eq('status', 'active')
      .order('due_date', { ascending: true })
      .limit(5);

    if (!error && data) {
      const normalized: SummaryRow[] = data.map((p: any) => ({
        id: p.id,
        title: p.title,
        class_name: p.classes?.name ?? '—',
        group_count: p.project_groups?.length ?? 0,
        pending_submissions: (p.project_group_submissions ?? []).filter((s: any) => s.status === 'submitted').length,
        due_date: p.due_date,
      }));
      setRows(normalized);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const totalPending = rows.reduce((sum, r) => sum + r.pending_submissions, 0);

  return (
    <Card className="group overflow-hidden border border-emerald-100 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="h-1 bg-gradient-to-r from-emerald-400 to-teal-400" />
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-sm shadow-emerald-200 transition-transform duration-300 group-hover:scale-110">
              <Users2 className="h-5 w-5 text-white" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Group Projects</h3>
          </div>
          <Link to={GROUP_PROJECTS_ROUTE} className="text-xs text-muted-foreground hover:text-emerald-600 font-medium inline-flex items-center gap-0.5 transition-colors">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
{loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
              <Users2 className="h-6 w-6 text-emerald-300" />
            </div>
            <p className="text-xs text-muted-foreground">No active group projects.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {totalPending > 0 && (
              <div className="flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-1">
                <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
                {totalPending} submission{totalPending === 1 ? '' : 's'} awaiting grading
              </div>
            )}
            {rows.map((r) => (
              <Link
                key={r.id}
                to={GROUP_PROJECTS_ROUTE}
                className="flex items-center justify-between gap-2 rounded-xl bg-white border border-emerald-100 shadow-sm px-4 py-3 hover:shadow-md hover:border-emerald-300 transition-all duration-300"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <Users2 className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{r.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-600 text-[10px] font-medium">
                        {r.class_name}
                      </span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-medium">
                        {r.group_count} group{r.group_count === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {r.pending_submissions > 0 && (
                    <Badge variant="destructive" className="text-[10px] rounded-full">{r.pending_submissions} to grade</Badge>
                  )}
                  {r.due_date && (
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {new Date(r.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}