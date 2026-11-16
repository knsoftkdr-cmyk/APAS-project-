import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { Course, LearningPathMode } from "@/types/courseManagement";
import type { SemesterRef, SessionRef } from "@/lib/courseStructure";
import { sb } from "@/hooks/useCourseStructure";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";

const NONE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course?: Course | null;              // edit when set
  sessions: SessionRef[];
  semesters: SemesterRef[];
  /** admins may assign the teacher in charge of a subject */
  canAssignTeacher: boolean;
  defaultSessionId?: string | null;
  defaultSemesterId?: string | null;
  saving?: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}

/** Create / edit a subject (a `courses` row) and place it in an academic session + semester. */
export function SubjectDialog({ open, onOpenChange, course, sessions, semesters, canAssignTeacher, defaultSessionId, defaultSemesterId, saving, onSubmit }: Props) {
  const { profile } = useAuth();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [classLevel, setClassLevel] = useState("");
  const [description, setDescription] = useState("");
  const [sessionId, setSessionId] = useState(NONE);
  const [semesterId, setSemesterId] = useState(NONE);
  const [mentorId, setMentorId] = useState(NONE);
  const [mode, setMode] = useState<LearningPathMode>("flexible");

  useEffect(() => {
    if (!open) return;
    setTitle(course?.title ?? ""); setSubject(course?.subject ?? ""); setClassLevel(course?.class_level ?? "");
    setDescription(course?.description ?? "");
    setSessionId(course?.academic_year_id ?? defaultSessionId ?? NONE);
    setSemesterId(course?.semester_id ?? defaultSemesterId ?? NONE);
    setMentorId(course?.mentor_id ?? NONE);
    setMode(course?.learning_path_mode ?? "flexible");
  }, [open, course, defaultSessionId, defaultSemesterId]);

  const teachers = useQuery({
    queryKey: ["cs-teachers", profile?.school_id],
    enabled: open && canAssignTeacher && !!profile?.school_id,
    queryFn: async () => {
      const { data } = await sb.from("profiles").select("id, full_name").eq("school_id", profile!.school_id).eq("role", "teacher").order("full_name");
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });

  const visibleSemesters = semesters.filter((s) => sessionId !== NONE && s.academic_year_id === sessionId);
  const valid = title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              title: title.trim(),
              subject: subject.trim() || title.trim(),
              class_level: classLevel.trim() || null,
              description: description.trim() || null,
              academic_year_id: sessionId === NONE ? null : sessionId,
              semester_id: semesterId === NONE || sessionId === NONE ? null : semesterId,
              learning_path_mode: mode,
              ...(canAssignTeacher ? { mentor_id: mentorId === NONE ? null : mentorId } : {}),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{course ? "Edit subject" : "Add subject"}</DialogTitle>
            <DialogDescription>A subject holds the modules, chapters and topics students learn from.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sub-title">Subject name</Label>
              <Input id="sub-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mathematics" autoFocus maxLength={160} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-class">Class / grade</Label>
              <Input id="sub-class" value={classLevel} onChange={(e) => setClassLevel(e.target.value)} placeholder="e.g. 8" maxLength={40} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-code">Subject area <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="sub-code" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Defaults to the name" maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label>Academic session</Label>
              <Select value={sessionId} onValueChange={(v) => { setSessionId(v); setSemesterId(NONE); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not assigned</SelectItem>
                  {sessions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.is_active ? " (active)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Semester</Label>
              <Select value={semesterId} onValueChange={setSemesterId} disabled={sessionId === NONE}>
                <SelectTrigger><SelectValue placeholder={sessionId === NONE ? "Pick a session first" : "Not assigned"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not assigned</SelectItem>
                  {visibleSemesters.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {canAssignTeacher && (
              <div className="space-y-2">
                <Label>Teacher in charge</Label>
                <Select value={mentorId} onValueChange={setMentorId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {(teachers.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.full_name ?? "Teacher"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={`space-y-2 ${canAssignTeacher ? "" : "sm:col-span-1"}`}>
              <Label>Learning path</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as LearningPathMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flexible">Flexible – any order (prerequisites still apply)</SelectItem>
                  <SelectItem value="sequential">Sequential – one topic after another</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sub-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea id="sub-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1500} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {course ? "Save changes" : "Create subject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
