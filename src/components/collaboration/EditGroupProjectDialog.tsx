// src/components/collaboration/EditGroupProjectDialog.tsx
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Pencil } from 'lucide-react';
import type { GradingType, ProjectStatus, GroupProject } from '@/types/groupProjects';

interface EditGroupProjectDialogProps {
  project: GroupProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

export function EditGroupProjectDialog({ project, open, onOpenChange, onUpdated }: EditGroupProjectDialogProps) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    subject: '',
    status: 'active' as ProjectStatus,
    gradingType: 'both' as GradingType,
    maxGroupSize: 4,
    dueDate: '',
  });

  useEffect(() => {
    if (project) {
      setForm({
        title: project.title,
        description: project.description ?? '',
        subject: project.subject ?? '',
        status: project.status,
        gradingType: project.grading_type,
        maxGroupSize: project.max_group_size,
        dueDate: project.due_date ? project.due_date.slice(0, 10) : '',
      });
    }
  }, [project]);

  const handleSubmit = async () => {
    if (!project || !form.title.trim()) return;
    setSubmitting(true);

    const { error } = await supabase
      .from('group_projects')
      .update({
        title: form.title.trim(),
        description: form.description.trim() || null,
        subject: form.subject.trim() || null,
        status: form.status,
        grading_type: form.gradingType,
        max_group_size: form.maxGroupSize,
        due_date: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', project.id);

    setSubmitting(false);

    if (error) {
      toast({ title: 'Failed to update project', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Project updated' });
    onOpenChange(false);
    onUpdated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-4 shrink-0">
          <DialogHeader>
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <Pencil className="h-4 w-4 text-white" />
              </div>
              Edit Group Project
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-5 py-4 overflow-y-auto flex-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title" className="text-xs font-semibold text-slate-600">Title *</Label>
            <Input
              id="edit-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="border-slate-200 focus-visible:ring-emerald-400"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-description" className="text-xs font-semibold text-slate-600">Description</Label>
            <Textarea
              id="edit-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="border-slate-200 focus-visible:ring-emerald-400"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-subject" className="text-xs font-semibold text-slate-600">Subject</Label>
              <Input
                id="edit-subject"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                className="border-slate-200 focus-visible:ring-emerald-400"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-status" className="text-xs font-semibold text-slate-600">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as ProjectStatus }))}>
                <SelectTrigger id="edit-status" className="border-slate-200 focus:ring-emerald-400">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-grading" className="text-xs font-semibold text-slate-600">Grading</Label>
              <Select
                value={form.gradingType}
                onValueChange={(v) => setForm((f) => ({ ...f, gradingType: v as GradingType }))}
              >
                <SelectTrigger id="edit-grading" className="border-slate-200 focus:ring-emerald-400">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">Whole group grade</SelectItem>
                  <SelectItem value="individual">Individual grades</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-maxsize" className="text-xs font-semibold text-slate-600">Max group size</Label>
              <Input
                id="edit-maxsize"
                type="number"
                min={2}
                max={10}
                value={form.maxGroupSize}
                onChange={(e) => setForm((f) => ({ ...f, maxGroupSize: Number(e.target.value) }))}
                className="border-slate-200 focus-visible:ring-emerald-400"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-duedate" className="text-xs font-semibold text-slate-600">Due date</Label>
            <Input
              id="edit-duedate"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              className="border-slate-200 focus-visible:ring-emerald-400"
            />
          </div>
          </div>

          <DialogFooter className="px-5 py-4 border-t border-slate-100 shrink-0">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 sm:flex-none bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}