// src/pages/StudentGroupWorkspacePage.tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, ArrowLeft, Upload, FileText, Trash2, Plus,
  CalendarDays, Send, CheckCircle2, Users2, Users, Download,
} from 'lucide-react';
import type {
  ProjectGroupFile, ProjectGroupTask, ProjectGroupMember,
  ProjectGroupSubmission, ProjectGroupGrade, TaskStatus,
} from '@/types/groupProjects';

const STORAGE_BUCKET = 'group-project-files';

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

export default function StudentGroupWorkspacePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [members, setMembers] = useState<ProjectGroupMember[]>([]);
  const [files, setFiles] = useState<ProjectGroupFile[]>([]);
  const [tasks, setTasks] = useState<ProjectGroupTask[]>([]);
  const [submission, setSubmission] = useState<ProjectGroupSubmission | null>(null);
  const [grades, setGrades] = useState<ProjectGroupGrade[]>([]);
  const [groupProjectId, setGroupProjectId] = useState<string>('');
  const [myStudentId, setMyStudentId] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState<string>('group');
  const [submissionNote, setSubmissionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!groupId || !user) return;
    setLoading(true);

    const { data: studentRow } = await supabase
      .from('students')
      .select('id')
      .eq('profile_id', user.id)
      .single();
    setMyStudentId(studentRow?.id ?? null);

    const { data: group, error: groupError } = await supabase
      .from('project_groups')
      .select(`
        id, name, group_project_id,
        group_projects(title, description, due_date),
        project_group_members(id, group_id, student_id, is_leader, joined_at, students(full_name))
      `)
      .eq('id', groupId)
      .single();

    if (groupError || !group) {
      toast({ title: 'Could not load group', description: groupError?.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    setGroupName((group as any).name);
    setGroupProjectId((group as any).group_project_id);
    setProjectTitle((group as any).group_projects?.title ?? '');
    setProjectDescription((group as any).group_projects?.description ?? '');
    setDueDate((group as any).group_projects?.due_date ?? null);
    setMembers(
      ((group as any).project_group_members ?? []).map((m: any) => ({
        ...m,
        student_name: m.students?.full_name ?? 'Unknown student',
      }))
    );

    const [{ data: fileData }, { data: taskData }, { data: subData }] = await Promise.all([
      supabase.from('project_group_files').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
      supabase.from('project_group_tasks').select('*').eq('group_id', groupId).order('created_at', { ascending: true }),
      supabase.from('project_group_submissions').select('*').eq('group_id', groupId).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    setFiles(fileData ?? []);
    setTasks(taskData ?? []);
    setSubmission(subData ?? null);

    if (subData) {
      const { data: gradeData } = await supabase
        .from('project_group_grades')
        .select('*')
        .eq('submission_id', subData.id);
      setGrades(gradeData ?? []);
    } else {
      setGrades([]);
    }

    setLoading(false);
  }, [groupId, toast]);

  useEffect(() => { load(); }, [load]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !groupId || !user) return;
    setUploading(true);

    const path = `${groupId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file);
    if (uploadError) {
      toast({ title: 'Upload failed', description: uploadError.message, variant: 'destructive' });
      setUploading(false);
      return;
    }

    const { error: dbError } = await supabase.from('project_group_files').insert({
      group_id: groupId,
      uploaded_by: user.id,
      file_name: file.name,
      storage_path: path,
      file_type: file.type,
      file_size_bytes: file.size,
    });

    if (dbError) {
      toast({ title: 'Could not save file record', description: dbError.message, variant: 'destructive' });
    } else {
      toast({ title: 'File uploaded' });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    load();
  };

  const handleFileDownload = async (file: ProjectGroupFile) => {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(file.storage_path, 60);
    if (error || !data) {
      toast({ title: 'Could not open file', description: error?.message, variant: 'destructive' });
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const handleFileDelete = async (file: ProjectGroupFile) => {
    await supabase.storage.from(STORAGE_BUCKET).remove([file.storage_path]);
    const { error } = await supabase.from('project_group_files').delete().eq('id', file.id);
    if (error) {
      toast({ title: 'Could not delete file', description: error.message, variant: 'destructive' });
      return;
    }
    load();
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !groupId || !user) return;
    const { error } = await supabase.from('project_group_tasks').insert({
      group_id: groupId,
      title: newTaskTitle.trim(),
      assigned_to: newTaskAssignee === 'group' ? null : newTaskAssignee,
      created_by: user.id,
      status: 'todo',
    });
    if (error) {
      toast({ title: 'Could not add task', description: error.message, variant: 'destructive' });
      return;
    }
    setNewTaskTitle('');
    setNewTaskAssignee('group');
    load();
  };

  const handleTaskStatusChange = async (taskId: string, status: TaskStatus) => {
    const { error } = await supabase.from('project_group_tasks').update({ status }).eq('id', taskId);
    if (error) {
      toast({ title: 'Could not update task', description: error.message, variant: 'destructive' });
      return;
    }
    load();
  };

  const handleDeleteTask = async (taskId: string) => {
    const { error } = await supabase.from('project_group_tasks').delete().eq('id', taskId);
    if (error) {
      toast({ title: 'Could not delete task', description: error.message, variant: 'destructive' });
      return;
    }
    load();
  };

  const handleSubmit = async () => {
    if (!groupId || !user || !groupProjectId) return;
    setSubmitting(true);
    const { error } = await supabase.from('project_group_submissions').insert({
      group_id: groupId,
      group_project_id: groupProjectId,
      submitted_by: user.id,
      note: submissionNote.trim() || null,
      status: 'submitted',
    });
    setSubmitting(false);
    if (error) {
      toast({ title: 'Submission failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Project submitted to your teacher!' });
    setSubmissionNote('');
    load();
  };

  const nameById = new Map(members.map((m) => [m.student_id, m.student_name]));
  const groupGrade = grades.find((g) => g.student_id === null);
  const myGrade = grades.find((g) => g.student_id === myStudentId);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-500" /> Loading...
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-screen relative overflow-x-hidden">
        <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-emerald-300 opacity-[0.12] blur-3xl" />
        <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-teal-300 opacity-[0.10] blur-3xl" />
        <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-emerald-200 opacity-[0.10] blur-3xl" />

        <div className="relative z-10 space-y-5 p-4 md:p-6 max-w-6xl mx-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/student/group-projects')}
            className="gap-1 -ml-2 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Group Projects
          </Button>

          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <Users className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl md:text-2xl font-bold text-white truncate">{projectTitle}</h1>
                <p className="text-emerald-100 text-xs md:text-sm mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <Users2 className="h-3.5 w-3.5" /> {groupName}
                  {dueDate && (
                    <>
                      <span>·</span>
                      <CalendarDays className="h-3.5 w-3.5" /> Due {new Date(dueDate).toLocaleDateString()}
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>

          {projectDescription && (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="pt-4 text-sm text-muted-foreground">{projectDescription}</CardContent>
            </Card>
          )}

          {/* Members */}
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <Badge
                key={m.id}
                variant="outline"
                className="border-emerald-200 text-emerald-700 bg-emerald-50/50 font-medium"
              >
                {m.student_name}{m.is_leader ? ' (Leader)' : ''}
              </Badge>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Shared Files */}
            <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden border-l-4 border-l-emerald-400">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0 shadow-sm shadow-emerald-200">
                    <FileText className="h-4 w-4 text-white" />
                  </div>
                  <CardTitle className="text-base">Shared Files</CardTitle>
                </div>
                <div>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                  <Button
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
                  >
                    {uploading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                    Upload
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {files.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                      <FileText className="h-6 w-6 text-emerald-400" />
                    </div>
                    <p className="text-sm text-muted-foreground">No files shared yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {files.map((f) => (
                      <div key={f.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm bg-slate-50/50">
                        <button onClick={() => handleFileDownload(f)} className="flex items-center gap-2 hover:underline text-left min-w-0">
                          <FileText className="h-4 w-4 shrink-0 text-emerald-500" />
                          <span className="truncate">{f.file_name}</span>
                        </button>
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => handleFileDownload(f)} className="text-muted-foreground hover:text-emerald-700">
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          {f.uploaded_by === user?.id && (
                            <button onClick={() => handleFileDelete(f)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tasks */}
            <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden border-l-4 border-l-teal-400">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0 shadow-sm shadow-emerald-200">
                    <CheckCircle2 className="h-4 w-4 text-white" />
                  </div>
                  <CardTitle className="text-base">Tasks</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="New task..."
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Select value={newTaskAssignee} onValueChange={setNewTaskAssignee}>
                    <SelectTrigger className="h-8 w-32 text-xs shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="group">Whole group</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.student_id} value={m.student_id}>{m.student_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    className="h-8 w-8 shrink-0 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
                    onClick={handleAddTask}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {tasks.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center mx-auto mb-3">
                      <CheckCircle2 className="h-6 w-6 text-teal-400" />
                    </div>
                    <p className="text-sm text-muted-foreground">No tasks yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tasks.map((t) => (
                      <div key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm gap-2 bg-slate-50/50">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {t.assigned_to ? nameById.get(t.assigned_to) ?? 'Unknown' : 'Whole group'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Select value={t.status} onValueChange={(v) => handleTaskStatusChange(t.id, v as TaskStatus)}>
                            <SelectTrigger className="h-7 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(['todo', 'in_progress', 'done'] as TaskStatus[]).map((s) => (
                                <SelectItem key={s} value={s} className="text-xs">{TASK_STATUS_LABEL[s]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button onClick={() => handleDeleteTask(t.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Submission */}
          <Card className="border-slate-200 shadow-sm overflow-hidden border-l-4 border-l-emerald-400">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0 shadow-sm shadow-emerald-200">
                  <Send className="h-4 w-4 text-white" />
                </div>
                <CardTitle className="text-base">Group Submission</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {submission ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-100">
                    <CheckCircle2 className="h-4 w-4" />
                    Submitted on {new Date(submission.submitted_at).toLocaleString()}
                    {submission.status === 'graded' && (
                      <Badge className="ml-auto bg-emerald-500 text-white hover:opacity-90">Graded</Badge>
                    )}
                  </div>
                  {submission.note && <p className="text-sm text-muted-foreground">{submission.note}</p>}

                  {(groupGrade || myGrade) && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      {groupGrade && (
                        <div className="text-sm">
                          <span className="font-medium">Group grade: </span>
                          {groupGrade.score ?? '—'} / {groupGrade.max_score}
                          {groupGrade.feedback && <p className="text-xs text-muted-foreground mt-1">{groupGrade.feedback}</p>}
                        </div>
                      )}
                      {myGrade && (
                        <div className="text-sm">
                          <span className="font-medium">Your individual grade: </span>
                          {myGrade.score ?? '—'} / {myGrade.max_score}
                          {myGrade.feedback && <p className="text-xs text-muted-foreground mt-1">{myGrade.feedback}</p>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Upload your files above, then submit when your group's work is ready for grading.
                  </p>
                  <Textarea
                    placeholder="Add a note for your teacher (optional)"
                    value={submissionNote}
                    onChange={(e) => setSubmissionNote(e.target.value)}
                    rows={3}
                  />
                  <Button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Submit Project
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
