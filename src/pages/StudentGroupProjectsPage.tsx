// src/pages/StudentGroupProjectsPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, Users2, ArrowRight, CalendarDays } from 'lucide-react';

interface GroupRow {
  groupId: string;
  groupName: string;
  projectTitle: string;
  projectStatus: string;
  dueDate: string | null;
  totalTasks: number;
  doneTasks: number;
}

export default function StudentGroupProjectsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Resolve this user's students.id (different from auth.uid()/profiles.id)
    const { data: studentRow, error: studentError } = await supabase
      .from('students')
      .select('id')
      .eq('profile_id', user.id)
      .single();

    if (studentError || !studentRow) {
      setLoading(false);
      return;
    }

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
      .eq('student_id', studentRow.id);

    if (!error && data) {
      const normalized: GroupRow[] = data
        .filter((row: any) => row.project_groups)
        .map((row: any) => {
          const tasks = row.project_groups?.project_group_tasks ?? [];
          return {
            groupId: row.project_groups.id,
            groupName: row.project_groups.name,
            projectTitle: row.project_groups.group_projects?.title ?? 'Untitled project',
            projectStatus: row.project_groups.group_projects?.status ?? 'active',
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

  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    closed: 'bg-amber-100 text-amber-800',
    archived: 'bg-slate-100 text-slate-600',
    draft: 'bg-muted text-muted-foreground',
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Group Projects</h1>
          <p className="text-sm text-muted-foreground">Groups you're part of, and their progress.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              You're not part of any group project yet. Your teacher will add you to a group.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const pct = r.totalTasks > 0 ? Math.round((r.doneTasks / r.totalTasks) * 100) : 0;
              return (
                <Card
                  key={r.groupId}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => navigate(`/student/group-projects/${r.groupId}`)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{r.projectTitle}</CardTitle>
                      <Badge className={statusColor[r.projectStatus]}>{r.projectStatus}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users2 className="h-3 w-3" /> {r.groupName}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Progress value={pct} className="h-1.5" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{r.doneTasks}/{r.totalTasks} tasks done</span>
                      {r.dueDate && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {new Date(r.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <span className="text-xs text-primary flex items-center gap-1">
                        Open <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}