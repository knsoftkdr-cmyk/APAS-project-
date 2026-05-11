import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  id: string;
  full_name: string | null;
  role: string;
  avatar_url: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if Supabase is properly initialized
  const isSupabaseInitialized = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const fetchProfile = async (userId: string) => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, role, avatar_url")
        .eq("id", userId)
        .single();
      setProfile(data);
    } catch (error) {
      console.error("Error fetching profile:", error);
    }
  };

  useEffect(() => {
    // Set a timeout to ensure loading state is cleared after 10 seconds
    const loadingTimeout = setTimeout(() => {
      console.warn("Auth loading timeout - forcing completion");
      setLoading(false);
    }, 10000);

    const initializeAuth = async () => {
      try {
        // If Supabase is not initialized, skip auth check
        if (!isSupabaseInitialized) {
          console.warn("Supabase is not properly initialized. Check your environment variables.");
          setLoading(false);
          return;
        }

        // Set up auth listener BEFORE getSession
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (_event, session) => {
            console.log("Auth state changed:", _event);
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
        console.log("Session retrieved:", session ? "authenticated" : "not authenticated");
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

    return () => {
      clearTimeout(loadingTimeout);
    };
  }, [isSupabaseInitialized]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
