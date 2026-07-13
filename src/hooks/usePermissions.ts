import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const BYPASS_ROLES = ["knsoft_admin", "school_admin"];

const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin:     ["Home", "Reports", "Alerts", "Admin Panel", "AI Tutor", "School Intelligence", "Security Center", "Billing", "Academic Calendar", "Houses", "Semester Engine", "Report Cards", "Attendance"],
  principal: ["Home", "Reports", "Alerts", "Admin Panel", "AI Tutor", "School Intelligence", "Security Center", "Billing", "Academic Calendar", "Houses", "Semester Engine", "Report Cards", "Invigilation", "Exam Seating", "Hall Tickets", "Attendance"],
  hod:       ["Home", "Reports", "Assessments", "Analytics", "Academic Calendar", "Houses"],
  teacher:   ["Home", "Reports", "Lesson Plans", "Analytics", "Requests", "Academic Calendar", "Houses", "Semester Engine", "Attendance", "Group Projects"],
  student:   ["Home", "Assessments", "Academic Tests", "Homework", "Gamification", "Leaderboard", "Predictions", "AI Tutor", "Academic Calendar", "Houses", "Semester Engine", "Attendance"],
  parent:    ["Home", "Academic Calendar", "Houses", "Report Cards", "Attendance"],
};

const ALL_MODULES = ["Home","Reports","Alerts","Admin Panel","AI Tutor","School Intelligence","Security Center","Billing","Settings","Student Profile","Teacher Profile","Attendance","Homework","Lesson Plans","Assessments","Analytics","Gamification","Leaderboard","Predictions","Parent Communication","Risk Prediction","Academic Tests","Requests","Academic Calendar","Houses","Semester Engine","Report Cards","Group Projects"];

const permCache = new Map<string, string[]>();
// Cache version — bump this to invalidate all cached permissions
const CACHE_VERSION = "v12";

interface UsePermissionsReturn {
  can: (moduleName: string) => boolean;
  allowedModules: string[];
  loading: boolean;
}

export function usePermissions(): UsePermissionsReturn {
  const { profile } = useAuth();
  const cacheKey = `${CACHE_VERSION}-${profile?.school_id}-${profile?.role}`;
  const [allowedModules, setAllowedModules] = useState<string[]>(() => permCache.get(cacheKey) ?? []);
  const [loading, setLoading] = useState(!permCache.has(cacheKey));

  useEffect(() => {
    if (!profile) { setLoading(false); return; }
    if (permCache.has(cacheKey)) {
      setAllowedModules(permCache.get(cacheKey)!);
      setLoading(false);
      return;
    }
    if (BYPASS_ROLES.includes(profile.role)) {
      permCache.set(cacheKey, ["*"]);
      setAllowedModules(["*"]);
      setLoading(false);
      return;
    }
    if (!profile.school_id) { setLoading(false); return; }

    const fetchPermissions = async () => {
      const { data } = await supabase
        .from("role_permissions")
        .select("module_name, allowed")
        .eq("school_id", profile.school_id)
        .eq("role", profile.role)
        .eq("allowed", true);
      const modules = (data ?? []).map((r: any) => r.module_name);
      if (modules.length === 0) {
        const defaults = DEFAULT_PERMISSIONS[profile.role] ?? [];
        const upserts = ALL_MODULES.map(mod => ({
          school_id: profile.school_id,
          role: profile.role,
          module_name: mod,
          allowed: defaults.includes(mod),
          updated_at: new Date().toISOString(),
        }));
        await supabase.from("role_permissions").upsert(upserts, { onConflict: "school_id,role,module_name" });
        permCache.set(cacheKey, defaults);
        setAllowedModules(defaults);
      } else {
        permCache.set(cacheKey, modules);
        setAllowedModules(modules);
      }
      setLoading(false);
    };
    fetchPermissions();
  }, [profile, cacheKey]);

  const can = (moduleName: string): boolean => {
    if (!profile) return false;
    if (BYPASS_ROLES.includes(profile.role)) return true;
    if (allowedModules.includes("*")) return true;
    return allowedModules.includes(moduleName);
  };

  return { can, allowedModules, loading };
}

export function clearPermissionsCache() {
  permCache.clear();
}