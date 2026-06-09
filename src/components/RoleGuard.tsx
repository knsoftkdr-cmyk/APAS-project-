import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { LoadingSpinner } from "@/components/LoadingSpinner";

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: string[];
  module?: string;
}

export function RoleGuard({ children, allowedRoles, module }: RoleGuardProps) {
  const { profile, loading } = useAuth();
  const { can, loading: permsLoading } = usePermissions();

  if (loading || permsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!profile || !allowedRoles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (module && !can(module)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
