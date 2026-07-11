// src/components/collaboration/StudentGroupProjectsSummary.tsx
// Compact summary card for the student dashboard. Shows the groups the
// student belongs to, task progress, and upcoming due dates.
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, Users2, ArrowRight } from 'lucide-react';

interface SummaryRow {
  groupId: string;
  groupName: string;
  projectTitle: string;
  dueDate: string | null;
  totalTasks: number;
  doneTasks: number;
}

// ADJUST this path to wherever the student group workspace is routed.
const GROUP_WORKSPACE_ROUTE = (groupId: string) => `/student/group-projects/${groupId}`;

export function StudentGroupProjectsSummary() {
  const { user } = useAuth();
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Find groups this student belongs to, with parent project + task progress
    const { data, error } = await supabase
      .from('project_group_members')
      .select(`
        group_id,
        project_groups(
          id, name,
          group_projects(title, due_date, status),
          project_group_tasks(id, status)
        )
      `)
      .eq('student_id', user.id);

    if (!error && data) {
      const normalized: SummaryRow[] = data
        .filter((row: any) => row.project_groups?.group_projects?.status === 'active')
        .map((row: any) => {
          const tasks = row.project_groups?.project_group_tasks ?? [];
          return {
            groupId: row.project_groups.id,
            groupName: row.project_groups.name,
            projectTitle: row.project_groups.group_projects?.title ?? 'Untitled project',
            dueDate: row.project_groups.group_projects?.due_date ?? null,
            totalTasks: tasks.length,
            doneTasks: tasks.filter((t: any) => t.status === 'done').length,
          };
        });
      setRows(normalized);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users2 className="h-4 w-4" /> My Group Projects
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">You're not in any active group projects right now.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const pct = r.totalTasks > 0 ? Math.round((r.doneTasks / r.totalTasks) * 100) : 0;
              return (
                <div key={r.groupId} className="rounded-md border px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{r.projectTitle}</p>
                      <p className="text-xs text-muted-foreground">{r.groupName}</p>
                    </div>
                    {r.dueDate && (
                      <Badge variant="outline" className="text-[10px]">
                        Due {new Date(r.dueDate).toLocaleDateString()}
                      </Badge>
                    )}
                  </div>
                  <Progress value={pct} className="h-1.5" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {r.doneTasks}/{r.totalTasks} tasks done
                    </span>
                    <Button variant="ghost" size="sm" asChild className="h-6 px-2 text-xs">
                      <Link to={GROUP_WORKSPACE_ROUTE(r.groupId)}>
                        Open <ArrowRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}