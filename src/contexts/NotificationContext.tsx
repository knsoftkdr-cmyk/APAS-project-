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
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

// ------------------------------------ Context ------------------------------------------

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  markAsRead: () => {},
  markAllAsRead: () => {},
});

// -------------------------------------- Helper ------------------------------------------------

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
    localStorage.setItem(storageKey(userId), JSON.stringify(notifications.slice(0, 50)));
  } catch {
    // storage quota exceeded - ignore
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!user) { setNotifications([]); return; }
    try {
      const raw = localStorage.getItem(`apas_notifications_${user.id}`);
      if (raw) setNotifications(JSON.parse(raw));
    } catch {}
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    try {
      localStorage.setItem(`apas_notifications_${user.id}`, JSON.stringify(notifications.slice(0, 50)));
    } catch {}
  }, [notifications, user?.id]);

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

  const classIdsRef = useRef<string[]>([]);
  const homeworkAssignmentIdsRef = useRef<string[]>([]);
  // Maps assignment_id -> { subject, topic, class_level } for rich notifications
  const assignmentMetaRef = useRef<Record<string, { subject: string | null; topic: string | null; class_level: string }>>({});

  const push = useCallback(
    (n: Omit<Notification, "id" | "is_read" | "created_at">) => {
      const notif = makeNotification(n);
      setNotifications((prev) => [notif, ...prev].slice(0, 50));
      const toastFn =
        n.type === "success"
          ? toast.success
          : n.type === "warning"
          ? toast.warning
          : n.type === "error"
          ? toast.error
          : toast.info;
      toastFn(n.title, { description: n.message, duration: 4000 });
    },
    []
  );

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
        title: `📝 Homework submitted`,
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

    // 5. Request approved / rejected
    const requestChannel = supabase
      .channel("notif_request_status")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "diagnostic_requests",
          filter: `teacher_id=eq.${user.id}`,
        },
        (payload) => {
          const oldRow = payload.old as { status: string };
          const newRow = payload.new as {
            status: string;
            subject: string;
            class_name: string;
            admin_notes: string | null;
          };
          if (oldRow.status === newRow.status) return;

          if (newRow.status === "approved") {
            push({
              type: "success",
              title: "Diagnostic request approved",
              message: `Your ${newRow.subject} request for ${newRow.class_name} was approved.${newRow.admin_notes ? ` Note: ${newRow.admin_notes}` : ""}`,
              link: "/requests",
            });
          } else if (newRow.status === "rejected") {
            push({
              type: "error",
              title: "Diagnostic request rejected",
              message: `Your ${newRow.subject} request for ${newRow.class_name} was rejected.${newRow.admin_notes ? ` Reason: ${newRow.admin_notes}` : ""}`,
              link: "/requests",
            });
          }
        }
      )
      .subscribe();
    channels.push(requestChannel);

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

    // 7. AI content approved (via governance_notifications)
    const govChannel = supabase
      .channel("notif_gov_approved")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "governance_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as {
            event_type: string;
            title: string;
            message: string;
          };
          if (!row.event_type.includes("approved")) return;
          push({
            type: "success",
            title: row.title || "AI content approved",
            message: row.message || "Your AI-generated content has been approved.",
            link: "/curative",
          });
        }
      )
      .subscribe();
    channels.push(govChannel);

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [user, profile, push, loadTeacherContext]);

  // -------------------------------- Read state -------------------------------------------
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }, []);


  // Student: notify when teacher assigns homework
  useEffect(() => {
    if (!user || profile?.role !== "student") return;

    let studentClass: any = null;
    const loadStudentClass = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("class_grade, section, school_id")
        .eq("id", user.id)
        .maybeSingle();
      return data;
    };
    loadStudentClass().then((p) => { studentClass = p; });

    const ch = supabase
      .channel("notif_hw_assigned_student")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "homework_assignments" },
        async (payload) => {
          const row = payload.new as any;
          if (!studentClass) studentClass = await loadStudentClass();
          if (!studentClass) return;
          if (row.class_level !== studentClass.class_grade) return;
          if (row.section && studentClass.section &&
              row.section.toUpperCase() !== studentClass.section.toUpperCase()) return;

          // School-scope check: fetch teacher's school and compare
          const { data: teacherProfile } = await supabase
            .from("profiles").select("school_id")
            .eq("id", row.teacher_id).maybeSingle();
          if (!teacherProfile?.school_id) return;
          if (teacherProfile.school_id !== studentClass.school_id) return;

          let teacherName = "Your teacher";
          const { data: t } = await supabase
            .from("profiles").select("full_name")
            .eq("id", row.teacher_id).maybeSingle();
          if (t?.full_name) teacherName = t.full_name;

          const subject = row.subject || "Homework";
          const topic = row.topic ? ` - ${row.topic}` : "";
          push({
            type: "info",
            title: "New homework assigned",
            message: `${teacherName} assigned ${subject}${topic}.`,
            link: "/dashboard",
          });
        }
      ).subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [user, profile, push]);


  // ── Admin/Principal: notify when a teacher submits a new diagnostic request ──
  useEffect(() => {
    const adminRoles = ["admin", "school_admin", "principal", "hod"];
    if (!user || !profile?.role) return;
    if (!adminRoles.includes(profile.role.toLowerCase())) return;
    if (!profile?.school_id) return;

    const ch = supabase
      .channel("notif_diag_request_admin")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "diagnostic_requests" },
        async (payload) => {
          const row = payload.new as any;
          const { data: teacherProf } = await supabase
            .from("profiles")
            .select("full_name, school_id")
            .eq("id", row.teacher_id)
            .maybeSingle();
          if (teacherProf.school_id !== profile.school_id) return;
          // single tenant - all admins see all requests

          push({
            type: "warning",
            title: "New Diagnostic Request",
            message: `${teacherProf.full_name || "A teacher"} submitted a diagnostic request for ${row.class_name} - ${row.section} (${row.subject}).`,
            link: "/admin-panel",
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [user, profile, push]);
  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, markAsRead, markAllAsRead }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);

