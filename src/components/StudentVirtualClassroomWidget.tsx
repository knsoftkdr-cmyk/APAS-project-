import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface TodaySession {
  id: string;
  subject: string;
  title: string | null;
  meet_link: string;
  scheduled_start: string;
  scheduled_end: string;
  recurrence_end_date: string | null;
  status: string;
  class_name?: string;
  section?: string;
  already_joined: boolean;
  todays_topic: string | null;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

// Combines today's date with the time-of-day from the session's stored timestamp,
// so a recurring session's "day 3" occurrence shows the correct time.
function todaysOccurrenceTimes(scheduledStart: string, scheduledEnd: string) {
  const now = new Date();
  const s = new Date(scheduledStart);
  const e = new Date(scheduledEnd);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), s.getHours(), s.getMinutes(), s.getSeconds());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), e.getHours(), e.getMinutes(), e.getSeconds());
  return { start, end };
}

function isTodayInRange(scheduledStart: string, recurrenceEndDate: string | null) {
  const today = todayStr();
  const startDate = scheduledStart.slice(0, 10);
  const endDate = recurrenceEndDate || startDate;
  return today >= startDate && today <= endDate;
}

export default function StudentVirtualClassroomWidget() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<TodaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
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

    const studentId = studentRow.id;

    const { data: classLinks, error: classError } = await supabase
      .from("class_students")
      .select("class_id")
      .eq("student_id", studentId);

    if (classError || !classLinks || classLinks.length === 0) {
      setSessions([]);
      setLoading(false);
      return;
    }

    const classIds = classLinks.map((c) => c.class_id);
    const today = todayStr();

    // Pull all active/recurring sessions whose window could plausibly include today.
    // (recurrence_end_date >= today OR no recurrence and scheduled_start is today)
    const { data: sessionData, error: sessionError } = await supabase
      .from("virtual_classroom_sessions")
      .select(
        `id, subject, title, meet_link, scheduled_start, scheduled_end,
         recurrence_end_date, status, classes:class_id ( name, section )`
      )
      .in("class_id", classIds)
      .in("status", ["scheduled", "live"])
      .or(`recurrence_end_date.gte.${today},scheduled_start.gte.${today}T00:00:00`);

    if (sessionError) {
      toast({ title: "Failed to load classes", description: sessionError.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Narrow down to sessions whose date range actually covers today
    const todaysSessions = (sessionData || []).filter((row: any) =>
      isTodayInRange(row.scheduled_start, row.recurrence_end_date)
    );

    const sessionIds = todaysSessions.map((s: any) => s.id);
    let joinedSet = new Set<string>();
    let topicMap = new Map<string, string | null>();

    if (sessionIds.length > 0) {
      const { data: attendanceData } = await supabase
        .from("virtual_classroom_attendance")
        .select("session_id")
        .eq("student_id", studentId)
        .eq("session_date", today)
        .in("session_id", sessionIds);

      joinedSet = new Set((attendanceData || []).map((a) => a.session_id));

      const { data: topicData } = await supabase
        .from("virtual_classroom_topic_log")
        .select("session_id, topic_covered")
        .eq("log_date", today)
        .in("session_id", sessionIds);

      topicMap = new Map((topicData || []).map((t) => [t.session_id, t.topic_covered]));
    }

    const mapped: TodaySession[] = todaysSessions.map((row: any) => {
      const { start, end } = todaysOccurrenceTimes(row.scheduled_start, row.scheduled_end);
      return {
        id: row.id,
        subject: row.subject,
        title: row.title,
        meet_link: row.meet_link,
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        recurrence_end_date: row.recurrence_end_date,
        status: row.status,
        class_name: row.classes?.name,
        section: row.classes?.section,
        already_joined: joinedSet.has(row.id),
        todays_topic: topicMap.get(row.id) ?? null,
      };
    });

    mapped.sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime());
    setSessions(mapped);
    setLoading(false);
  }

  async function handleJoin(session: TodaySession) {
    setJoiningId(session.id);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      setJoiningId(null);
      return;
    }

    const { data: studentRow } = await supabase
      .from("students")
      .select("id")
      .eq("profile_id", userData.user.id)
      .single();

    if (!studentRow) {
      setJoiningId(null);
      return;
    }

    const { error } = await supabase.from("virtual_classroom_attendance").upsert(
      {
        session_id: session.id,
        student_id: studentRow.id,
        session_date: todayStr(),
        attendance_status: "joined",
        joined_at: new Date().toISOString(),
      },
      { onConflict: "session_id,student_id,session_date" }
    );

    setJoiningId(null);

    if (error) {
      toast({ title: "Could not log attendance", description: error.message, variant: "destructive" });
      // Still let them join even if attendance logging fails, so they don't miss class
    }

    setSessions((prev) =>
      prev.map((s) => (s.id === session.id ? { ...s, already_joined: true } : s))
    );

    window.open(session.meet_link, "_blank", "noopener,noreferrer");
  }

  function isLive(session: TodaySession) {
    const now = new Date();
    return new Date(session.scheduled_start) <= now && now <= new Date(session.scheduled_end);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-muted-foreground text-sm">Loading today's classes...</p>
        </CardContent>
      </Card>
    );
  }

  if (sessions.length === 0) {
    return null; // nothing scheduled today, don't clutter the dashboard
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Today's Classes</CardTitle>
        <Link to="/virtual-classroom">
          <Button variant="link" size="sm" className="h-auto p-0">Full schedule →</Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between border rounded-lg p-3">
            <div>
              <p className="font-medium">{s.title || s.subject}</p>
              <p className="text-xs text-muted-foreground">
                {s.class_name} {s.section} •{" "}
                {new Date(s.scheduled_start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                {new Date(s.scheduled_end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              {s.todays_topic && (
                <p className="text-xs text-muted-foreground mt-0.5">Today: {s.todays_topic}</p>
              )}
              <div className="flex gap-2 mt-1">
                {isLive(s) && <Badge className="bg-green-100 text-green-800">Live Now</Badge>}
                {s.already_joined && <Badge variant="outline">Joined</Badge>}
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => handleJoin(s)}
              disabled={joiningId === s.id}
              variant={isLive(s) ? "default" : "outline"}
            >
              {joiningId === s.id ? "Joining..." : "Join Class"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}