// src/components/collaboration/CreateGroupProjectDialog.tsx
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus } from 'lucide-react';
import type { GradingType } from '@/types/groupProjects';

interface ClassOption {
  id: string;
  name: string;
}

interface CreateGroupProjectDialogProps {
  onCreated?: (projectId: string) => void;
}

export function CreateGroupProjectDialog({ onCreated }: CreateGroupProjectDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    subject: '',
    classId: '',
    gradingType: 'both' as GradingType,
    maxGroupSize: 4,
    dueDate: '',
  });

  useEffect(() => {
    if (!open || !user) return;
    // Teachers are linked to classes via the class_teachers junction table
    // (classes has no teacher_id column of its own).
    const fetchClasses = async () => {
      const { data, error } = await supabase
        .from('class_teachers')
        .select('classes(id, name)')
        .eq('teacher_id', user.id);

      if (error) {
        toast({ title: 'Could not load classes', description: error.message, variant: 'destructive' });
        return;
      }
      const classList: ClassOption[] = (data ?? [])
        .map((row: any) => row.classes)
        .filter((c: any): c is ClassOption => !!c);
      setClasses(classList);
    };
    fetchClasses();
  }, [open, user, toast]);

  const resetForm = () => {
    setForm({
      title: '',
      description: '',
      subject: '',
      classId: '',
      gradingType: 'both',
      maxGroupSize: 4,
      dueDate: '',
    });
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!form.title.trim() || !form.classId) {
      toast({ title: 'Missing info', description: 'Title and class are required.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase
      .from('group_projects')
      .insert({
        class_id: form.classId,
        teacher_id: user.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        subject: form.subject.trim() || null,
        grading_type: form.gradingType,
        max_group_size: form.maxGroupSize,
        due_date: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        status: 'active',
      })
      .select('id')
      .single();

    setSubmitting(false);

    if (error) {
      toast({ title: 'Failed to create project', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Group project created', description: `"${form.title}" is ready. Now build your groups.` });
    resetForm();
    setOpen(false);
    if (data?.id && onCreated) onCreated(data.id);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Group Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Group Project</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="e.g. Renewable Energy Research"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="What should groups produce or investigate?"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="class">Class *</Label>
              <Select value={form.classId} onValueChange={(v) => setForm((f) => ({ ...f, classId: v }))}>
                <SelectTrigger id="class">
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                placeholder="e.g. Science"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="gradingType">Grading</Label>
              <Select
                value={form.gradingType}
                onValueChange={(v) => setForm((f) => ({ ...f, gradingType: v as GradingType }))}
              >
                <SelectTrigger id="gradingType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">Whole group grade</SelectItem>
                  <SelectItem value="individual">Individual grades</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxGroupSize">Max group size</Label>
              <Input
                id="maxGroupSize"
                type="number"
                min={2}
                max={10}
                value={form.maxGroupSize}
                onChange={(e) => setForm((f) => ({ ...f, maxGroupSize: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dueDate">Due date</Label>
            <Input
              id="dueDate"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}