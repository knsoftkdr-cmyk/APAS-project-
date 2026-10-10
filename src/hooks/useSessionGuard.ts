import { useEffect, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { sendSessionHeartbeat } from "@/lib/sessionManagement";
import { toast } from "@/hooks/use-toast";

const EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;

/**
 * While someone is signed in: tell the server this device is active (so it shows under My Devices), and sign this
 * device out as soon as the server says its login was ended from another device or by an administrator.
 * Never signs out on a network blip - only on an explicit "revoked", or a 401/403 that getUser() confirms.
 */
export function useSessionGuard(session: Session | null) {
  const lastRun = useRef(0);
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const endLocally = async () => {
      await supabase.auth.signOut({ scope: "local" });
      toast({
        title: "You were signed out",
        description: "This device was signed out from another device or by an administrator. Sign in again to continue.",
        variant: "destructive",
      });
    };

    const check = async () => {
      if (cancelled || Date.now() - lastRun.current < MIN_GAP_MS) return;
      lastRun.current = Date.now();
      try {
        const r = await sendSessionHeartbeat(Capacitor.isNativePlatform());
        if (cancelled) return;
        if (r.revoked) { await endLocally(); return; }
        if (r.status === 401 || r.status === 403) {
          const { error } = await supabase.auth.getUser();
          if (error && !cancelled) await endLocally();
        }
      } catch { /* heartbeat is best-effort */ }
    };

    const first = setTimeout(check, 3000);
    const timer = setInterval(check, EVERY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);
}
