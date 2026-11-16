import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart3, CalendarRange, ChevronDown, ChevronRight, Eye, EyeOff, GraduationCap, Layers, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2, Archive,
} from "lucide-react";
import type { Course, ContentStatus } from "@/types/courseManagement";
import { groupCourses, friendlyCourseError, STATUS_LABEL } from "@/lib/courseStructure";
import { ADMIN_ROLES, useStaffSubjects, useStructureMutations, useSubjectMutations } from "@/hooks/useCourseStructure";
import { SubjectTree, StatusBadge } from "@/components/course-structure/SubjectTree";
import { SubjectDialog } from "@/components/course-structure/SubjectDialog";
import { SubjectStatsDialog } from "@/components/course-structure/SubjectStatsDialog";

function SubjectCard({ course, canEdit, canDelete, filter, sessionName, semesterName, onEdit, onStats }: {
  course: Course; canEdit: boolean; canDelete: boolean; filter: { search: string; status: ContentStatus | "all" };
  sessionName?: string; semesterName?: string; onEdit: () => void; onStats: () => void;
}) {
  const [open, setOpen] = useState(false);
  const subj = useSubjectMutations();
  const upd = useStructureMutations(course.id);
  const setStatus = (status: ContentStatus) =>
    upd.updateSubject.mutate({ id: course.id, values: { status } }, { onError: (e) => toast.error(e.message), onSuccess: () => toast.success(status === "published" ? "Subject published – students can now see its published content" : `Subject ${STATUS_LABEL[status].toLowerCase()}`) });
  const remove = () => {
    if (!confirm(`Delete the subject "${course.title}" with all its modules, chapters, topics, materials and student progress? This cannot be undone.`)) return;
    subj.remove.mutate(course.id, { onError: (e) => toast.error(friendlyCourseError(e.message)), onSuccess: () => toast.success("Subject deleted") });
  };
  const status = course.status as ContentStatus;

  return (
    <div className="rounded-xl border bg-card shadow-sm" data-testid={`subject-${course.id}`}>
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button className="flex items-center gap-2 min-w-0 flex-1 text-start" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <GraduationCap className="h-5 w-5 text-primary shrink-0" />
          <span className="min-w-0">
            <span className="block font-semibold truncate">{course.title}</span>
            <span className="block text-xs text-muted-foreground truncate">
              {[course.class_level ? `Class ${course.class_level}` : null, semesterName, sessionName, course.mentor?.full_name].filter(Boolean).join(" · ") || "Not placed in a session yet"}
            </span>
          </span>
        </button>
        <Badge variant="outline" className="hidden sm:inline-flex">{course.learning_path_mode === "sequential" ? "Sequential" : "Flexible"}</Badge>
        <StatusBadge status={status} />
        <Button size="sm" variant="outline" onClick={onStats}><BarChart3 className="h-4 w-4 me-1.5" /><span className="hidden sm:inline">Progress</span></Button>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Actions for ${course.title}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4 me-2" />Edit subject</DropdownMenuItem>
              {status !== "published" && <DropdownMenuItem onClick={() => setStatus("published")}><Eye className="h-4 w-4 me-2" />Publish subject</DropdownMenuItem>}
              {status === "published" && <DropdownMenuItem onClick={() => setStatus("draft")}><EyeOff className="h-4 w-4 me-2" />Unpublish subject</DropdownMenuItem>}
              {status !== "archived" && <DropdownMenuItem onClick={() => setStatus("archived")}><Archive className="h-4 w-4 me-2" />Archive subject</DropdownMenuItem>}
              {canDelete && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={remove}><Trash2 className="h-4 w-4 me-2" />Delete subject</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {(open || filter.search || filter.status !== "all") && (
        <div className="border-t p-3 bg-muted/10 rounded-b-xl"><SubjectTree course={course} canEdit={canEdit} filter={filter} /></div>
      )}
    </div>
  );
}

export default function CourseStructureManager() {
  const { profile } = useAuth();
  const isAdminRole = ADMIN_ROLES.includes(profile?.role ?? "");
  const { data, isLoading, error } = useStaffSubjects();
  const subj = useSubjectMutations();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ContentStatus | "all">("all");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [subjectDialog, setSubjectDialog] = useState<{ course: Course | null; sessionId?: string | null; semesterId?: string | null } | null>(null);
  const [statsFor, setStatsFor] = useState<Course | null>(null);
  const [sessionDialog, setSessionDialog] = useState(false);
  const [semesterDialog, setSemesterDialog] = useState<string | null>(null); // session id
  const [sessionForm, setSessionForm] = useState({ name: "", start_date: "", end_date: "" });
  const [semesterForm, setSemesterForm] = useState({ name: "" });

  // Teachers manage the subjects they created or are in charge of; admins see every subject of the school.
  const canManage = (c: Course) => isAdminRole || (profile?.role === "teacher" && (c.created_by === profile.id || c.mentor_id === profile.id));
  const courses = useMemo(() => {
    const all = data?.courses ?? [];
    return profile?.role === "teacher" ? all.filter(canManage) : all;
  }, [data, profile?.id, profile?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjectMatches = (c: Course) => {
    const q = search.trim().toLowerCase();
    return !q || c.title.toLowerCase().includes(q) || (c.subject ?? "").toLowerCase().includes(q) || (c.class_level ?? "").toLowerCase().includes(q);
  };
  const groups = useMemo(() => {
    const filtered = courses.filter((c) => sessionFilter === "all" || (sessionFilter === "none" ? !c.academic_year_id : c.academic_year_id === sessionFilter));
    // when searching, keep a subject if its title matches OR we're drilling into content (tree filters itself)
    return groupCourses(filtered, data?.sessions ?? [], data?.semesters ?? []);
  }, [courses, data, sessionFilter]);

  const sessionName = (id?: string | null) => data?.sessions.find((s) => s.id === id)?.name;
  const semesterName = (id?: string | null) => data?.semesters.find((s) => s.id === id)?.name;
  const fail = (e: Error) => toast.error(friendlyCourseError(e.message));

  const saveSubject = (values: Record<string, unknown>) => {
    if (!subjectDialog) return;
    if (subjectDialog.course) {
      // edit
      subj.create.reset();
      import("@/hooks/useCourseStructure").then(({ sb }) =>
        sb.from("courses").update({ ...values, updated_at: new Date().toISOString() }).eq("id", subjectDialog.course!.id).then(({ error: err }) => {
          if (err) return fail(err);
          toast.success("Subject updated"); setSubjectDialog(null);
          subj.createSession.reset(); // no-op; keeps hook usage simple
          window.dispatchEvent(new Event("cs-refresh"));
        }));
    } else {
      subj.create.mutate(values, { onError: fail, onSuccess: () => { toast.success("Subject created as a draft"); setSubjectDialog(null); } });
    }
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="h-6 w-6 text-primary" />Course Structure</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Organise learning as Academic Session → Semester → Subject → Module → Chapter → Topic → Materials.
              {profile?.role === "teacher" ? " You can manage the subjects you are in charge of." : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdminRole && <Button variant="outline" onClick={() => setSessionDialog(true)}><CalendarRange className="h-4 w-4 me-1.5" />New session</Button>}
            <Button onClick={() => setSubjectDialog({ course: null })}><Plus className="h-4 w-4 me-1.5" />New subject</Button>
          </div>
        </header>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subjects, modules, chapters and topics…" className="ps-9" aria-label="Search course content" />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as ContentStatus | "all")}>
            <SelectTrigger className="sm:w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(["draft", "published", "archived"] as const).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sessionFilter} onValueChange={setSessionFilter}>
            <SelectTrigger className="sm:w-48" aria-label="Filter by academic session"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sessions</SelectItem>
              {(data?.sessions ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              <SelectItem value="none">Not assigned</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">Couldn't load subjects: {(error as Error).message}</div>
        ) : courses.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <GraduationCap className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-semibold">{profile?.role === "teacher" ? "No subjects assigned to you yet" : "No subjects yet"}</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-md mx-auto">
              {profile?.role === "teacher" ? "Create a subject of your own, or ask an administrator to make you the teacher in charge of one." : "Create your first subject, then add modules, chapters and topics."}
            </p>
            <Button onClick={() => setSubjectDialog({ course: null })}><Plus className="h-4 w-4 me-1.5" />New subject</Button>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.session?.id ?? "none"} aria-label={g.session?.name ?? "Not assigned to a session"} className="space-y-3">
                <div className="flex items-center gap-2">
                  <CalendarRange className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-semibold">{g.session ? `Academic session ${g.session.name}` : "Not assigned to a session"}</h2>
                  {g.session?.is_active && <Badge>Active</Badge>}
                  {isAdminRole && g.session && (
                    <Button size="sm" variant="ghost" className="ms-auto" onClick={() => { setSemesterForm({ name: "" }); setSemesterDialog(g.session!.id); }}><Plus className="h-4 w-4 me-1" />Semester</Button>
                  )}
                </div>
                {g.semesters.map((sg) => (
                  <div key={sg.semester?.id ?? "none"} className="space-y-2 ps-3 border-s-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-muted-foreground">{sg.semester?.name ?? (g.session ? "No semester" : "Existing subjects")}</h3>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSubjectDialog({ course: null, sessionId: g.session?.id ?? null, semesterId: sg.semester?.id ?? null })}><Plus className="h-3.5 w-3.5 me-1" />Subject</Button>
                    </div>
                    {sg.courses.filter(subjectMatches).length === 0 && search ? (
                      // a search may match content *inside* the subject, so still render the cards
                      sg.courses.map((c) => <SubjectCard key={c.id} course={c} canEdit={canManage(c)} canDelete={isAdminRole} filter={{ search, status }} sessionName={sessionName(c.academic_year_id)} semesterName={semesterName(c.semester_id)} onEdit={() => setSubjectDialog({ course: c })} onStats={() => setStatsFor(c)} />)
                    ) : (
                      sg.courses.map((c) => <SubjectCard key={c.id} course={c} canEdit={canManage(c)} canDelete={isAdminRole} filter={{ search: subjectMatches(c) ? "" : search, status }} sessionName={sessionName(c.academic_year_id)} semesterName={semesterName(c.semester_id)} onEdit={() => setSubjectDialog({ course: c })} onStats={() => setStatsFor(c)} />)
                    )}
                  </div>
                ))}
              </section>
            ))}
            {isAdminRole && (
              <p className="text-xs text-muted-foreground">
                Need terms, rollover or promotions? Manage academic years in the <Link to="/semester-engine" className="underline">Semester Engine</Link>.
              </p>
            )}
          </div>
        )}
      </div>

      <SubjectDialog
        open={!!subjectDialog} onOpenChange={(o) => !o && setSubjectDialog(null)} course={subjectDialog?.course}
        sessions={data?.sessions ?? []} semesters={data?.semesters ?? []} canAssignTeacher={isAdminRole}
        defaultSessionId={subjectDialog?.sessionId} defaultSemesterId={subjectDialog?.semesterId}
        saving={subj.create.isPending} onSubmit={saveSubject}
      />
      <SubjectStatsDialog open={!!statsFor} onOpenChange={(o) => !o && setStatsFor(null)} courseId={statsFor?.id ?? null} title={statsFor?.title ?? ""} />

      {/* quick create: academic session */}
      <Dialog open={sessionDialog} onOpenChange={setSessionDialog}>
        <DialogContent className="sm:max-w-md">
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            if (!sessionForm.name.trim() || !sessionForm.start_date || !sessionForm.end_date) { toast.error("Fill in the name and both dates."); return; }
            if (sessionForm.end_date < sessionForm.start_date) { toast.error("The end date must be after the start date."); return; }
            subj.createSession.mutate({ ...sessionForm, name: sessionForm.name.trim() }, { onError: fail, onSuccess: () => { toast.success("Academic session created"); setSessionDialog(false); setSessionForm({ name: "", start_date: "", end_date: "" }); } });
          }}>
            <DialogHeader><DialogTitle>New academic session</DialogTitle><DialogDescription>For example 2026–2027. You can add semesters to it next.</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label htmlFor="as-name">Name</Label><Input id="as-name" value={sessionForm.name} onChange={(e) => setSessionForm({ ...sessionForm, name: e.target.value })} placeholder="2026–2027" maxLength={40} autoFocus /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label htmlFor="as-start">Starts</Label><Input id="as-start" type="date" value={sessionForm.start_date} onChange={(e) => setSessionForm({ ...sessionForm, start_date: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="as-end">Ends</Label><Input id="as-end" type="date" value={sessionForm.end_date} onChange={(e) => setSessionForm({ ...sessionForm, end_date: e.target.value })} /></div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setSessionDialog(false)}>Cancel</Button><Button type="submit" disabled={subj.createSession.isPending}>{subj.createSession.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}Create</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* quick create: semester */}
      <Dialog open={!!semesterDialog} onOpenChange={(o) => !o && setSemesterDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            if (!semesterForm.name.trim() || !semesterDialog) return;
            subj.createSemester.mutate({ academic_year_id: semesterDialog, name: semesterForm.name.trim() }, { onError: fail, onSuccess: () => { toast.success("Semester created"); setSemesterDialog(null); } });
          }}>
            <DialogHeader><DialogTitle>New semester</DialogTitle><DialogDescription>Added to {sessionName(semesterDialog)}.</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label htmlFor="sem-name">Name</Label><Input id="sem-name" value={semesterForm.name} onChange={(e) => setSemesterForm({ name: e.target.value })} placeholder="Semester 1" maxLength={40} autoFocus /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setSemesterDialog(null)}>Cancel</Button><Button type="submit" disabled={subj.createSemester.isPending || !semesterForm.name.trim()}>{subj.createSemester.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}Create</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
