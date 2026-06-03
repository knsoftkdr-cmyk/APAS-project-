import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  id: string;
  full_name: string | null;
  role: string;
  avatar_url: string | null;
  school_id: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
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
      console.log("Fetching profile for:", userId);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role, avatar_url, school_id, class_grade, roll_number, section")
        .eq("id", userId)
        .single();
      console.log("Profile data:", data, "Error:", error);
      setProfile(data);
    } catch (error) {
      console.error("Error fetching profile:", error);
    }
  };

  useEffect(() => {
    const loadingTimeout = setTimeout(() => {
      setLoading(false);
    }, 10000);

    const initializeAuth = async () => {
      try {
        if (!isSupabaseInitialized) {
          setLoading(false);
          return;
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (_event, session) => {
            setSession(session);
            if (session?.user) {
              setTimeout(() => fetchProfile(session.user.id), 0);
            } else {
              setProfile(null);
            }
            setLoading(false);
          }
        );

        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        if (session?.user) {
          await fetchProfile(session.user.id);
        }
        setLoading(false);

        return () => subscription.unsubscribe();
      } catch (error) {
        console.error("Auth initialization error:", error);
        setLoading(false);
      }
    };

    initializeAuth();
    return () => clearTimeout(loadingTimeout);
  }, [isSupabaseInitialized]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  const isSchoolAdmin  = profile?.role === "school_admin";
  const isAdmin        = profile?.role === "admin";
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
