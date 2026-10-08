import { lazy } from "react";
import { useAuth } from "@/contexts/AuthContext";

const TeacherStudentWatch = lazy(() => import("./TeacherStudentWatch"));
const EarlyWarningDashboard = lazy(() => import("./EarlyWarningDashboard"));

/** Teachers get Early Warning as a tab next to At-Risk / Behaviour; admins, principals and HODs keep the standalone page. */
export default function EarlyWarningRoute() {
  const { profile } = useAuth();
  return profile?.role === "teacher" ? <TeacherStudentWatch /> : <EarlyWarningDashboard />;
}
