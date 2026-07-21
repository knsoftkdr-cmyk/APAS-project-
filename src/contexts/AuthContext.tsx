import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  id: string;
  full_name: string | null;
  role: string;
  avatar_url: string | null;
  school_id: string | null;
  employee_id?: string | null;
  designation?: string | null;
  department?: string | null;
  date_of_joining?: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  isSchoolAdmin: boolean;
  isAdmin: boolean;
  isTeacher: boolean;
  isPrincipal: boolean;
  isStudent: boolean;
  isKNSoftAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  isSchoolAdmin: false,
  isAdmin: false,
  isTeacher: false,
  isPrincipal: false,
  isStudent: false,
  isKNSoftAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const isSupabaseInitialized =
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const fetchProfile = async (userId: string) => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, role, avatar_url, school_id, class_grade, roll_number, section, employee_id, designation, department, date_of_joining")
        .eq("id", userId)
        .single();
      setProfile(data);
    } catch (error) {
      console.error("Error fetching profile:", error);
    }
  };

  const refreshProfile = async () => {
    if (session?.user?.id) {
      await fetchProfile(session.user.id);
    }
  };

  useEffect(() => {
  let isMounted = true;
  const loadingTimeout = setTimeout(() => {
    if (isMounted) setLoading(false);
  }, 10000);

  if (!isSupabaseInitialized) {
    setLoading(false);
    return () => {
      isMounted = false;
      clearTimeout(loadingTimeout);
    };
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (_event, session) => {
      if (!isMounted) return;
      setSession(session);
      if (session?.user) {
        setTimeout(() => fetchProfile(session.user.id), 0);
      } else {
        setProfile(null);
      }
      setLoading(false);
    }
  );

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!isMounted) return;
    setSession(session);
    if (session?.user) fetchProfile(session.user.id);
    setLoading(false);
  }).catch((error) => {
    console.error("Auth initialization error:", error);
    if (isMounted) setLoading(false);
  });

  return () => {
    isMounted = false;
    clearTimeout(loadingTimeout);
    subscription.unsubscribe(); // ✅ actually runs now
  };
}, [isSupabaseInitialized]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  const isSchoolAdmin  = profile?.role === "school_admin";
  const isAdmin        = profile?.role === "admin" || profile?.role === "principal";
  const isTeacher      = profile?.role === "teacher";
  const isPrincipal    = profile?.role === "principal";
  const isStudent      = profile?.role === "student";
  const isKNSoftAdmin  = profile?.role === "knsoft_admin";

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signOut,
        refreshProfile,
        isSchoolAdmin,
        isAdmin,
        isTeacher,
        isPrincipal,
        isStudent,
        isKNSoftAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
