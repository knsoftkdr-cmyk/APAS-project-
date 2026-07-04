/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from "jsr:@supabase/supabase-js@2";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const FIREBASE_CLIENT_EMAIL = Deno.env.get("FIREBASE_CLIENT_EMAIL")!;
const FIREBASE_PRIVATE_KEY = Deno.env.get("FIREBASE_PRIVATE_KEY")!.replace(/\\n/g, "\n");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemContents = FIREBASE_PRIVATE_KEY
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${signingInput}.${signatureB64}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();

  if (!tokenData.access_token) {
    throw new Error(`OAuth failed: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

async function sendToToken(
  accessToken: string,
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: { title, body },
          data: data ?? {},
          android: {
            priority: "high",
            notification: { sound: "default" },
          },
        },
      }),
    }
  );
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`FCM error: ${JSON.stringify(result)}`);
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    const body = await req.json();
    const { type, payload } = body;

    if (!type || !payload) {
      return Response.json(
        { success: false, message: "type and payload are required" },
        { status: 400 }
      );
    }

    const accessToken = await getAccessToken();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── SINGLE TOKEN ─────────────────────────────────────────────
    if (type === "single") {
      const token = payload.token;
      const title = payload.title;
      const notifBody = payload.body;
      const data = payload.data;
      if (!token || !title || !notifBody) {
        return Response.json(
          { success: false, message: "token, title and body are required" },
          { status: 400 }
        );
      }
      const result = await sendToToken(accessToken, token, title, notifBody, data);
      return Response.json({ success: true, result });
    }

    // ── SINGLE BY USER ID (grade notifications → student + parent) ──
    if (type === "single_by_user_id") {
      const { user_id, title, body: notifBody, data, student_name, score, subject, topic, feedback } = payload;

      if (!user_id || !title || !notifBody) {
        return Response.json(
          { success: false, message: "user_id, title and body are required" },
          { status: 400 }
        );
      }

      // Get student FCM tokens
      const { data: studentDevices, error: deviceError } = await supabase
        .from("user_devices")
        .select("fcm_token")
        .eq("user_id", user_id)
        .eq("is_active", true);

      if (deviceError) {
        return Response.json(
          { success: false, message: deviceError.message },
          { status: 500 }
        );
      }

      // Get parent IDs linked to this student
      const { data: parentLinks } = await supabase
        .from("parent_students")
        .select("parent_id")
        .eq("student_id", user_id);

      const parentIds = (parentLinks || []).map((p: { parent_id: string }) => p.parent_id);

      // Get parent FCM tokens
      let parentDevices: { fcm_token: string }[] = [];
      if (parentIds.length > 0) {
        const { data: pd } = await supabase
          .from("user_devices")
          .select("fcm_token")
          .in("user_id", parentIds)
          .eq("is_active", true);
        parentDevices = pd || [];
      }

      // Build parent-specific message
      const parentTitle = `Your child's ${subject ? subject + " " : ""}homework graded`;
      const parentBody = feedback
        ? `${student_name || "Your child"} scored ${score}/100. Teacher says: ${feedback.substring(0, 60)}${feedback.length > 60 ? "..." : ""}`
        : `${student_name || "Your child"} scored ${score}/100 in ${topic || subject || "homework"}.`;

      // Send to student devices
      const studentResults = await Promise.allSettled(
        (studentDevices || []).map((device: { fcm_token: string }) =>
          sendToToken(accessToken, device.fcm_token, title, notifBody, data ?? {})
        )
      );

      // Send to parent devices with different message
      const parentResults = await Promise.allSettled(
        parentDevices.map((device: { fcm_token: string }) =>
          sendToToken(accessToken, device.fcm_token, parentTitle, parentBody, data ?? {})
        )
      );

      const succeeded =
        studentResults.filter((r) => r.status === "fulfilled").length +
        parentResults.filter((r) => r.status === "fulfilled").length;

      return Response.json({
        success: true,
        student_devices: (studentDevices || []).length,
        parent_devices: parentDevices.length,
        sent: succeeded,
      });
    }

    // ── HOMEWORK + PARENTS (school + class + section) ─────────────
    if (type === "homework" || type === "homework_with_parents") {
      const { school_id, class_level, section, title, body: notifBody, homework_id, subject } = payload;

      if (!school_id || !class_level || !section) {
        return Response.json(
          { success: false, message: "school_id, class_level and section are required" },
          { status: 400 }
        );
      }

      const classNumber = class_level.replace("Class ", "").trim();

      // Find students in this class
      const { data: students, error: studentError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("school_id", school_id)
        .eq("class_grade", classNumber)
        .eq("section", section.toUpperCase())
        .eq("role", "student");

      if (studentError) {
        return Response.json({ success: false, message: studentError.message }, { status: 500 });
      }

      if (!students || students.length === 0) {
        return Response.json({
          success: false,
          message: `No students found for class_grade=${classNumber} section=${section}`,
        });
      }

      const studentIds = students.map((s: { id: string }) => s.id);

      // Get student FCM tokens
      const { data: studentDevices } = await supabase
        .from("user_devices")
        .select("fcm_token")
        .in("user_id", studentIds)
        .eq("is_active", true);

      // Get parent links with student info
      const { data: parentLinks } = await supabase
        .from("parent_students")
        .select("parent_id, student_id")
        .in("student_id", studentIds);

      const parentIds = [
        ...new Set((parentLinks || []).map((p: { parent_id: string }) => p.parent_id)),
      ];

      // Get parent FCM tokens
      let parentDevices: { fcm_token: string }[] = [];
      if (parentIds.length > 0) {
        const { data: pd } = await supabase
          .from("user_devices")
          .select("fcm_token")
          .in("user_id", parentIds)
          .eq("is_active", true);
        parentDevices = pd || [];
      }

      const notifData = {
        type: "homework",
        homework_id: homework_id ?? "",
        school_id,
        class_level,
        section,
      };

// Parent message is different from student message
const isWorksheet = (title || "").toLowerCase().includes("worksheet");
const isTimetable = (title || "").toLowerCase().includes("timetable");

const parentTitle = isTimetable
  ? `Your child's timetable updated`
  : isWorksheet
  ? `New Worksheet for your child`
  : `New Homework for your child`;

const parentBody = isTimetable
  ? `Your child's class timetable has been updated. Please check the new schedule.`
  : isWorksheet
  ? `Your child has been assigned a new worksheet: ${notifBody}`
  : `Your child has new homework assigned: ${notifBody}`;

      // Send to students
      const studentResults = await Promise.allSettled(
        (studentDevices || []).map((device: { fcm_token: string }) =>
          sendToToken(
            accessToken,
            device.fcm_token,
            title || "New Homework Assigned",
            notifBody || "Your teacher has assigned new homework",
            notifData
          )
        )
      );

      // Send to parents with different message
      const parentResults = await Promise.allSettled(
        parentDevices.map((device: { fcm_token: string }) =>
          sendToToken(
            accessToken,
            device.fcm_token,
            parentTitle,
            parentBody,
            notifData
          )
        )
      );

      const succeeded =
        studentResults.filter((r) => r.status === "fulfilled").length +
        parentResults.filter((r) => r.status === "fulfilled").length;
      const failed =
        studentResults.filter((r) => r.status === "rejected").length +
        parentResults.filter((r) => r.status === "rejected").length;

      return Response.json({
        success: true,
        students_found: students.length,
        student_devices: (studentDevices || []).length,
        parent_devices: parentDevices.length,
        sent: succeeded,
        failed,
      });
    }

// ── NOTIFY BY ROLE (notify all users of a role in a school) ──
if (type === "notify_role") {
  const { school_id, role, title, body: notifBody, data } = payload;

  if (!school_id || !role || !title || !notifBody) {
    return Response.json(
      { success: false, message: "school_id, role, title and body are required" },
      { status: 400 }
    );
  }

  // Get all users with this role in the school
  const { data: roleUsers, error: roleError } = await supabase
    .from("profiles")
    .select("id")
    .eq("school_id", school_id)
    .eq("role", role);

  if (roleError) {
    return Response.json({ success: false, message: roleError.message }, { status: 500 });
  }

  if (!roleUsers || roleUsers.length === 0) {
    return Response.json({
      success: false,
      message: `No users with role=${role} found in this school`,
    });
  }

  const userIds = roleUsers.map((u: { id: string }) => u.id);

  // Get their FCM tokens
  const { data: devices } = await supabase
    .from("user_devices")
    .select("fcm_token")
    .in("user_id", userIds)
    .eq("is_active", true);

  if (!devices || devices.length === 0) {
    return Response.json({
      success: false,
      message: `No active devices found for role=${role}`,
    });
  }

  const results = await Promise.allSettled(
    devices.map((device: { fcm_token: string }) =>
      sendToToken(accessToken, device.fcm_token, title, notifBody, data ?? {})
    )
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;

  return Response.json({
    success: true,
    role,
    users_found: roleUsers.length,
    devices_found: devices.length,
    sent: succeeded,
  });
}

// ── PARENT ONLY ALERT (low performance — parent only, not student) ──
if (type === "parent_only_alert") {
  const { student_id, title, body: notifBody, data } = payload;

  if (!student_id || !title || !notifBody) {
    return Response.json(
      { success: false, message: "student_id, title and body are required" },
      { status: 400 }
    );
  }

  const { data: parentLinks } = await supabase
    .from("parent_students")
    .select("parent_id")
    .eq("student_id", student_id);

  if (!parentLinks || parentLinks.length === 0) {
    return Response.json({
      success: false,
      message: "No parent linked to this student",
    });
  }

  const parentIds = parentLinks.map((p: { parent_id: string }) => p.parent_id);

  const { data: parentDevices } = await supabase
    .from("user_devices")
    .select("fcm_token")
    .in("user_id", parentIds)
    .eq("is_active", true);

  if (!parentDevices || parentDevices.length === 0) {
    return Response.json({
      success: false,
      message: "Parent has no active device",
    });
  }

  const results = await Promise.allSettled(
    parentDevices.map((device: { fcm_token: string }) =>
      sendToToken(accessToken, device.fcm_token, title, notifBody, data ?? {})
    )
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;

  return Response.json({
    success: true,
    parent_devices: parentDevices.length,
    sent: succeeded,
  });
}

// ── NOTIFY MULTIPLE ROLES IN A SCHOOL (calendar events: students + parents) ──
    if (type === "notify_school_roles") {
      const { school_id, roles, title, body: notifBody, data } = payload;

      if (!school_id || !Array.isArray(roles) || roles.length === 0 || !title || !notifBody) {
        return Response.json(
          { success: false, message: "school_id, roles (array), title and body are required" },
          { status: 400 }
        );
      }

      const { data: roleUsers, error: roleError } = await supabase
        .from("profiles")
        .select("id")
        .eq("school_id", school_id)
        .in("role", roles);

      if (roleError) {
        return Response.json({ success: false, message: roleError.message }, { status: 500 });
      }

      if (!roleUsers || roleUsers.length === 0) {
        return Response.json({
          success: false,
          message: `No users found for roles=${roles.join(",")} in this school`,
        });
      }

      const userIds = roleUsers.map((u: { id: string }) => u.id);

      const { data: devices } = await supabase
        .from("user_devices")
        .select("fcm_token")
        .in("user_id", userIds)
        .eq("is_active", true);

      if (!devices || devices.length === 0) {
        return Response.json({
          success: false,
          message: `No active devices found for roles=${roles.join(",")}`,
        });
      }

      const results = await Promise.allSettled(
        devices.map((device: { fcm_token: string }) =>
          sendToToken(accessToken, device.fcm_token, title, notifBody, data ?? {})
        )
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;

      return Response.json({
        success: true,
        roles,
        users_found: roleUsers.length,
        devices_found: devices.length,
        sent: succeeded,
      });
    }
    
    return Response.json(
      { success: false, message: `Unknown type: ${type}` },
      { status: 400 }
    );

  } catch (error) {
    return Response.json(
      { success: false, message: String(error) },
      { status: 500 }
    );
  }
});