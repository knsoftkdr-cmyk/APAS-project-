import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Link2, Loader2, Pencil, Pin, Play, Trash2, Upload } from "lucide-react";
import { RecordingPlayerDialog } from "@/components/live-recordings/RecordingPlayerDialog";
import {
  STATUS_META, addRecordingLink, daysUntilExpiry, deleteRecording, formatBytes, formatRecordingDuration, getLinkOptions,
  getRecordingSettings, getSessionRecordingState, listRecordings, rearmSession, setSessionRecording, updateRecording,
  uploadRecordingFile, validateUploadFile,
  type Recording, type RecordingSettings, type SessionRecordingState,
} from "@/lib/liveRecordings";

interface SessionLite {
  id: string;
  title: string | null;
  subject: string;
  scheduled_start: string;
}

const NONE = "__none__";
const today = () => new Date().toISOString().slice(0, 10);

export function SessionRecordingsDialog({ session, onClose }: { session: SessionLite | null; onClose: () => void }) {
  const { toast } = useToast();
  const [state, setState] = useState<SessionRecordingState | null>(null);
  const [settings, setSettings] = useState<RecordingSettings | null>(null);
  const [rows, setRows] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<Recording | null>(null);
  const [editing, setEditing] = useState<Recording | null>(null);
  const [removing, setRemoving] = useState<Recording | null>(null);
  const [addDate, setAddDate] = useState(today());
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!session) return;
    if (!silent) setLoading(true);
    try {
      const [st, list, cfg] = await Promise.all([getSessionRecordingState(session.id), listRecordings({ session_id: session.id }), getRecordingSettings()]);
      setState(st);
      setRows(list);
      setSettings(cfg.settings);
    } catch (e) {
      toast({ title: "Could not load recordings", description: (e as Error).message, variant: "destructive" });
    } finally {
      if (!silent) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    setState(null); setRows([]);
    if (session) { setAddDate(today()); void load(); }
  }, [session?.id, load]);

  // while something is still being recorded / processed / saved, refresh quietly
  useEffect(() => {
    if (!session || !rows.some((r) => ["recording", "processing", "copying"].includes(r.status))) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 30_000);
    return () => clearInterval(id);
  }, [session?.id, rows, load]);

  async function toggle(enabled: boolean) {
    if (!session) return;
    setBusy(true);
    try {
      setState(await setSessionRecording(session.id, enabled));
      toast({ title: enabled ? "Recording is on for this class" : "Recording is off for this class" });
    } catch (e) {
      toast({ title: "Could not change recording", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function recheck() {
    if (!session) return;
    setBusy(true);
    try { setState(await rearmSession(session.id)); } catch (e) {
      toast({ title: "Could not reach Google Meet", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function onFile(file: File | undefined) {
    if (!session || !file || !settings) return;
    const problem = validateUploadFile(file, settings.max_upload_mb);
    if (problem) { toast({ title: "Cannot upload", description: problem, variant: "destructive" }); return; }
    setUploading(true);
    try {
      await uploadRecordingFile(session.id, addDate, file);
      toast({ title: "Recording uploaded", description: file.name });
      await load(true);
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function addLink() {
    if (!session) return;
    setBusy(true);
    try {
      await addRecordingLink(session.id, addDate, linkUrl);
      setLinkUrl("");
      toast({ title: "Recording link added" });
      await load(true);
    } catch (e) {
      toast({ title: "Could not add the link", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteRecording(removing.id);
      toast({ title: "Recording deleted" });
      setRemoving(null);
      await load(true);
    } catch (e) {
      toast({ title: "Could not delete", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function togglePin(r: Recording) {
    try { await updateRecording(r.id, { pinned: !r.pinned }); await load(true); } catch (e) {
      toast({ title: "Could not update", description: (e as Error).message, variant: "destructive" });
    }
  }

  const canAdd = !!state?.school_enabled && !!state?.can_upload;

  return (
    <>
      <Dialog open={!!session} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-lg w-[calc(100%-2rem)] sm:w-full p-0 overflow-hidden max-h-[90vh] flex flex-col">
          <div className="bg-gradient-to-r from-teal-600 to-cyan-600 px-5 py-4 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-white text-base truncate pe-6">Recordings: {session?.title || session?.subject}</DialogTitle>
            </DialogHeader>
          </div>

          <div className="overflow-y-auto flex-1 px-4 sm:px-5 py-4 space-y-4">
            {loading && !state ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : state && (
              <>
                {/* recording switch */}
                <div className="rounded-xl border border-slate-100 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Record this class automatically</p>
                      <p className="text-xs text-muted-foreground">
                        {!state.school_enabled
                          ? "Recording is switched off for your school. An administrator can turn it on in Admin Panel > Live Classes."
                          : !state.effective ? "This class will not be recorded."
                          : state.google_configured === false ? "Automatic recording is not available yet."
                          : "Google Meet records when you join, even if you later close your browser."}
                      </p>
                    </div>
                    <Switch checked={state.effective} onCheckedChange={toggle}
                      disabled={busy || !state.school_enabled || !state.can_toggle || !state.meet_supported} aria-label="Record this class automatically" />
                  </div>
                  {!state.meet_supported && (
                    <p className="text-xs text-amber-700">Automatic recording needs a Google Meet link like meet.google.com/abc-defg-hij. You can still attach a recording below.</p>
                  )}
                  {state.school_enabled && state.effective && state.google_configured === false && (
                    <div className="rounded-lg bg-amber-50 border border-amber-100 p-2 space-y-1">
                      <p className="text-xs text-amber-800">Your school has not connected Google yet, so Meet will <b>not</b> record this class by itself and you will see no recording banner.</p>
                      <p className="text-xs text-amber-800">To keep a recording: in Meet choose Activities, then Recording, then Start recording (needs a school Google plan that allows it). Afterwards add the video or its Drive link under "Add a recording yourself" below.</p>
                    </div>
                  )}
                  {state.school_enabled && state.effective && state.meet_supported && state.google_configured !== false && (
                    state.arm_error ? (
                      <div className="rounded-lg bg-red-50 border border-red-100 p-2 space-y-1.5">
                        <p className="text-xs text-red-700">{state.arm_error}</p>
                        <Button size="sm" variant="outline" className="h-8" onClick={recheck} disabled={busy}>Try again</Button>
                      </div>
                    ) : state.armed_at ? (
                      <p className="text-xs text-emerald-700">Ready: Google Meet will record this class.</p>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-muted-foreground">Not connected to Google Meet yet (happens automatically before class).</p>
                        <Button size="sm" variant="outline" className="h-8" onClick={recheck} disabled={busy}>Connect now</Button>
                      </div>
                    )
                  )}
                </div>

                {/* recordings */}
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">No recordings for this class yet.</p>
                ) : (
                  <div className="space-y-2">
                    {rows.map((r) => {
                      const left = daysUntilExpiry(r);
                      return (
                        <div key={r.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-2.5 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{r.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {r.session_date ?? ""}{formatRecordingDuration(r.duration_seconds) ? ` · ${formatRecordingDuration(r.duration_seconds)}` : ""}
                                {r.size_bytes > 0 ? ` · ${formatBytes(r.size_bytes)}` : ""}
                              </p>
                            </div>
                            <Badge className={`${STATUS_META[r.status].badge} hover:opacity-90 shrink-0`}>{STATUS_META[r.status].label}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {r.subject && <Badge variant="outline">{r.subject}</Badge>}
                            {r.course_title && <Badge variant="outline" className="border-teal-300 text-teal-700">Course: {r.course_title}</Badge>}
                            {r.lesson_title && <Badge variant="outline" className="border-teal-300 text-teal-700">Lesson: {r.lesson_title}</Badge>}
                            {r.visibility === "teachers" && <Badge variant="outline" className="border-slate-400">Hidden from students</Badge>}
                            {r.storage_kind === "drive" && <Badge variant="outline">In Google Drive</Badge>}
                            {r.pinned ? <Badge variant="outline" className="border-sky-300 text-sky-700">Kept</Badge>
                              : left != null && left <= 30 && <Badge variant="outline" className="border-amber-300 text-amber-700">Removed in {left} d</Badge>}
                          </div>
                          {r.last_error && <p className="text-xs text-amber-700">{r.last_error}</p>}
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            <Button size="sm" className="h-8 gap-1" disabled={!r.playable} onClick={() => setPlaying(r)}><Play className="h-3.5 w-3.5" />Play</Button>
                            {r.can_manage && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
                            {r.can_manage && <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => togglePin(r)}><Pin className="h-3.5 w-3.5" />{r.pinned ? "Unkeep" : "Keep"}</Button>}
                            {r.can_delete && <Button size="sm" variant="ghost" className="h-8 gap-1 text-red-600" onClick={() => setRemoving(r)}><Trash2 className="h-3.5 w-3.5" />Delete</Button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* add by hand */}
                {canAdd && settings && (
                  <div className="rounded-xl border border-dashed border-slate-300 p-3 space-y-3">
                    <p className="text-sm font-medium">Add a recording yourself</p>
                    <p className="text-xs text-muted-foreground">Use this if the class was recorded outside APAS, or automatic recording is not available.</p>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-slate-600">Date of the class</Label>
                      <Input type="date" value={addDate} max={today()} onChange={(e) => e.target.value && setAddDate(e.target.value)} className="border-slate-200 max-w-[11rem]" />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                      <Button variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading || busy}>
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {uploading ? "Uploading..." : `Upload video (max ${settings.max_upload_mb} MB)`}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://drive.google.com/..." className="border-slate-200" />
                      <Button variant="outline" className="gap-1.5 shrink-0" onClick={addLink} disabled={busy || !linkUrl.trim()}><Link2 className="h-4 w-4" />Add link</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <RecordingPlayerDialog recording={playing} onClose={() => setPlaying(null)} />
      <RecordingEditDialog recording={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(true); }} />

      <Dialog open={!!removing} onOpenChange={(o) => { if (!o && !busy) setRemoving(null); }}>
        <DialogContent className="max-w-sm w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader><DialogTitle className="text-base">Delete this recording?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            "{removing?.title}" will disappear for everyone and the saved video file is removed. If it also exists in Google Drive, that copy is not touched.
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={confirmDelete} disabled={busy}>{busy ? "Deleting..." : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecordingEditDialog({ recording, onClose, onSaved }: { recording: Recording | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<"class" | "teachers">("class");
  const [course, setCourse] = useState(NONE);
  const [lesson, setLesson] = useState(NONE);
  const [courses, setCourses] = useState<Array<{ id: string; title: string }>>([]);
  const [lessons, setLessons] = useState<Array<{ id: string; title: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recording) return;
    setTitle(recording.title); setNotes(recording.notes ?? ""); setVisibility(recording.visibility);
    setCourse(recording.course_id ?? NONE); setLesson(recording.lesson_id ?? NONE);
    setCourses([]); setLessons([]);
    let alive = true;
    getLinkOptions(recording.id).then((o) => { if (alive) { setCourses(o.courses); setLessons(o.lessons); } }).catch(() => undefined);
    return () => { alive = false; };
  }, [recording?.id]);

  async function save() {
    if (!recording) return;
    setSaving(true);
    try {
      await updateRecording(recording.id, {
        title, notes: notes || null, visibility,
        course_id: course === NONE ? null : course, lesson_id: lesson === NONE ? null : lesson,
      });
      toast({ title: "Recording updated" });
      onSaved();
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  // keep a linked item selectable even if it is not in the (limited) option list
  const withCurrent = (list: Array<{ id: string; title: string }>, id: string | null, name: string | null) =>
    id && name && !list.some((x) => x.id === id) ? [{ id, title: name }, ...list] : list;

  return (
    <Dialog open={!!recording} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md w-[calc(100%-2rem)] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">Edit recording</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-600">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))} className="border-slate-200" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-600">Subject</Label>
            <Input value={recording?.subject ?? ""} disabled className="border-slate-200" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-600">Course</Label>
            <Select value={course} onValueChange={setCourse}>
              <SelectTrigger className="border-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not linked</SelectItem>
                {withCurrent(courses, recording?.course_id ?? null, recording?.course_title ?? null).map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-600">Lesson</Label>
            <Select value={lesson} onValueChange={setLesson}>
              <SelectTrigger className="border-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not linked</SelectItem>
                {withCurrent(lessons, recording?.lesson_id ?? null, recording?.lesson_title ?? null).map((l) => <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-600">Who can watch</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as "class" | "teachers")}>
              <SelectTrigger className="border-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="class">Students of this class</SelectItem>
                <SelectItem value="teachers">Teachers only (hidden from students)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-600">Notes for students (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 2000))} rows={2} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white" onClick={save} disabled={saving || !title.trim()}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SessionRecordingsDialog;
