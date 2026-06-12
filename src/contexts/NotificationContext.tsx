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

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Context ──────────────────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  markAsRead: () => {},
  markAllAsRead: () => {},
});

// ─── Helper ───────────────────────────────────────────────────────────────────

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

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const classIdsRef = useRef<string[]>([]);
  const homeworkAssignmentIdsRef = useRef<string[]>([]);

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

  // ── Load teacher's class_ids and homework assignment_ids ──────────────────
  useEffect(() => {
    if (!user || profile?.role !== "teacher") return;

    const loadTeacherContext = async () => {
      const { data: classTeachers } = await supabase
        .from("class_teachers")
        .select("class_id")
        .eq("teacher_id", user.id);

      classIdsRef.current = (classTeachers || []).map((c) => c.class_id);

      const { data: assignments } = await supabase
        .from("homework_assignments")
        .select("id")
        .eq("teacher_id", user.id);

      homeworkAssignmentIdsRef.current = (assignments || []).map((a) => a.id);
    };

    loadTeacherContext();
  }, [user, profile]);

  // ── Realtime subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    if (!user || profile?.role !== "teacher") return;

    const channels: ReturnType<typeof supabase.channel>[] = [];

    // 1. Homework submitted — INSERT
    const hwInsertChannel = supabase
      .channel("notif_hw_insert")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "homework_submissions" },
        (payload) => {
          const row = payload.new as {
            assignment_id: string;
            student_name: string | null;
            submitted_at: string | null;
          };
          if (!homeworkAssignmentIdsRef.current.includes(row.assignment_id)) return;
          if (!row.submitted_at) return;
          push({
            type: "info",
            title: "Homework submitted",
            message: `${row.student_name || "A student"} submitted their homework.`,
            link: "/teacher",
          });
        }
      )
      .subscribe();
    channels.push(hwInsertChannel);

    // 2. Homework submitted — UPDATE (student updates submitted_at)
    const hwUpdateChannel = supabase
      .channel("notif_hw_update")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "homework_submissions" },
        (payload) => {
          const oldRow = payload.old as { submitted_at: string | null; assignment_id: string };
          const newRow = payload.new as { submitted_at: string | null; assignment_id: string; student_name: string | null };
          if (!homeworkAssignmentIdsRef.current.includes(newRow.assignment_id)) return;
          if (!oldRow.submitted_at && newRow.submitted_at) {
            push({
              type: "info",
              title: "Homework submitted",
              message: `${newRow.student_name || "A student"} submitted their homework.`,
              link: "/teacher",
            });
          }
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

    // 4. Student milestone — diagnostic completed
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
            title: isHighScore ? "Student milestone reached 🎉" : "Diagnostic completed",
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
            message: `"${row.title}"${row.subject ? ` · ${row.subject}` : ""}${row.class_level ? ` · ${row.class_level}` : ""} is ready to review.`,
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
  }, [user, profile, push]);

  // ── Read state ─────────────────────────────────────────────────────────────
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }, []);

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, markAsRead, markAllAsRead }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);