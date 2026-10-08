import { lazy } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const TeacherClassInsights = lazy(() => import("./TeacherClassInsights"));
const ClassMasteryDashboard = lazy(() => import("./ClassMasteryDashboard"));
const ClassVelocityDashboard = lazy(() => import("./ClassVelocityDashboard"));

/** Teachers get Class Mastery + Class Velocity as tabs on one page; admins, principals, HODs keep the standalone pages. */
export default function ClassInsightsRoute() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  if (profile?.role === "teacher") return <TeacherClassInsights />;
  return pathname.startsWith("/class-velocity") ? <ClassVelocityDashboard /> : <ClassMasteryDashboard />;
}
