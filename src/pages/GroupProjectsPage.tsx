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
    draft: 'bg-muted text-muted-foreground',
    active: 'bg-green-100 text-green-800',
    closed: 'bg-amber-100 text-amber-800',
    archived: 'bg-slate-100 text-slate-600',
  };

  return (
    <AppLayout>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Group Projects</h1>
          <p className="text-sm text-muted-foreground">Create projects, build groups, and track progress.</p>
        </div>
        <CreateGroupProjectDialog onCreated={(id) => { loadProjects(); setExpandedId(id); }} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            No group projects yet. Click "New Group Project" to create your first one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => {
            const isExpanded = expandedId === project.id;
            return (
              <Card key={project.id}>
                <CardHeader
                  className="cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : project.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-lg">{project.title}</CardTitle>
                        <Badge className={statusColor[project.status]}>{project.status}</Badge>
                        {project.subject && <Badge variant="outline">{project.subject}</Badge>}
                      </div>
                      {project.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                        <span>{project.class_name}</span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> {project.group_count} group{project.group_count === 1 ? '' : 's'}
                        </span>
                        {project.due_date && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            Due {new Date(project.due_date).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditingProject(project); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setDeletingProject(project); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setExpandedId(isExpanded ? null : project.id)}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="border-t pt-4">
                    <GroupBuilder
                      groupProjectId={project.id}
                      classId={project.class_id}
                      maxGroupSize={project.max_group_size}
                    />
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingProject?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the project, all its groups, members, files, tasks, and submissions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </AppLayout>
  );
}