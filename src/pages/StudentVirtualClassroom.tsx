import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PenLine } from "lucide-react";
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

  return (
    <AppLayout>
      <div className="space-y-6 p-4">
        <h1 className="text-2xl font-semibold">Virtual Classroom</h1>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : (
          <Tabs defaultValue="upcoming">
            <TabsList>
              <TabsTrigger value="upcoming">Upcoming Classes</TabsTrigger>
              <TabsTrigger value="history">Topic History</TabsTrigger>
              <TabsTrigger value="past">Past Sessions</TabsTrigger>
            </TabsList>

            <TabsContent value="upcoming" className="space-y-4 mt-4">
              {upcoming.length === 0 ? (
                <p className="text-muted-foreground">No upcoming classes scheduled.</p>
              ) : (
                upcoming.map((s) => (
                  <Card key={s.id}>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-lg">
                        {s.title || s.subject} — {s.class_name} {s.section}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {renderScheduleBadge(s)}
                        {isToday(s) && <Badge className="bg-green-100 text-green-800">Today</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-2">
                        {new Date(s.scheduled_start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} →{" "}
                        {new Date(s.scheduled_end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {s.recurrence_end_date && " • repeats daily"}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {isToday(s) ? (
                          <>
                            <a href={s.meet_link} target="_blank" rel="noopener noreferrer">
                              <Button size="sm">Join Today's Class</Button>
                            </a>
                            <Button size="sm" variant="secondary" onClick={() => openWhiteboard(s)}>
                              <PenLine className="h-3.5 w-3.5 mr-1" /> Whiteboard
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" disabled>
                            Available on {new Date(s.scheduled_start) > new Date() ? new Date(s.scheduled_start).toLocaleDateString() : "the scheduled day"}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-3 mt-4">
              {topicHistory.length === 0 ? (
                <p className="text-muted-foreground">No topics logged yet.</p>
              ) : (
                topicHistory.map((t, i) => (
                  <Card key={`${t.session_id}-${t.log_date}-${i}`}>
                    <CardContent className="p-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">
                          {t.class_name} {t.section} — {t.subject}
                        </p>
                        <Badge variant="outline">{new Date(t.log_date).toLocaleDateString()}</Badge>
                      </div>
                      {t.topic_covered && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Covered:</span> {t.topic_covered}
                        </p>
                      )}
                      {t.next_topic && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Next:</span> {t.next_topic}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="past" className="space-y-3 mt-4">
              {past.length === 0 ? (
                <p className="text-muted-foreground">No past sessions.</p>
              ) : (
                past.map((s) => (
                  <Card key={s.id}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{s.title || s.subject} — {s.class_name} {s.section}</p>
                        <p className="text-xs text-muted-foreground">{renderScheduleBadge(s)}</p>
                      </div>
                      <Badge variant="secondary">{s.status}</Badge>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        )}
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
        <DialogContent className="max-w-6xl h-[85vh] p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>
              Whiteboard{activeSessionForWhiteboard ? ` — ${activeSessionForWhiteboard.title || activeSessionForWhiteboard.subject}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 h-full">
            {whiteboardLoading ? (
              <p className="text-muted-foreground p-4">Loading whiteboard...</p>
            ) : whiteboardNotStarted ? (
              <p className="text-muted-foreground p-4">
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