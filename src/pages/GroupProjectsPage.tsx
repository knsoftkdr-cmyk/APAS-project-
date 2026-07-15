// src/pages/GroupProjectsPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Users, CalendarDays, ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import { CreateGroupProjectDialog } from '@/components/collaboration/CreateGroupProjectDialog';
import { EditGroupProjectDialog } from '@/components/collaboration/EditGroupProjectDialog';
import { GroupBuilder } from '@/components/collaboration/GroupBuilder';
import { useToast } from '@/hooks/use-toast';
import type { GroupProject } from '@/types/groupProjects';

export default function GroupProjectsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<GroupProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<GroupProject | null>(null);
  const [deletingProject, setDeletingProject] = useState<GroupProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadProjects = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // ASSUMPTION: classes(id, name). Adjust join if your class table
    // uses a different name/column for the display name.
    const { data, error } = await supabase
      .from('group_projects')
      .select('*, classes(name), project_groups(id)')
      .eq('teacher_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      const normalized: GroupProject[] = data.map((p: any) => ({
        ...p,
        class_name: p.classes?.name ?? '—',
        group_count: p.project_groups?.length ?? 0,
      }));
      setProjects(normalized);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleDelete = async () => {
    if (!deletingProject) return;
    setDeleting(true);
    const { error } = await supabase.from('group_projects').delete().eq('id', deletingProject.id);
    setDeleting(false);
    if (error) {
      toast({ title: 'Failed to delete project', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Project deleted' });
    setDeletingProject(null);
    if (expandedId === deletingProject.id) setExpandedId(null);
    loadProjects();
  };

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
          <p className="text-emerald-100 text-xs md:text-sm mt-0.5">Create projects, build groups, and track progress</p>
        </div>
      </div>
    </div>

    <div className="flex justify-end">
      <CreateGroupProjectDialog onCreated={(id) => { loadProjects(); setExpandedId(id); }} />
    </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-500" /> Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <Card className="border-2 border-dashed border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-white rounded-2xl">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4 shadow-md shadow-emerald-200">
              <Users className="h-7 w-7 text-white" />
            </div>
            <h3 className="text-base font-semibold text-slate-800 mb-1">No group projects yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Click "New Group Project" above to create your first one and start building teams.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => {
            const isExpanded = expandedId === project.id;
            const statusAccent =
              project.status === 'active' ? 'border-l-emerald-400' :
              project.status === 'closed' ? 'border-l-amber-400' :
              project.status === 'archived' ? 'border-l-slate-300' :
              'border-l-slate-200';
            return (
              <Card key={project.id} className={`overflow-hidden border-l-4 ${statusAccent} border-slate-200 shadow-sm hover:shadow-md transition-shadow`}>
                <CardHeader
                  className="cursor-pointer pb-4"
                  onClick={() => setExpandedId(isExpanded ? null : project.id)}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0 shadow-sm shadow-emerald-200 mt-0.5">
                        <Users className="h-4.5 w-4.5 text-white" />
                      </div>
                      <div className="space-y-2 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-base md:text-lg truncate">{project.title}</CardTitle>
                          <Badge className={`${statusColor[project.status]} hover:opacity-90 capitalize`}>{project.status}</Badge>
                          {project.subject && <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50/50">{project.subject}</Badge>}
                        </div>
                        {project.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs pt-1 flex-wrap">
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-50 text-slate-600 font-medium">
                            {project.class_name}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 font-medium">
                            <Users className="h-3 w-3" /> {project.group_count} group{project.group_count === 1 ? '' : 's'}
                          </span>
                          {project.due_date && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 font-medium">
                              <CalendarDays className="h-3 w-3" />
                              Due {new Date(project.due_date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="hover:bg-emerald-50 hover:text-emerald-700 rounded-full" onClick={(e) => { e.stopPropagation(); setEditingProject(project); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="hover:bg-red-50 rounded-full" onClick={(e) => { e.stopPropagation(); setDeletingProject(project); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                      <Button variant="ghost" size="icon" className={`rounded-full transition-all ${isExpanded ? "bg-emerald-100 text-emerald-700" : "hover:bg-emerald-50 hover:text-emerald-700"}`} onClick={() => setExpandedId(isExpanded ? null : project.id)}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="border-t border-emerald-100 bg-gradient-to-b from-emerald-50/40 to-transparent pt-5 pb-5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="rounded-xl bg-white border border-emerald-100/70 p-4 shadow-sm">
                      <GroupBuilder
                        groupProjectId={project.id}
                        classId={project.class_id}
                        maxGroupSize={project.max_group_size}
                      />
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <EditGroupProjectDialog
        project={editingProject}
        open={!!editingProject}
        onOpenChange={(open) => !open && setEditingProject(null)}
        onUpdated={loadProjects}
      />

      <AlertDialog open={!!deletingProject} onOpenChange={(open) => !open && setDeletingProject(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] sm:w-full">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="h-4 w-4 text-red-600" />
              </div>
              <span className="truncate">Delete "{deletingProject?.title}"?</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the project, all its groups, members, files, tasks, and submissions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
    </AppLayout>
  );
}