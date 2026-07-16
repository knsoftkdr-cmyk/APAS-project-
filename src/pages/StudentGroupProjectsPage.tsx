// src/pages/StudentGroupProjectsPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, Users, Users2, ArrowRight, CalendarDays } from 'lucide-react';

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
    draft: 'bg-slate-100 text-slate-600',
    active: 'bg-emerald-500 text-white',
    closed: 'bg-amber-500 text-white',
    archived: 'bg-slate-300 text-slate-700',
  };

  return (
    <AppLayout>
      <div className="min-h-screen relative overflow-x-hidden">
        <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-emerald-300 opacity-[0.12] blur-3xl" />
        <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-teal-300 opacity-[0.10] blur-3xl" />
        <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-emerald-200 opacity-[0.10] blur-3xl" />

        <div className="relative z-10 space-y-5 p-4 md:p-6 max-w-6xl mx-auto">
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <Users className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">Group Projects</h1>
                <p className="text-emerald-100 text-xs md:text-sm mt-0.5">Groups you're part of, and their progress</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-500" /> Loading projects...
            </div>
          ) : rows.length === 0 ? (
            <Card className="border-2 border-dashed border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-white rounded-2xl">
              <CardContent className="py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4 shadow-md shadow-emerald-200">
                  <Users className="h-7 w-7 text-white" />
                </div>
                <h3 className="text-base font-semibold text-slate-800 mb-1">No group projects yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  You're not part of any group project yet. Your teacher will add you to a group.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => {
                const pct = r.totalTasks > 0 ? Math.round((r.doneTasks / r.totalTasks) * 100) : 0;
                const statusAccent =
                  r.projectStatus === 'active' ? 'border-l-emerald-400' :
                  r.projectStatus === 'closed' ? 'border-l-amber-400' :
                  r.projectStatus === 'archived' ? 'border-l-slate-300' :
                  'border-l-slate-200';
                return (
                  <Card
                    key={r.groupId}
                    className={`overflow-hidden border-l-4 ${statusAccent} border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer`}
                    onClick={() => navigate(`/student/group-projects/${r.groupId}`)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0 shadow-sm shadow-emerald-200">
                          <Users className="h-4 w-4 text-white" />
                        </div>
                        <CardTitle className="text-base truncate flex-1">{r.projectTitle}</CardTitle>
                        <Badge className={`${statusColor[r.projectStatus]} hover:opacity-90 capitalize shrink-0`}>
                          {r.projectStatus}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 pl-11.5 mt-1">
                        <Users2 className="h-3 w-3" /> {r.groupName}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Progress value={pct} className="h-1.5" />
                      <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-50 text-slate-600 font-medium">
                          {r.doneTasks}/{r.totalTasks} tasks done
                        </span>
                        {r.dueDate && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 font-medium">
                            <CalendarDays className="h-3 w-3" />
                            {new Date(r.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="flex justify-end">
                        <span className="text-xs text-emerald-700 font-medium flex items-center gap-1">
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
      </div>
    </AppLayout>
  );
}