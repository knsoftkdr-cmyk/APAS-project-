// src/components/collaboration/GroupBuilder.tsx
// Lets a teacher build groups for a group_project: view unassigned roster,
// create groups, add/remove members, or auto-split the whole class evenly.
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, X, Shuffle, UserPlus } from 'lucide-react';
import type { ProjectGroup, ClassRosterStudent } from '@/types/groupProjects';

interface GroupBuilderProps {
  groupProjectId: string;
  classId: string;
  maxGroupSize: number;
}

export function GroupBuilder({ groupProjectId, classId, maxGroupSize }: GroupBuilderProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [roster, setRoster] = useState<ClassRosterStudent[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);

    // 1. Full class roster. class_students.student_id references students(id)
    // (a separate table from profiles) — students has its own full_name column.
    const { data: rosterData, error: rosterError } = await supabase
      .from('class_students')
      .select('student_id, students(id, full_name)')
      .eq('class_id', classId);

    if (rosterError) {
      toast({ title: 'Could not load class roster', description: rosterError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const fullRoster: ClassRosterStudent[] = (rosterData ?? []).map((r: any) => ({
      student_id: r.student_id,
      full_name: r.students?.full_name ?? 'Unknown student',
    }));

    // 2. Existing groups + members for this project
    const { data: groupData, error: groupError } = await supabase
      .from('project_groups')
      .select('id, group_project_id, name, created_at, project_group_members(id, group_id, student_id, is_leader, joined_at)')
      .eq('group_project_id', groupProjectId)
      .order('created_at', { ascending: true });

    if (groupError) {
      toast({ title: 'Could not load groups', description: groupError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const nameById = new Map(fullRoster.map((s) => [s.student_id, s.full_name]));
    const normalizedGroups: ProjectGroup[] = (groupData ?? []).map((g: any) => ({
      id: g.id,
      group_project_id: g.group_project_id,
      name: g.name,
      created_at: g.created_at,
      members: (g.project_group_members ?? []).map((m: any) => ({
        ...m,
        student_name: nameById.get(m.student_id) ?? 'Unknown student',
      })),
    }));

    const assignedIds = new Set(normalizedGroups.flatMap((g) => (g.members ?? []).map((m) => m.student_id)));
    const unassigned = fullRoster.filter((s) => !assignedIds.has(s.student_id));

    setGroups(normalizedGroups);
    setRoster(unassigned);
    setLoading(false);
  }, [classId, groupProjectId, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    const { error } = await supabase
      .from('project_groups')
      .insert({ group_project_id: groupProjectId, name: newGroupName.trim() });

    if (error) {
      toast({ title: 'Could not create group', description: error.message, variant: 'destructive' });
      return;
    }
    setNewGroupName('');
    loadData();
  };

  const handleAddMember = async (groupId: string) => {
    const studentId = selectedStudent[groupId];
    if (!studentId) return;

    const group = groups.find((g) => g.id === groupId);
    if (group && (group.members?.length ?? 0) >= maxGroupSize) {
      toast({ title: 'Group is full', description: `Max group size is ${maxGroupSize}.`, variant: 'destructive' });
      return;
    }

    const { error } = await supabase
      .from('project_group_members')
      .insert({ group_id: groupId, student_id: studentId });

    if (error) {
      toast({ title: 'Could not add student', description: error.message, variant: 'destructive' });
      return;
    }
    setSelectedStudent((s) => ({ ...s, [groupId]: '' }));
    loadData();
  };

  const handleRemoveMember = async (memberId: string) => {
    const { error } = await supabase.from('project_group_members').delete().eq('id', memberId);
    if (error) {
      toast({ title: 'Could not remove student', description: error.message, variant: 'destructive' });
      return;
    }
    loadData();
  };

  const handleDeleteGroup = async (groupId: string) => {
    const { error } = await supabase.from('project_groups').delete().eq('id', groupId);
    if (error) {
      toast({ title: 'Could not delete group', description: error.message, variant: 'destructive' });
      return;
    }
    loadData();
  };

  const handleAutoSplit = async () => {
    // Splits the CURRENTLY UNASSIGNED roster evenly across existing groups,
    // or creates new groups of `maxGroupSize` if there are no groups yet.
    if (roster.length === 0) {
      toast({ title: 'No unassigned students left to split.' });
      return;
    }

    let targetGroups = groups;
    if (targetGroups.length === 0) {
      const numGroups = Math.ceil(roster.length / maxGroupSize);
      const inserts = Array.from({ length: numGroups }, (_, i) => ({
        group_project_id: groupProjectId,
        name: `Group ${i + 1}`,
      }));
      const { data: created, error } = await supabase.from('project_groups').insert(inserts).select('id');
      if (error) {
        toast({ title: 'Auto-split failed', description: error.message, variant: 'destructive' });
        return;
      }
      targetGroups = (created ?? []).map((g) => ({ id: g.id, group_project_id: groupProjectId, name: '', created_at: '' }));
    }

    const shuffled = [...roster].sort(() => Math.random() - 0.5);
    const memberInserts = shuffled.map((student, idx) => ({
      group_id: targetGroups[idx % targetGroups.length].id,
      student_id: student.student_id,
    }));

    const { error: memberError } = await supabase.from('project_group_members').insert(memberInserts);
    if (memberError) {
      toast({ title: 'Auto-split partially failed', description: memberError.message, variant: 'destructive' });
    } else {
      toast({ title: 'Groups auto-split successfully' });
    }
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-2">
          <Input
            placeholder="New group name (e.g. Group A)"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="w-56"
          />
          <Button onClick={handleCreateGroup} variant="secondary">
            <Plus className="mr-2 h-4 w-4" /> Add Group
          </Button>
        </div>
        <Button onClick={handleAutoSplit} variant="outline">
          <Shuffle className="mr-2 h-4 w-4" /> Auto-split remaining ({roster.length})
        </Button>
      </div>

      {roster.length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Unassigned students ({roster.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {roster.map((s) => (
              <Badge key={s.student_id} variant="secondary">{s.full_name}</Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => {
          const isFull = (group.members?.length ?? 0) >= maxGroupSize;
          return (
            <Card key={group.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">{group.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={isFull ? 'default' : 'outline'}>
                    {group.members?.length ?? 0}/{maxGroupSize}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeleteGroup(group.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  {(group.members ?? []).map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-sm rounded-md bg-muted/50 px-2 py-1">
                      <span>{m.student_name}{m.is_leader ? ' (Leader)' : ''}</span>
                      <button onClick={() => handleRemoveMember(m.id)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {(group.members?.length ?? 0) === 0 && (
                    <p className="text-xs text-muted-foreground italic">No members yet</p>
                  )}
                </div>

                {!isFull && roster.length > 0 && (
                  <div className="flex gap-2">
                    <Select
                      value={selectedStudent[group.id] ?? ''}
                      onValueChange={(v) => setSelectedStudent((s) => ({ ...s, [group.id]: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Add student..." />
                      </SelectTrigger>
                      <SelectContent>
                        {roster.map((s) => (
                          <SelectItem key={s.student_id} value={s.student_id}>{s.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="icon" className="h-8 w-8 shrink-0" onClick={() => handleAddMember(group.id)}>
                      <UserPlus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {groups.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">
          No groups yet. Add a group manually, or use "Auto-split remaining" to divide the whole class automatically.
        </p>
      )}
    </div>
  );
}