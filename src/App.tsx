import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { LanguageProvider } from "@/i18n/LanguageContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleGuard } from "@/components/RoleGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { lazy } from "react";
import { useEffect, useState } from "react";
import SplashScreen from "./pages/SplashScreen";
import { initializePushNotifications } from "./services/pushNotifications";
import { Capacitor } from "@capacitor/core";
import TeacherWorkspaceDashboard from "@/pages/TeacherWorkspaceDashboard";

// Lazy load all page components for code splitting
const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const RequestDemo = lazy(() => import("./pages/RequestDemo"));
const Register = lazy(() => import("./pages/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const StudentProfile360 = lazy(() => import("./pages/StudentProfile360"));
const Worksheets = lazy(() => import("./pages/Worksheets"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Curative = lazy(() => import("./pages/Curative"));
const Submissions = lazy(() => import("./pages/Submissions"));
const AssessmentEvaluation = lazy(() => import("./pages/AssessmentEvaluation"));
const EntryTicket = lazy(() => import("./pages/EntryTicket"));
const Requests = lazy(() => import("./pages/Requests"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const TeacherPanel = lazy(() => import("./pages/TeacherPanel"));
const Diagnostic = lazy(() => import("./pages/Diagnostic"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const AcademicTests = lazy(() => import("./pages/AcademicTests"));
const Gamification = lazy(() => import("./pages/Gamification"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const PredictionDashboard = lazy(() => import("./pages/PredictionDashboard"));
const AITutor = lazy(() => import("./pages/AITutor"));
const AIKnowledgeHub = lazy(() => import("./pages/AIKnowledgeHub"));
const SchoolAnalytics = lazy(() => import("./pages/SchoolAnalytics"));
const Alerts = lazy(() => import("./pages/Alerts"));
const SemesterEngine = lazy(() => import("./pages/SemesterEngine"));
const HouseManagement = lazy(() => import("./pages/HouseManagement"));
const ReportCards = lazy(() => import("./pages/ReportCards"));
const AlumniPage = lazy(() => import("./pages/AlumniPage"));
const ExamSeating = lazy(() => import("./pages/ExamSeating"));
const HallTicketEngine = lazy(() => import("./pages/HallTicketEngine"));
const InvigilationManagement = lazy(() => import("./pages/InvigilationManagement"));
const AutomationWorkflows = lazy(() => import("./pages/AutomationWorkflows"));
const SecurityCenter = lazy(() => import("./pages/SecurityCenter"));
const Billing = lazy(() => import("./pages/Billing"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SuperAdminPanel = lazy(() => import("./pages/SuperAdminPanel"));
const KNSoftAdminPanel = lazy(() => import("./pages/KNSoftAdminPanel"));
const BillingDashboard = lazy(() => import("./pages/BillingDashboard"));
const SecurityDashboard = lazy(() => import("./pages/SecurityDashboard"));
const AICostMonitoringDashboard = lazy(() => import("./pages/AICostMonitoringDashboard"));
const CacheManagementDashboard = lazy(() => import("./pages/CacheManagementDashboard"));
const OCRProcessingDashboard = lazy(() => import("./pages/OCRProcessingDashboard"));
const NotificationDashboard = lazy(() => import("./pages/NotificationDashboard"));
const RiskPredictionDashboard = lazy(() => import("./pages/RiskPredictionDashboard"));
const TeacherAtRiskStudents = lazy(() => import("./pages/TeacherAtRiskStudents"));
const TeacherBehaviourDashboard = lazy(() => import("./pages/TeacherBehaviourDashboard"));
const TeacherProfessionalDevelopment = lazy(() => import("./pages/TeacherProfessionalDevelopment"));
const TeacherCommunicationCenter = lazy(() => import("./pages/TeacherCommunicationCenter"));
const AITeacherAssistant = lazy(() => import("./pages/AITeacherAssistant"));
const KnowledgeGraphDashboard = lazy(() => import("./pages/KnowledgeGraphDashboard"));
const SchoolIntelligenceDashboard = lazy(() => import("./pages/SchoolIntelligenceDashboard"));
const AutomationDashboard = lazy(() => import("./pages/AutomationDashboard"));
const MultiTenantDashboard = lazy(() => import("./pages/MultiTenantDashboard"));
const HODDashboard = lazy(() => import("./pages/HODDashboard"));
const SyllabusOverview = lazy(() => import("./pages/SyllabusOverview"));
const ParentDashboard = lazy(() => import("./pages/ParentDashboard"));
const AppointmentBooking = lazy(() => import("./pages/AppointmentBooking"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const UpdatePassword = lazy(() => import("./pages/UpdatePassword"));
const TimetablePage = lazy(() => import("./pages/TimetablePage"));
import AttendanceMarking from "@/pages/AttendanceMarking";
import StudentTransfers from "@/pages/StudentTransfers";
const AcademicCalendar = lazy(() => import("./pages/AcademicCalendar"));
const TeacherCommunities = lazy(() => import("./pages/TeacherCommunities"));
const ExecutiveReporting = lazy(() => import("./pages/ExecutiveReporting"));
const PredictiveAnalytics = lazy(() => import("./pages/PredictiveAnalytics"));

// Lazy load the teacher appointments page component
const TeacherAppointmentsPage = lazy(() => import("./pages/TeacherAppointments"));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <LoadingSpinner size="lg" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
    },
  },
});

export default function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(false);
      if (Capacitor.isNativePlatform()) {
        try {
          await initializePushNotifications();
        } catch (error) {
          console.error("Push notification initialization failed:", error);
        }
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return <SplashScreen />;
  }
  
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <LanguageProvider>
                <NotificationProvider>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      <Route path="/" element={<Landing />} />
                      <Route path="/login" element={<Login />} />
                      <Route path="/request-demo" element={<RequestDemo />} />
                      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                      <Route path="/student-profile" element={<ProtectedRoute><RoleGuard allowedRoles={["student", "parent"]}><StudentProfile360 /></RoleGuard></ProtectedRoute>} />
                      <Route path="/student-dashboard" element={<ProtectedRoute><RoleGuard allowedRoles={["student", "admin", "parent"]}><StudentDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/teacher" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "school_admin", "hod", "principal"]}><TeacherPanel /></RoleGuard></ProtectedRoute>} />
                      
                      {/* TEACHER ROUTE ECOSYSTEM SYSTEM */}
                      <Route path="/teacher-workspace" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "school_admin", "hod", "principal"]}><TeacherWorkspaceDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/teacher-at-risk" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><TeacherAtRiskStudents /></RoleGuard></ProtectedRoute>} />
                      <Route path="/teacher-behaviour" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><TeacherBehaviourDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/teacher-communication" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><TeacherCommunicationCenter /></RoleGuard></ProtectedRoute>} />
                      <Route path="/teacher/appointments" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "school_admin", "hod", "principal"]}><TeacherAppointmentsPage /></RoleGuard></ProtectedRoute>} />
                      <Route path="/ai-teacher-assistant" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><AITeacherAssistant /></RoleGuard></ProtectedRoute>} />
                      <Route path="/teacher-communities" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><TeacherCommunities /></RoleGuard></ProtectedRoute>} />
                      <Route path="/teacher-professional-development" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><TeacherProfessionalDevelopment /></RoleGuard></ProtectedRoute>} />
                      <Route path="/diagnostic" element={<ProtectedRoute><Diagnostic /></ProtectedRoute>} />
                      <Route path="/worksheets" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><Worksheets /></RoleGuard></ProtectedRoute>} />
                      <Route path="/analytics" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "school_admin", "hod", "principal"]}><Analytics /></RoleGuard></ProtectedRoute>} />
                      <Route path="/curative" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "hod", "principal"]}><Curative /></RoleGuard></ProtectedRoute>} />
                      <Route path="/submissions" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "hod", "principal"]}><Submissions /></RoleGuard></ProtectedRoute>} />
                      <Route path="/assessment-evaluation" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "hod", "principal"]}><AssessmentEvaluation /></RoleGuard></ProtectedRoute>} />
                      <Route path="/entry-ticket" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><EntryTicket /></RoleGuard></ProtectedRoute>} />
                      <Route path="/requests" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "principal", "hod", "student", "parent"]}><Requests /></RoleGuard></ProtectedRoute>} />
                      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                      <Route path="/alerts" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "hod", "teacher", "student", "parent"]}><Alerts /></RoleGuard></ProtectedRoute>} />
                      <Route path="/admin" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "hod", "teacher", "student", "parent"]}><AdminPanel /></RoleGuard></ProtectedRoute>} />
                      
                      <Route path="/executive-reporting" element={<ProtectedRoute><RoleGuard allowedRoles={["school_admin"]}><ExecutiveReporting /></RoleGuard></ProtectedRoute>} />
                      <Route path="/predictive-analytics" element={<ProtectedRoute><RoleGuard allowedRoles={["school_admin"]}><PredictiveAnalytics /></RoleGuard></ProtectedRoute>} />
                      
                      <Route path="/super-admin" element={<ProtectedRoute><RoleGuard allowedRoles={["school_admin"]}><SuperAdminPanel /></RoleGuard></ProtectedRoute>} />
                      <Route path="/knsoft-admin" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><KNSoftAdminPanel /></RoleGuard></ProtectedRoute>} />
                      <Route path="/billing-dashboard" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><BillingDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/security-dashboard" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><SecurityDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/ai-cost-monitoring" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><AICostMonitoringDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/cache-management" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><CacheManagementDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/ocr-processing" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><OCRProcessingDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/notification-dashboard" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><NotificationDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/risk-prediction" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><RiskPredictionDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/knowledge-graph" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><KnowledgeGraphDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/school-intelligence" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><SchoolIntelligenceDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/automation-dashboard" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><AutomationDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/multi-tenant" element={<ProtectedRoute><RoleGuard allowedRoles={["knsoft_admin"]}><MultiTenantDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/hod-dashboard" element={<ProtectedRoute><RoleGuard allowedRoles={["hod"]}><HODDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/parent-dashboard" element={<ProtectedRoute><RoleGuard allowedRoles={["parent"]}><ParentDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/academic-tests" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><AcademicTests /></RoleGuard></ProtectedRoute>} />
                      <Route path="/gamification" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><Gamification /></RoleGuard></ProtectedRoute>} />
                      <Route path="/leaderboard" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><Leaderboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/predictions" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><PredictionDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/ai-tutor" element={<ProtectedRoute><RoleGuard allowedRoles={["student", "admin", "principal"]}><AITutor /></RoleGuard></ProtectedRoute>} />
                      <Route path="/ai-knowledge" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal"]}><AIKnowledgeHub /></RoleGuard></ProtectedRoute>} />
                      <Route path="/school-analytics" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "hod", "teacher", "student", "parent"]}><SchoolAnalytics /></RoleGuard></ProtectedRoute>} />
                      <Route path="/automation" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin"]}><AutomationWorkflows /></RoleGuard></ProtectedRoute>} />
                      <Route path="/security" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "hod", "teacher", "student", "parent"]}><SecurityCenter /></RoleGuard></ProtectedRoute>} />
                      <Route path="/billing" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "hod", "teacher", "student", "parent"]}><Billing /></RoleGuard></ProtectedRoute>} />
                      <Route path="/academic-calendar" element={<ProtectedRoute><AcademicCalendar /></ProtectedRoute>} />
                      <Route path="/semester-engine" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "teacher", "student"]}><SemesterEngine /></RoleGuard></ProtectedRoute>} />
                      <Route path="/houses" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "teacher", "student", "parent", "hod"]}><HouseManagement /></RoleGuard></ProtectedRoute>} />
                      <Route path="/report-cards" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "teacher", "student", "parent"]}><ReportCards /></RoleGuard></ProtectedRoute>} />
                      <Route path="/alumni" element={<ProtectedRoute><RoleGuard allowedRoles={["school_admin"]}><AlumniPage /></RoleGuard></ProtectedRoute>} />
                      
                      <Route path="/appointments" element={<ProtectedRoute><RoleGuard allowedRoles={["parent"]}><AppointmentBooking /></RoleGuard></ProtectedRoute>} />
                      
                      <Route path="/exam-seating" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin"]}><ExamSeating /></RoleGuard></ProtectedRoute>} />
                      <Route path="/hall-tickets" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "student", "parent"]}><HallTicketEngine /></RoleGuard></ProtectedRoute>} />
                      <Route path="/invigilation" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "teacher"]}><InvigilationManagement /></RoleGuard></ProtectedRoute>} />
                      <Route path="/timetable" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "student", "school_admin", "teacher", "hod"]}><TimetablePage /></RoleGuard></ProtectedRoute>} />
                      <Route path="/attendance" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "principal", "admin", "student", "parent"]}><AttendanceMarking /></RoleGuard></ProtectedRoute>} />
                      <Route path="/student-transfers" element={<ProtectedRoute><RoleGuard allowedRoles={["school_admin"]}><StudentTransfers /></RoleGuard></ProtectedRoute>} />
                      <Route path="/syllabus-overview" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "hod", "school_admin"]}><SyllabusOverview /></RoleGuard></ProtectedRoute>} />
                      <Route path="/register" element={<Register />} />
                      <Route path="/forgot-password" element={<ForgotPassword />} />
                      <Route path="/update-password" element={<UpdatePassword />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </NotificationProvider>
              </LanguageProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
