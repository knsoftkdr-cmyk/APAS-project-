import { supabase } from "@/integrations/supabase/client";

export const saveFCMToken = async (
  userId: string,
  schoolId: string,
  token: string,
  role: string
) => {
  const { data, error } = await supabase
    .from("user_devices")
    .upsert(
      {
        user_id: userId,
        school_id: schoolId,
        fcm_token: token,
        platform: "android",
        is_active: true,
        role: role,
      },
      {
        onConflict: "user_id,fcm_token",
      }
    )
    .select();

  console.log("UPSERT DATA:", data);

  if (error) {
    console.log("MESSAGE:", error.message);
    console.log("DETAILS:", error.details);
    console.log("HINT:", error.hint);
    console.log("CODE:", error.code);

    alert(
      `MESSAGE: ${error.message}
DETAILS: ${error.details}
HINT: ${error.hint}
CODE: ${error.code}`
    );
  } else {
    console.log("SUCCESS");
  }
};