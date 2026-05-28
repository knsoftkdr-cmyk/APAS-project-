/**
 * usePermissions.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches role_permissions for the current user's school and role.
 * Used by the sidebar and any page that needs to check access.
 *
 * Usage:
 *   const { can, loading } = usePermissions();
 *   if (can("Analytics")) { ... }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Roles that bypass permission checks (always have full access)
const BYPASS_ROLES = ["knsoft_admin", "admin", "school_admin"];

interface UsePermissionsReturn {
  can: (moduleName: string) => boolean;
  allowedModules: string[];
  loading: boolean;
}

export function usePermissions(): UsePermissionsReturn {
  const { profile } = useAuth();
  const [allowedModules, setAllowedModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPermissions = async () => {
      console.log("usePermissions: profile=", profile?.role, "school=", profile?.school_id);
      if (!profile) {
        setLoading(false);
        return;
      }

      // Bypass roles get everything
      if (BYPASS_ROLES.includes(profile.role)) {
        setAllowedModules(["*"]); // wildcard — can() always returns true
        setLoading(false);
        return;
      }

      if (!profile.school_id) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("role_permissions")
        .select("module_name, allowed")
        .eq("school_id", profile.school_id)
        .eq("role", profile.role)
        .eq("allowed", true);

      const modules = (data ?? []).map((r) => r.module_name);
      // If no permissions set for this school yet, default to show everything
      if (modules.length === 0) {
        setAllowedModules(["*"]);
      } else {
        setAllowedModules(modules);
        console.log("usePermissions: allowed modules=", modules);
      }
      setLoading(false);
    };

    fetchPermissions();
  }, [profile]);

  const can = (moduleName: string): boolean => {
    if (!profile) return false;
    if (BYPASS_ROLES.includes(profile.role)) return true;
    if (allowedModules.includes("*")) return true;
    return allowedModules.includes(moduleName);
  };

  return { can, allowedModules, loading };
}
