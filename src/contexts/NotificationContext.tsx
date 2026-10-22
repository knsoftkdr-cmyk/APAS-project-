import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  useRef,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  inferCategory, isDuplicateOfRecent, mapGovernanceRow, mergeNotifications,
  type NotificationCategory,
} from "@/lib/notificationModel";

// ---------------------------------------- Types ---------------------------------------------------

export type NotificationType = "info" | "success" | "warning" | "error";

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  is_read: boolean;
  created_at: string;
  link?: string;

  assignment_id?: string;
  worksheet_assignment_id?: string;
  sender_id?: string;

  /** governance_notifications.event_type, or a short name for notifications raised in the browser. */
  event_type?: string;
  category?: NotificationCategory;
  /** "db" = backed by a governance_notifications row, so read/dismiss are saved there. */
  source?: "db" | "local";
  /** Identity for the live duplicate guard (e.g. the sender, so two senders' messages never merge). */
  dedupe_key?: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  markHomeworkNotificationAsRead: (assignmentId: string) => void;
markWorksheetNotificationAsRead: (worksheetAssignmentId: string) => void;
  markMessageNotificationsAsRead: (senderId: string) => void;
  setActiveMessageThreadId: (id: string | null) => void;
  /** Remove a notification from the bell and inbox. Saved to the database for database-backed rows. */
  dismiss: (id: string) => void;
}

// ------------------------------------ Context ------------------------------------------

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  markAsRead: () => {},
  markAllAsRead: () => {},
  markHomeworkNotificationAsRead: () => {},
  markWorksheetNotificationAsRead: () => {},
  markMessageNotificationsAsRead: () => {},
  setActiveMessageThreadId: () => {},
  dismiss: () => {},
});

// -------------------------------------- Helper ------------------------------------------------
const MAX_NOTIFICATIONS = 200;

/** Fire-and-forget banner for a new notification. */
function announce(n: { type: NotificationType; title: string; message: string }) {
  const toastFn =
    n.type === "success" ? toast.success : n.type === "warning" ? toast.warning : n.type === "error" ? toast.error : toast.info;
  toastFn(n.title, { description: n.message, duration: 4000 });
}

function loadIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveIdSet(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(ids).slice(-200)));
  } catch {
    /* ignore */
  }
}


function makeNotification(
  overrides: Omit<Notification, "id" | "is_read" | "created_at">
): Notification {
  return {
    ...overrides,
    id: crypto.randomUUID(),
    is_read: false,
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------- Provider -----------------------------------------
// ---------------------------------------Storage helpers-------------------------------------
function storageKey(userId: string) {
  return `apas_notifications_${userId}`;
}

function loadFromStorage(userId: string): Notification[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as Notification[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(userId: string, notifications: Notification[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
  } catch {
    // storage quota exceeded - ignore
  }
}

function notifiedHomeworkKey(userId: string) {
  return `apas_notified_homework_${userId}`;
}

function loadNotifiedHomework(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(notifiedHomeworkKey(userId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveNotifiedHomework(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(
      notifiedHomeworkKey(userId),
      JSON.stringify(Array.from(ids))
    );
  } catch {}
}

function notifiedWorksheetKey(userId: string) {
  return `apas_notified_worksheets_${userId}`;
}

function loadNotifiedWorksheets(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(notifiedWorksheetKey(userId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveNotifiedWorksheets(
  userId: string,
  ids: Set<string>
) {
  try {
    localStorage.setItem(
      notifiedWorksheetKey(userId),
      JSON.stringify(Array.from(ids))
    );
  } catch {}
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Always-current copy of the list, so callbacks that must not re-create on every change can still read it.
  const notificationsRef = useRef<Notification[]>([]);
  notificationsRef.current = notifications;
  
  // useEffect(() => {
  //   if (!user) { setNotifications([]); return; }
  //   try {
  //     const raw = localStorage.getItem(`apas_notifications_${user.id}`);
  //     if (raw) setNotifications(JSON.parse(raw));
  //   } catch {}
  // }, [user?.id]);

  // useEffect(() => {
  //   if (!user) return;
  //   try {
  //     localStorage.setItem(`apas_notifications_${user.id}`, JSON.stringify(notifications.slice(0, 50)));
  //   } catch {}
  // }, [notifications, user?.id]);

  // -------------------------------------Load persisted notifications when user logs in ------------------------------------
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    setNotifications(loadFromStorage(user.id));
  }, [user?.id]);

  // ------------------------------------ Persist to localStorage whenever notifications change ------------------------------------
  useEffect(() => {
    if (!user) return;
    saveToStorage(user.id, notifications);
  }, [notifications, user?.id]);
  // ------------------------------------ Load this user's recent governance_notifications on login ------------------------------------
  // Newest 100 rows, read AND unread, so the inbox has history. RLS returns only this user's own rows.
  // The database now holds read/dismissed state, so it wins; the one exception is anything already read on this
  // device before read state was saved to the database, which stays read (and is synced up below).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const cols = "id, event_type, title, message, is_read, created_at";
      const query = (select: string) =>
        (supabase as any).from("governance_notifications").select(select).eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
      let res = await query(`${cols}, dismissed_at`);
      // dismissed_at comes from migration 20261024000000; keep working until it is applied.
      if (res.error) res = await query(cols);
      const rows = (res.data ?? null) as Array<Record<string, any>> | null;
      if (cancelled || !rows) return;

      const dismissed = new Set(rows.filter((r) => r.dismissed_at).map((r) => r.id as string));
      const live = rows.filter((r) => !r.dismissed_at);
      const localRead = new Set(notificationsRef.current.filter((n) => n.is_read).map((n) => n.id));

      const toSync = live.filter((r) => !r.is_read && localRead.has(r.id)).map((r) => r.id as string);
      if (toSync.length > 0) {
        void (supabase as any).from("governance_notifications").update({ is_read: true }).in("id", toSync).eq("user_id", user.id);
      }

      setNotifications((prev) => {
        const prevRead = new Set(prev.filter((n) => n.is_read).map((n) => n.id));
        const mapped: Notification[] = live.map((r) => {
          const n = mapGovernanceRow(r as any, profile?.role) as Notification;
          return prevRead.has(n.id) ? { ...n, is_read: true } : n;
        });
        return mergeNotifications(mapped, prev.filter((n) => !dismissed.has(n.id))).slice(0, MAX_NOTIFICATIONS) as Notification[];
      });
    })();
    return () => { cancelled = true; };
  }, [user?.id, profile?.role]);

  const classIdsRef = useRef<string[]>([]);
  const homeworkAssignmentIdsRef = useRef<string[]>([]);
  // Maps assignment_id -> { subject, topic, class_level } for rich notifications
  const assignmentMetaRef = useRef<Record<string, { subject: string | null; topic: string | null; class_level: string }>>({});
  // Tracks which sender's message thread is currently open on screen, so we
  // can skip creating a bell notification for messages already being viewed.
  const activeMessageThreadIdRef = useRef<string | null>(null);
  const setActiveMessageThreadId = useCallback((id: string | null) => {
    activeMessageThreadIdRef.current = id;
  }, []);

  const push = useCallback(
    (n: Omit<Notification, "id" | "is_read" | "created_at">) => {
      const notif: Notification = {
        ...makeNotification(n),
        source: n.source ?? "local",
        category: n.category ?? inferCategory({ event_type: n.event_type, title: n.title, link: n.link }),
      };
      // The same event arriving twice (two channels, a re-subscribed channel) notifies once.
      if (isDuplicateOfRecent(notificationsRef.current, notif)) return;
      notificationsRef.current = [notif, ...notificationsRef.current];
      setNotifications((prev) => [notif, ...prev].slice(0, MAX_NOTIFICATIONS));
      announce(notif);
    },
    []
  );

  /** A new governance_notifications row delivered by realtime. De-duplicated by its database id. */
  const pushRow = useCallback((notif: Notification) => {
    if (notificationsRef.current.some((n) => n.id === notif.id)) return;
    notificationsRef.current = [notif, ...notificationsRef.current];
    setNotifications((prev) => (prev.some((n) => n.id === notif.id) ? prev : [notif, ...prev].slice(0, MAX_NOTIFICATIONS)));
    if (!notif.is_read) announce(notif);
  }, []);

  // ---------- Load teacher's class_ids and homework assignment_ids (school-scoped) -------
  const loadTeacherContext = useCallback(async () => {
    if (!user || profile?.role !== "teacher") return;

    const { data: classTeachers } = await supabase
      .from("class_teachers")
      .select("class_id")
      .eq("teacher_id", user.id);

    classIdsRef.current = (classTeachers || []).map((c) => c.class_id);

    // Load assignments scoped to this teacher only (school isolation via teacher_id)
    const { data: assignments } = await supabase
      .from("homework_assignments")
      .select("id, subject, topic, class_level")
      .eq("teacher_id", user.id);

    homeworkAssignmentIdsRef.current = (assignments || []).map((a) => a.id);

    // Build meta map for rich notification messages
    const meta: Record<string, { subject: string | null; topic: string | null; class_level: string }> = {};
    for (const a of assignments || []) {
      meta[a.id] = { subject: a.subject, topic: a.topic, class_level: a.class_level };
    }
    assignmentMetaRef.current = meta;
  }, [user, profile]);

  useEffect(() => {
    loadTeacherContext();
  }, [loadTeacherContext]);

  // --------------------------- Realtime subscriptions -------------------------------
  useEffect(() => {
    if (!user || profile?.role !== "teacher") return;

    const channels: ReturnType<typeof supabase.channel>[] = [];

    // Helper: build a rich homework notification message
    const buildHwMessage = (
      studentName: string,
      assignmentId: string,
      submissionPct: number | null
    ): { title: string; message: string } => {
      const meta = assignmentMetaRef.current[assignmentId];
      const subject = meta?.subject || "Homework";
      const topic = meta?.topic ? ` - ${meta.topic}` : "";
      const pctText = submissionPct != null ? ` (${submissionPct}% answered)` : "";
      return {
        title: `Homework submitted`,
        message: `${studentName} submitted ${subject}${topic}${pctText}.`,
      };
    };

    // Helper: verify submission belongs to this teacher's school by checking
    // that the assignment's teacher_id matches our user and the student's
    // school_id matches our school_id (double-guard)
    const verifyOwnership = async (
      assignmentId: string,
      studentId: string | null
    ): Promise<boolean> => {
      // Primary check: is this assignment owned by the current teacher?
      if (!homeworkAssignmentIdsRef.current.includes(assignmentId)) return false;

      // Secondary check: does the student belong to the same school?
      if (!studentId || !profile?.school_id) return true; // skip if no school_id on profile
      const { data: stu } = await supabase
        .from("students")
        .select("school_id")
        .eq("profile_id", studentId)
        .maybeSingle();
      if (stu && stu.school_id && stu.school_id !== profile.school_id) return false;
      return true;
    };

    // 1. Homework submitted - INSERT (fresh submission row)
    const hwInsertChannel = supabase
      .channel("notif_hw_insert")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "homework_submissions" },
        async (payload) => {
          const row = payload.new as {
            assignment_id: string;
            student_id: string | null;
            student_name: string | null;
            submitted_at: string | null;
            submission_percentage: number | null;
            completed: boolean | null;
          };

          // Only fire when this is an actual completed submission
          if (!row.submitted_at && !row.completed) return;

          const owned = await verifyOwnership(row.assignment_id, row.student_id);
          if (!owned) return;

          // If assignmentMetaRef is stale (new assignment added after login), refresh
          if (!assignmentMetaRef.current[row.assignment_id]) {
            await loadTeacherContext();
          }

          const studentName = row.student_name || "A student";
          const { title, message } = buildHwMessage(studentName, row.assignment_id, row.submission_percentage);
          push({ type: "success", title, message, link: "/analytics" });
        }
      )
      .subscribe();
    channels.push(hwInsertChannel);

    // 2. Homework submitted - UPDATE (student answers & completes an existing row)
    const hwUpdateChannel = supabase
      .channel("notif_hw_update")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "homework_submissions" },
        async (payload) => {
          const oldRow = payload.old as {
            submitted_at: string | null;
            completed: boolean | null;
            assignment_id: string;
          };
          const newRow = payload.new as {
            submitted_at: string | null;
            completed: boolean | null;
            assignment_id: string;
            student_id: string | null;
            student_name: string | null;
            submission_percentage: number | null;
          };

          // Fire only on the transition: not-submitted â†’ submitted
          const justSubmitted =
            (!oldRow.submitted_at && !!newRow.submitted_at) ||
            (!oldRow.completed && !!newRow.completed);
          if (!justSubmitted) return;

          const owned = await verifyOwnership(newRow.assignment_id, newRow.student_id);
          if (!owned) return;

          if (!assignmentMetaRef.current[newRow.assignment_id]) {
            await loadTeacherContext();
          }

          const studentName = newRow.student_name || "A student";
          const { title, message } = buildHwMessage(studentName, newRow.assignment_id, newRow.submission_percentage);
          push({ type: "success", title, message, link: "/analytics" });
        }
      )
      .subscribe();
    channels.push(hwUpdateChannel);

    // 3. Performance drop
    const perfChannel = supabase
      .channel("notif_perf_drop")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "performance_records" },
        async (payload) => {
          const row = payload.new as {
            student_id: string;
            posttest_score: number | null;
            pretest_score: number | null;
          };
          if (row.posttest_score === null || row.pretest_score === null) return;
          const drop = row.pretest_score - row.posttest_score;
          if (drop < 20) return;

          // Verify this student is in one of teacher's classes
          if (classIdsRef.current.length === 0) return;
          const { data: match } = await supabase
            .from("class_students")
            .select("student_id")
            .in("class_id", classIdsRef.current)
            .eq("student_id", row.student_id)
            .maybeSingle();
          if (!match) return;

          // Get student name
          let studentName = "A student";
          const { data: stu } = await supabase
            .from("students")
            .select("profile_id")
            .eq("id", row.student_id)
            .maybeSingle();
          if (stu?.profile_id) {
            const { data: prof } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", stu.profile_id)
              .maybeSingle();
            studentName = prof?.full_name || "A student";
          }

          push({
            type: "warning",
            title: "Performance drop detected",
            message: `${studentName}'s score dropped by ${Math.round(drop)} points. Consider early intervention.`,
            link: "/analytics",
          });
        }
      )
      .subscribe();
    channels.push(perfChannel);

    // 4. Student milestone - diagnostic completed
    const diagChannel = supabase
      .channel("notif_diag_done")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "diagnostic_submissions" },
        async (payload) => {
          const row = payload.new as {
            student_id: string;
            request_id: string;
            score: number;
            total_questions: number;
          };

          const { data: diagReq } = await supabase
            .from("diagnostic_requests")
            .select("teacher_id, subject, class_name")
            .eq("id", row.request_id)
            .maybeSingle();
          if (!diagReq || diagReq.teacher_id !== user.id) return;

          let studentName = "A student";
          const { data: stu } = await supabase
            .from("students")
            .select("profile_id")
            .eq("id", row.student_id)
            .maybeSingle();
          if (stu?.profile_id) {
            const { data: prof } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", stu.profile_id)
              .maybeSingle();
            studentName = prof?.full_name || "A student";
          }

          const pct =
            row.total_questions > 0
              ? Math.round((row.score / row.total_questions) * 100)
              : 0;
          const isHighScore = pct >= 80;

          push({
            type: isHighScore ? "success" : "info",
            title: isHighScore ? "Student milestone reached ðŸŽ‰" : "Diagnostic completed",
            message: `${studentName} completed the ${diagReq.subject} diagnostic for ${diagReq.class_name} with ${pct}%.`,
            link: "/diagnostic",
          });
        }
      )
      .subscribe();
    channels.push(diagChannel);

    // 6. AI lesson plan ready
    const lessonChannel = supabase
      .channel("notif_ai_lesson")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lessons",
          filter: `teacher_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as {
            title: string;
            subject: string | null;
            class_level: string | null;
            ai_generated: boolean | null;
          };
          if (!row.ai_generated) return;
          push({
            type: "info",
            title: "AI lesson plan ready",
            message: `"${row.title}"${row.subject ? ` Â· ${row.subject}` : ""}${row.class_level ? ` Â· ${row.class_level}` : ""} is ready to review.`,
            link: "/curative",
          });
        }
      )
      .subscribe();
    channels.push(lessonChannel);

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [user, profile, push, loadTeacherContext]);

  // --------------------------- Realtime: this user's governance_notifications (ALL roles) ---------------------------
  // Replaces the teacher-only "approved" and "transport" channels (which also pushed a second copy of rows the
  // login load already shows) and the old admin-only diagnostic channel (the database trigger already writes that
  // notification to each admin). Realtime delivers only rows matching user_id = this user, and RLS applies on top.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notif_governance_${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "governance_notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as any;
          if (!row || row.user_id !== user.id || row.dismissed_at) return;
          pushRow(mapGovernanceRow(row, profile?.role) as Notification);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "governance_notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          // Read or dismissed on another device/tab.
          const row = payload.new as any;
          if (!row || row.user_id !== user.id) return;
          if (row.dismissed_at) {
            setNotifications((prev) => prev.filter((n) => n.id !== row.id));
          } else if (row.is_read) {
            setNotifications((prev) => prev.map((n) => (n.id === row.id && !n.is_read ? { ...n, is_read: true } : n)));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, profile?.role, pushRow]);

  // -------------------------------- Read state -------------------------------------------
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAsRead = useCallback((id: string) => {
    const target = notificationsRef.current.find((n) => n.id === id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    // Database-backed rows keep their read state across devices.
    if (user && target?.source === "db" && !target.is_read) {
      void (supabase as any).from("governance_notifications").update({ is_read: true }).eq("id", id).eq("user_id", user.id);
    }
  }, [user?.id]);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    if (user) {
      // Covers every unread row of this user, including ones older than what is loaded in memory.
      void (supabase as any).from("governance_notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    }
  }, [user?.id]);

  const dismiss = useCallback((id: string) => {
    const target = notificationsRef.current.find((n) => n.id === id);
    notificationsRef.current = notificationsRef.current.filter((n) => n.id !== id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (user && target?.source === "db") {
      void (async () => {
        // Soft dismiss (the row stays for analytics). Falls back to "read" if dismissed_at is not migrated yet.
        const r = await (supabase as any).from("governance_notifications").update({ is_read: true, dismissed_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
        if (r.error) await (supabase as any).from("governance_notifications").update({ is_read: true }).eq("id", id).eq("user_id", user.id);
      })();
    }
  }, [user?.id]);

const markHomeworkNotificationAsRead = useCallback((assignmentId: string) => {
  console.log("Looking for assignment:", assignmentId);

  setNotifications((prev) => {
    console.log("Notifications:", prev);

    return prev.map((n) => {
      console.log(
        "Notification assignment_id:",
        n.assignment_id,
        "Matches:",
        n.assignment_id === assignmentId
      );

      return n.assignment_id === assignmentId
        ? { ...n, is_read: true }
        : n;
    });
  });
}, []);

const markWorksheetNotificationAsRead = useCallback(
  (worksheetAssignmentId: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.worksheet_assignment_id === worksheetAssignmentId
          ? { ...n, is_read: true }
          : n
      )
    );
  },
  []
);

const markMessageNotificationsAsRead = useCallback((senderId: string) => {
  setNotifications((prev) =>
    prev.map((n) =>
      n.sender_id === senderId ? { ...n, is_read: true } : n
    )
  );
}, []);


  // Student: notify when teacher assigns homework (polling)
  const hwLastCheckedRef = useRef<string>(new Date().toISOString());
  const hwPollSetupRef = useRef<string | null>(null);
  const notifiedHomeworkIdsRef = useRef<Set<string>>(new Set());
  const worksheetPollSetupRef = useRef<string | null>(null);
  const notifiedWorksheetIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
  if (!user) return;
  notifiedHomeworkIdsRef.current =
    loadNotifiedHomework(user.id);
}, [user?.id]);

useEffect(() => {
  if (!user) return;
  notifiedWorksheetIdsRef.current =
    loadNotifiedWorksheets(user.id);
}, [user?.id]);

  useEffect(() => {
    if (!user || profile?.role !== "student") return;
    // Only set up the interval once per user session — avoid tearing down/rebuilding
    // on every render, which was resetting lastChecked and causing missed events.
    if (hwPollSetupRef.current === user.id) return;
    hwPollSetupRef.current = user.id;
    const normalizeClass = (c: string | null | undefined) => (c || "").replace(/[^0-9]/g, "").trim();
    let intervalId: any = null;
    let cancelled = false;
    const checkNewHomework = async () => {
      if (cancelled) return;
      const { data: studentClass } = await supabase
        .from("profiles")
        .select("class_grade, section, school_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!studentClass || cancelled) return;

      const checkFrom = hwLastCheckedRef.current;
      hwLastCheckedRef.current = new Date().toISOString();
      const { data: newAssignments, error: hwErr } = await supabase
  .from("homework_assignments")
  .select("id, class_level, section, subject, topic, teacher_id, school_id, assigned_at")
  .order("assigned_at", { ascending: false })
  .limit(10);

      if (!newAssignments || newAssignments.length === 0) return;
      for (const row of newAssignments) {
        if (normalizeClass(row.class_level) !== normalizeClass(studentClass.class_grade)) continue;
        if (row.section && studentClass.section &&
            row.section.toUpperCase() !== studentClass.section.toUpperCase()) continue;
        if (notifiedHomeworkIdsRef.current.has(row.id))
  continue;

notifiedHomeworkIdsRef.current.add(row.id);

saveNotifiedHomework(
  user.id,
  notifiedHomeworkIdsRef.current
);
        let teacherName = "Your teacher";
        if (row.teacher_id) {
          const { data: t } = await supabase
            .from("profiles").select("full_name")
            .eq("id", row.teacher_id).maybeSingle();
          if (t?.full_name) teacherName = t.full_name;
        }
        const subject = row.subject || "Homework";
        const topic = row.topic ? ` - ${row.topic}` : "";
        push({
          type: "info",
          title: "New homework assigned",
          message: `${teacherName} assigned ${subject}${topic}.`,
          link: "/dashboard",

          assignment_id: row.id,
        });
      }
    };
    checkNewHomework();
    intervalId = setInterval(checkNewHomework, 30000);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      hwPollSetupRef.current = null;
    };

  }, [user, profile, push]);

useEffect(() => {
  if (!user || profile?.role !== "student") return;

  if (worksheetPollSetupRef.current === user.id) return;
  worksheetPollSetupRef.current = user.id;

  const normalizeClass = (c: string | null |undefined) =>
    (c || "").replace(/[^0-9]/g, "").trim();

  let intervalId: any = null;
  let cancelled = false;

  const checkNewWorksheets = async () => {

  const { data: studentClass } = await supabase
    .from("profiles")
    .select("class_grade, section, school_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!studentClass || cancelled) return;

  const { data: worksheets } = await supabase
  .from("worksheet_assignments")
  .select(`
      id,
      class_level,
      section,
      teacher_id,
      school_id,
      assigned_at,
      worksheet_id,
      worksheets (
        subject,
        chapter
      )
  `)
  .eq("status", "active")
  .order("assigned_at", { ascending: false })
  .limit(10);

  if (!worksheets) return;
for (const row of worksheets) {
  if (
  normalizeClass(row.class_level) !==
  normalizeClass(studentClass.class_grade)
)
  continue;

  if (
  row.section &&
  studentClass.section &&
  row.section.toUpperCase() !==
    studentClass.section.toUpperCase()
)
  continue;
if (row.school_id !== studentClass.school_id)
  continue;

if (notifiedWorksheetIdsRef.current.has(row.id))
  continue;
notifiedWorksheetIdsRef.current.add(row.id);
saveNotifiedWorksheets(
  user.id,
  notifiedWorksheetIdsRef.current
);

  let teacherName = "Your teacher";

if (row.teacher_id) {
  const { data: teacher } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", row.teacher_id)
    .maybeSingle();

  if (teacher?.full_name)
    teacherName = teacher.full_name;
}
push({
  type: "info",
  title: "New worksheet assigned",
  message: `${teacherName} assigned ${
    row.worksheets?.subject || "a worksheet"
  }${
    row.worksheets?.chapter
      ? ` - ${row.worksheets.chapter}`
      : ""
  }.`,
  link: "/dashboard",
  worksheet_assignment_id: row.id,
});
};
};

checkNewWorksheets();

intervalId = setInterval(checkNewWorksheets, 30000);

return () => {
  cancelled = true;

  if (intervalId)
    clearInterval(intervalId);

  worksheetPollSetupRef.current = null;
};

}, [user, profile, push]);

  // Student: notify when an exam is assigned (polling, like homework/worksheets above). RLS returns only the
  // assignments this student can see (their class or named students, status active).
  const examPollSetupRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || profile?.role !== "student") return;
    if (examPollSetupRef.current === user.id) return;
    examPollSetupRef.current = user.id;
    const key = `apas_notified_exams_${user.id}`;
    let cancelled = false;
    const check = async () => {
      if (cancelled) return;
      const { data, error } = await (supabase as any)
        .from("generated_assessment_paper_assignments")
        .select("id, title, due_at, created_at")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error || !data || cancelled) return;
      const seen = loadIdSet(key);
      const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
      let changed = false;
      for (const row of data as Array<{ id: string; title: string; due_at: string | null; created_at: string }>) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        changed = true;
        if (Date.parse(row.created_at) < weekAgo) continue; // never announce old exams just because this is the first check
        push({
          type: "info",
          title: "New exam assigned",
          message: `${row.title}${row.due_at ? ` - due ${new Date(row.due_at).toLocaleDateString()}` : ""}.`,
          link: "/my-exams",
          event_type: "exam_assigned",
          category: "academics",
          dedupe_key: `exam:${row.id}`,
        });
      }
      if (changed) saveIdSet(key, seen);
    };
    void check();
    const intervalId = setInterval(check, 60000);
    return () => { cancelled = true; clearInterval(intervalId); examPollSetupRef.current = null; };
  }, [user, profile, push]);

  // ── Messages from teachers / admins (works for any recipient role: student, parent, admin) ──
  // Two sources feed the bell, both keyed by the message row id (`msg-<id>`) so nothing shows twice:
  //   1. a catch-up read of the user's UNREAD teacher_messages when they sign in, so a message sent while
  //      they were offline (the push on the phone) is also in the bell. Realtime alone only fires while the
  //      app is open, which is why the push arrived but the in-app list was empty.
  //   2. the live realtime INSERT, for messages that arrive while the app is open.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const messageLink =
      profile?.role === "parent" ? "/parent-communication"
      : profile?.role === "teacher" ? "/teacher-communication"
      : profile?.role === "student" ? "/student-communication"
      : ["admin", "principal", "hod", "school_admin"].includes(profile?.role ?? "") ? "/admin-communication"
      : profile?.role === "driver" ? "/driver/communication"
      : undefined;

    type MsgRow = {
      id: string; sender_id: string; message_type: string; message: string | null;
      broadcast_label?: string | null; created_at: string;
    };

    const nameCache: Record<string, string> = {};
    const senderName = async (id: string) => {
      if (nameCache[id]) return nameCache[id];
      const { data } = await supabase.from("profiles").select("full_name").eq("id", id).maybeSingle();
      return (nameCache[id] = data?.full_name || "Someone");
    };

    const toNotification = async (row: MsgRow, isRead: boolean): Promise<Notification> => {
      const name = await senderName(row.sender_id);
      const where = row.broadcast_label ? ` to ${row.broadcast_label}` : "";
      const title =
        row.message_type === "meeting_request" ? `Meeting request from ${name}`
        : row.message_type === "appreciation" ? `Appreciation note from ${name}`
        : row.message_type === "behaviour" ? `Behaviour update from ${name}`
        : `${name} sent a message${where}`;
      const body = (row.message || "").trim();
      return {
        id: `msg-${row.id}`,
        title,
        message: body ? (body.length > 140 ? `${body.slice(0, 140)}…` : body) : "Open Communication Center to view it.",
        type: "info",
        is_read: isRead,
        created_at: row.created_at || new Date().toISOString(),
        link: messageLink,
        sender_id: row.sender_id,
        event_type: "message",
        category: "messages",
        source: "local",
        dedupe_key: `msg:${row.id}`,
      };
    };

    const addSilently = (list: Notification[]) => {
      const fresh = list.filter((n) => !notificationsRef.current.some((e) => e.id === n.id));
      if (fresh.length === 0) return;
      notificationsRef.current = mergeNotifications(fresh, notificationsRef.current) as Notification[];
      setNotifications((prev) => {
        const have = new Set(prev.map((n) => n.id));
        return (mergeNotifications(fresh.filter((n) => !have.has(n.id)), prev) as Notification[]).slice(0, MAX_NOTIFICATIONS);
      });
    };

    // 1. catch-up on sign-in (and every 2 min as a safety net if realtime is not enabled on the table)
    const catchUp = async () => {
      const { data, error } = await supabase
        .from("teacher_messages" as any)
        .select("id, sender_id, message_type, message, broadcast_label, created_at")
        .eq("recipient_id", user.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(30);
      if (cancelled || error || !data) return;
      const rows = (data as unknown as MsgRow[]).filter((r) => activeMessageThreadIdRef.current !== r.sender_id);
      addSilently(await Promise.all(rows.map((r) => toNotification(r, false))));
    };
    void catchUp();
    const intervalId = setInterval(() => void catchUp(), 120000);

    // 2. live
    const ch = supabase
      .channel("notif_teacher_message")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "teacher_messages", filter: `recipient_id=eq.${user.id}` },
        async (payload) => {
          const row = payload.new as MsgRow;
          // Already viewing this exact conversation — no need to notify
          if (activeMessageThreadIdRef.current === row.sender_id) return;
          const notif = await toNotification(row, false);
          if (!cancelled) pushRow(notif);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      supabase.removeChannel(ch);
    };
  }, [user, profile, pushRow]);

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, markAsRead, markAllAsRead, dismiss, markHomeworkNotificationAsRead, markWorksheetNotificationAsRead, markMessageNotificationsAsRead, setActiveMessageThreadId }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
