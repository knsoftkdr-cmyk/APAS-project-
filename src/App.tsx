import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { LanguageProvider } from "@/i18n/LanguageContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleGuard } from "@/components/RoleGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import StudentDashboard from "./pages/StudentDashboard";
import Analytics from "./pages/Analytics";
import Curative from "./pages/Curative";
import Requests from "./pages/Requests";
import SettingsPage from "./pages/Settings";
import TeacherPanel from "./pages/TeacherPanel";
import Diagnostic from "./pages/Diagnostic";
import AdminPanel from "./pages/AdminPanel";
import AcademicTests from "./pages/AcademicTests";
import Gamification from "./pages/Gamification";
import AITutor from "./pages/AITutor";
import AIKnowledgeHub from "./pages/AIKnowledgeHub";
import SchoolAnalytics from "./pages/SchoolAnalytics";
import Alerts from "./pages/Alerts";
import AutomationWorkflows from "./pages/AutomationWorkflows";
import SecurityCenter from "./pages/SecurityCenter";
import Billing from "./pages/Billing";
import NotFound from "./pages/NotFound";
import ForgotPassword from "@/pages/ForgotPassword";


const queryClient = new QueryClient();

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
                  <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                    <Route path="/student-dashboard" element={<ProtectedRoute><RoleGuard allowedRoles={["student", "admin"]}><StudentDashboard /></RoleGuard></ProtectedRoute>} />
                    <Route path="/teacher" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "school_admin"]}><TeacherPanel /></RoleGuard></ProtectedRoute>} />
                    <Route path="/diagnostic" element={<ProtectedRoute><Diagnostic /></ProtectedRoute>} />
                    <Route path="/analytics" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin", "school_admin"]}><Analytics /></RoleGuard></ProtectedRoute>} />
                    <Route path="/curative" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher", "admin"]}><Curative /></RoleGuard></ProtectedRoute>} />
                    <Route path="/requests" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><Requests /></RoleGuard></ProtectedRoute>} />
                    <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                    <Route path="/alerts" element={<ProtectedRoute><RoleGuard allowedRoles={["admin"]}><Alerts /></RoleGuard></ProtectedRoute>} />
                    <Route path="/admin" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "school_admin"]}><AdminPanel /></RoleGuard></ProtectedRoute>} />
                    <Route path="/academic-tests" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><AcademicTests /></RoleGuard></ProtectedRoute>} />
                    <Route path="/gamification" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><Gamification /></RoleGuard></ProtectedRoute>} />
                    <Route path="/ai-tutor" element={<ProtectedRoute><RoleGuard allowedRoles={["admin"]}><AITutor /></RoleGuard></ProtectedRoute>} />
                    <Route path="/ai-knowledge" element={<ProtectedRoute><RoleGuard allowedRoles={["admin"]}><AIKnowledgeHub /></RoleGuard></ProtectedRoute>} />
                    <Route path="/school-analytics" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "school_admin"]}><SchoolAnalytics /></RoleGuard></ProtectedRoute>} />
                    <Route path="/automation" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "school_admin"]}><AutomationWorkflows /></RoleGuard></ProtectedRoute>} />
                    <Route path="/security" element={<ProtectedRoute><RoleGuard allowedRoles={["admin"]}><SecurityCenter /></RoleGuard></ProtectedRoute>} />
                    <Route path="/billing" element={<ProtectedRoute><RoleGuard allowedRoles={["admin", "school_admin"]}><Billing /></RoleGuard></ProtectedRoute>} />
                    <Route path="/register" element={<Register />} />
                    <Route path="*" element={<NotFound />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                  </Routes>
                </NotificationProvider>
              </LanguageProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
