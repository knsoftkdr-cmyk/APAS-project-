import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/integrations/supabase/client";
import { saveFCMToken } from "./deviceService";

let pendingFCMToken: string | null = null;

export const getPendingFCMToken = () => pendingFCMToken;

export const initializePushNotifications = async () => {
  console.log("initializePushNotifications called");
  try {
    const permission = await PushNotifications.requestPermissions();
    console.log("Permission:", permission);

    if (permission.receive !== "granted") {
      console.log("Notification permission denied");
      return;
    }

    await PushNotifications.register();
    console.log("Register requested");

    PushNotifications.addListener("registration", async (token) => {
      console.log("FCM TOKEN:", token.value);

      // Always store in memory for use after login
      pendingFCMToken = token.value;

      // Try to save immediately if user already logged in
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        console.log("No user yet — token stored in memory");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("school_id")
        .eq("id", session.user.id)
        .single();

      if (!profile?.school_id) {
        console.log("school_id not found");
        return;
      }

      const { data: profileRole } = await supabase
  .from("profiles")
  .select("role")
  .eq("id", session.user.id)
  .single();

await saveFCMToken(session.user.id, profile.school_id, token.value, profileRole?.role ?? "unknown");
      console.log("✅ FCM Token saved on app start");
    });

    PushNotifications.addListener("registrationError", (error) => {
      console.error("Registration Error:", error);
    });

  } catch (err) {
    console.error("Push Error:", err);
  }
};