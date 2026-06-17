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

// Lazy load all page components for code splitting
const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Curative = lazy(() => import("./pages/Curative"));
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
const KnowledgeGraphDashboard = lazy(() => import("./pages/KnowledgeGraphDashboard"));
const SchoolIntelligenceDashboard = lazy(() => import("./pages/SchoolIntelligenceDashboard"));
const AutomationDashboard = lazy(() => import("./pages/AutomationDashboard"));
const MultiTenantDashboard = lazy(() => import("./pages/MultiTenantDashboard"));
const HODDashboard = lazy(() => import("./pages/HODDashboard"));
const ParentDashboard = lazy(() => import("./pages/ParentDashboard"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const UpdatePassword = lazy(() => import("./pages/UpdatePassword"));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <LoadingSpinner size="lg" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
    },
  },
});

export default function App() {
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
                      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                      <Route path="/student-dashboard" element={<ProtectedRoute><RoleGuard allowedRoles={["student", "admin", "parent"]}><StudentDashboard /></RoleGuard></ProtectedRoute>} />
                      <Route path="/teacher" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "school_admin", "hod", "principal"]}><TeacherPanel /></RoleGuard></ProtectedRoute>} />
                      <Route path="/diagnostic" element={<ProtectedRoute><Diagnostic /></ProtectedRoute>} />
                      <Route path="/analytics" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "school_admin", "hod", "principal"]}><Analytics /></RoleGuard></ProtectedRoute>} />
                      <Route path="/curative" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "hod", "principal"]}><Curative /></RoleGuard></ProtectedRoute>} />
                      <Route path="/requests" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "principal", "hod", "student", "parent"]}><Requests /></RoleGuard></ProtectedRoute>} />
                      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                      <Route path="/alerts" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "hod", "teacher", "student", "parent"]}><Alerts /></RoleGuard></ProtectedRoute>} />
                      <Route path="/admin" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "principal", "school_admin", "hod", "teacher", "student", "parent"]}><AdminPanel /></RoleGuard></ProtectedRoute>} />
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
                      <Route path="/register" element={<Register />} />
                      <Route path="*" element={<NotFound />} />
                      <Route path="/forgot-password" element={<ForgotPassword />} />
                      <Route path="/update-password" element={<UpdatePassword />} />
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
