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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users2 className="h-4 w-4" /> Group Projects
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to={GROUP_PROJECTS_ROUTE}>
            View all <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No active group projects.</p>
        ) : (
          <div className="space-y-2">
            {totalPending > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-md px-2 py-1.5 mb-2">
                <ClipboardCheck className="h-4 w-4" />
                {totalPending} submission{totalPending === 1 ? '' : 's'} awaiting grading
              </div>
            )}
            {rows.map((r) => (
              <Link
                key={r.id}
                to={GROUP_PROJECTS_ROUTE}
                className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50 text-sm"
              >
                <div>
                  <p className="font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{r.class_name} · {r.group_count} groups</p>
                </div>
                <div className="flex items-center gap-2">
                  {r.pending_submissions > 0 && (
                    <Badge variant="destructive" className="text-[10px]">{r.pending_submissions} to grade</Badge>
                  )}
                  {r.due_date && (
                    <span className="text-xs text-muted-foreground">
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