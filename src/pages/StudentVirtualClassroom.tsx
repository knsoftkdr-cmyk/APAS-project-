import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PenLine, Video, History, Archive } from "lucide-react";
import { WhiteboardCanvas } from "@/components/whiteboard/WhiteboardCanvas";

interface SessionRow {
  id: string;
  class_id: string;
  subject: string;
  title: string | null;
  meet_link: string;
  scheduled_start: string;
  scheduled_end: string;
  recurrence_end_date: string | null;
  status: string;
  class_name?: string;
  section?: string;
}

interface TopicEntry {
  session_id: string;
  log_date: string;
  topic_covered: string | null;
  next_topic: string | null;
  class_name?: string;
  section?: string;
  subject?: string;
}

type TabKey = "upcoming" | "history" | "past";

const todayStr = () => new Date().toISOString().slice(0, 10);

function isTodayOrFuture(scheduledStart: string, recurrenceEndDate: string | null) {
  const today = todayStr();
  const endDate = recurrenceEndDate || scheduledStart.slice(0, 10);
  return endDate >= today;
}

export default function StudentVirtualClassroom() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [topicHistory, setTopicHistory] = useState<TopicEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("upcoming");

  // Whiteboard state
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [whiteboardLoading, setWhiteboardLoading] = useState(false);
  const [activeWhiteboardId, setActiveWhiteboardId] = useState<string | null>(null);
  const [activeWhiteboardMode, setActiveWhiteboardMode] = useState<"teacher_only" | "student_editable">("teacher_only");
  const [activeSessionForWhiteboard, setActiveSessionForWhiteboard] = useState<SessionRow | null>(null);
  const [whiteboardNotStarted, setWhiteboardNotStarted] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) setCurrentUserId(data.user.id);
    });
  }, []);

  async function loadData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      setLoading(false);
      return;
    }

    const { data: studentRow, error: studentError } = await supabase
      .from("students")
      .select("id")
      .eq("profile_id", userData.user.id)
      .single();

    if (studentError || !studentRow) {
      toast({ title: "Could not load your student record", description: studentError?.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const { data: classLinks, error: classError } = await supabase
      .from("class_students")
      .select("class_id")
      .eq("student_id", studentRow.id);

    if (classError || !classLinks || classLinks.length === 0) {
      setSessions([]);
      setTopicHistory([]);
      setLoading(false);
      return;
    }

    const classIds = classLinks.map((c) => c.class_id);

    const { data: sessionData, error: sessionError } = await supabase
      .from("virtual_classroom_sessions")
      .select(
        `id, class_id, subject, title, meet_link, scheduled_start, scheduled_end,
         recurrence_end_date, status, classes:class_id ( name, section )`
      )
      .in("class_id", classIds)
      .order("scheduled_start", { ascending: true });

    if (sessionError) {
      toast({ title: "Failed to load schedule", description: sessionError.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const mapped: SessionRow[] = (sessionData || []).map((row: any) => ({
      id: row.id,
      class_id: row.class_id,
      subject: row.subject,
      title: row.title,
      meet_link: row.meet_link,
      scheduled_start: row.scheduled_start,
      scheduled_end: row.scheduled_end,
      recurrence_end_date: row.recurrence_end_date,
      status: row.status,
      class_name: row.classes?.name,
      section: row.classes?.section,
    }));
    setSessions(mapped);

    const sessionIds = mapped.map((s) => s.id);
    if (sessionIds.length > 0) {
      const { data: topicData, error: topicError } = await supabase
        .from("virtual_classroom_topic_log")
        .select("session_id, log_date, topic_covered, next_topic")
        .in("session_id", sessionIds)
        .order("log_date", { ascending: false });

      if (topicError) {
        toast({ title: "Failed to load topic history", description: topicError.message, variant: "destructive" });
      } else {
        const sessionMap = new Map(mapped.map((s) => [s.id, s]));
        const enriched: TopicEntry[] = (topicData || []).map((t: any) => {
          const sess = sessionMap.get(t.session_id);
          return {
            ...t,
            class_name: sess?.class_name,
            section: sess?.section,
            subject: sess?.subject,
          };
        });
        setTopicHistory(enriched);
      }
    }

    setLoading(false);
  }

  function renderScheduleBadge(session: SessionRow) {
    if (!session.recurrence_end_date) {
      return <Badge variant="outline">{new Date(session.scheduled_start).toLocaleDateString()}</Badge>;
    }
    return (
      <Badge variant="outline">
        {new Date(session.scheduled_start).toLocaleDateString()} → {new Date(session.recurrence_end_date).toLocaleDateString()}
      </Badge>
    );
  }

  function isToday(session: SessionRow) {
    const today = todayStr();
    const startDate = session.scheduled_start.slice(0, 10);
    const endDate = session.recurrence_end_date || startDate;
    return today >= startDate && today <= endDate;
  }

  // ---------- Whiteboard: look up only, students never create one ----------
  async function openWhiteboard(session: SessionRow) {
    setActiveSessionForWhiteboard(session);
    setWhiteboardLoading(true);
    setWhiteboardNotStarted(false);
    setWhiteboardOpen(true);

    const { data: existing, error } = await supabase
      .from("whiteboards")
      .select("id, mode")
      .eq("classroom_session_id", session.id)
      .eq("is_archived", false)
      .maybeSingle();

    if (error) {
      toast({ title: "Failed to load whiteboard", description: error.message, variant: "destructive" });
      setWhiteboardOpen(false);
      setWhiteboardLoading(false);
      return;
    }

    if (!existing?.id) {
      setWhiteboardNotStarted(true);
      setWhiteboardLoading(false);
      return;
    }

    setActiveWhiteboardId(existing.id);
    setActiveWhiteboardMode(existing.mode as "teacher_only" | "student_editable");
    setWhiteboardLoading(false);
  }

  const upcoming = sessions.filter(
    (s) => ["scheduled", "live"].includes(s.status) && isTodayOrFuture(s.scheduled_start, s.recurrence_end_date)
  );
  const past = sessions.filter((s) => !isTodayOrFuture(s.scheduled_start, s.recurrence_end_date) || s.status === "completed");

  const TABS: { key: TabKey; label: string; icon: typeof Video }[] = [
    { key: "upcoming", label: "Upcoming Classes", icon: Video },
    { key: "history", label: "Topic History", icon: History },
    { key: "past", label: "Past Sessions", icon: Archive },
  ];

  return (
    <AppLayout>
      <div className="min-h-screen relative overflow-x-hidden">
        <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-teal-300 opacity-[0.12] blur-3xl" />
        <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-cyan-300 opacity-[0.10] blur-3xl" />
        <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-teal-200 opacity-[0.10] blur-3xl" />

        <div className="relative z-10 space-y-5 p-4 md:p-6 max-w-7xl mx-auto">
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-teal-600 to-cyan-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <PenLine className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">Virtual Classroom</h1>
                <p className="text-teal-100 text-xs md:text-sm mt-0.5">Join your classes, revisit topics, catch up on past sessions</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1.5 bg-slate-100/70 rounded-xl p-1.5 w-fit flex-wrap">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === key
                    ? "bg-white text-teal-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <span className="w-4 h-4 rounded-full border-2 border-teal-300 border-t-teal-600 animate-spin" /> Loading...
            </div>
          ) : (
            <>
              {tab === "upcoming" && (
                upcoming.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-teal-100 rounded-xl bg-teal-50/30">
                    <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center mx-auto mb-3">
                      <Video className="h-6 w-6 text-teal-400" />
                    </div>
                    <p className="text-sm text-muted-foreground">No upcoming classes scheduled.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {upcoming.map((s) => {
                      const today = isToday(s);
                      const statusAccent = today ? "border-l-teal-400" : "border-l-slate-200";
                      return (
                        <Card key={s.id} className={`overflow-hidden border-l-4 ${statusAccent} border-slate-200 shadow-sm hover:shadow-md transition-shadow`}>
                          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3">
                            <CardTitle className="text-base md:text-lg flex items-center gap-2.5">
                              <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center shrink-0">
                                <Video className="h-4 w-4 text-teal-600" />
                              </div>
                              <span className="truncate">{s.title || s.subject} — {s.class_name} {s.section}</span>
                            </CardTitle>
                            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                              {renderScheduleBadge(s)}
                              {today && <Badge className="bg-teal-100 text-teal-700 hover:opacity-90">Today</Badge>}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                              {new Date(s.scheduled_start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} →{" "}
                              {new Date(s.scheduled_end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              {s.recurrence_end_date && " • repeats daily"}
                            </p>
                            <div className="flex gap-2 flex-wrap">
                              {today ? (
                                <>
                                  <a href={s.meet_link} target="_blank" rel="noopener noreferrer">
                                    <Button size="sm" className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white">
                                      Join Today's Class
                                    </Button>
                                  </a>
                                  <Button
                                    size="sm"
                                    className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
                                    onClick={() => openWhiteboard(s)}
                                  >
                                    <PenLine className="h-3.5 w-3.5 mr-1" /> Whiteboard
                                  </Button>
                                </>
                              ) : (
                                <Button size="sm" variant="outline" disabled className="border-slate-200">
                                  Available on {new Date(s.scheduled_start) > new Date() ? new Date(s.scheduled_start).toLocaleDateString() : "the scheduled day"}
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )
              )}

              {tab === "history" && (
                topicHistory.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-teal-100 rounded-xl bg-teal-50/30">
                    <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center mx-auto mb-3">
                      <History className="h-6 w-6 text-teal-400" />
                    </div>
                    <p className="text-sm text-muted-foreground">No topics logged yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {topicHistory.map((t, i) => (
                      <Card key={`${t.session_id}-${t.log_date}-${i}`} className="overflow-hidden border-l-4 border-l-teal-300 border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="font-semibold text-sm text-slate-800">
                              {t.class_name} {t.section} — {t.subject}
                            </p>
                            <Badge variant="outline">{new Date(t.log_date).toLocaleDateString()}</Badge>
                          </div>
                          {t.topic_covered && (
                            <p className="text-sm rounded-lg bg-teal-50/50 border border-teal-100 px-3 py-2">
                              <span className="text-teal-700 font-semibold">Covered:</span>{" "}
                              <span className="text-slate-700">{t.topic_covered}</span>
                            </p>
                          )}
                          {t.next_topic && (
                            <p className="text-sm rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                              <span className="text-slate-500 font-semibold">Next:</span>{" "}
                              <span className="text-slate-700">{t.next_topic}</span>
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )
              )}

              {tab === "past" && (
                past.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-teal-100 rounded-xl bg-teal-50/30">
                    <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center mx-auto mb-3">
                      <Archive className="h-6 w-6 text-teal-400" />
                    </div>
                    <p className="text-sm text-muted-foreground">No past sessions.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {past.map((s) => (
                      <Card key={s.id} className="overflow-hidden border-l-4 border-l-slate-300 border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <CardContent className="p-4 flex items-center justify-between gap-2 flex-wrap">
                          <div className="min-w-0 flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                              <Archive className="h-4 w-4 text-slate-500" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm text-slate-800 truncate">{s.title || s.subject} — {s.class_name} {s.section}</p>
                              <p className="text-xs text-muted-foreground">{renderScheduleBadge(s)}</p>
                            </div>
                          </div>
                          <Badge className="bg-slate-100 text-slate-600 hover:opacity-90 shrink-0">{s.status}</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>

      {/* Whiteboard dialog */}
      <Dialog
        open={whiteboardOpen}
        onOpenChange={(open) => {
          setWhiteboardOpen(open);
          if (!open) {
            setActiveWhiteboardId(null);
            setWhiteboardNotStarted(false);
          }
        }}
      >
        <DialogContent className="max-w-6xl w-[calc(100%-2rem)] sm:w-full h-[85vh] p-0 overflow-hidden flex flex-col">
          <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-3 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-white text-base flex items-center gap-2">
                <PenLine className="h-4 w-4" />
                Whiteboard{activeSessionForWhiteboard ? ` — ${activeSessionForWhiteboard.title || activeSessionForWhiteboard.subject}` : ""}
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="flex-1 min-h-0">
            {whiteboardLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 justify-center">
                <span className="w-4 h-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" /> Loading whiteboard...
              </div>
            ) : whiteboardNotStarted ? (
              <p className="text-muted-foreground p-6 text-sm">
                Your teacher hasn't started a whiteboard for this class yet. Check back once class begins.
              </p>
            ) : activeWhiteboardId && currentUserId ? (
              <WhiteboardCanvas
                whiteboardId={activeWhiteboardId}
                lessonId={undefined}
                currentUserId={currentUserId}
                currentUserRole="student"
                initialMode={activeWhiteboardMode}
                isOwner={false}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
