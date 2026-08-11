/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getFcmAccessToken, sendPushToToken } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const accessToken = await getFcmAccessToken();
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
      const result = await sendPushToToken(accessToken, { token, title, body: notifBody, data });
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
          sendPushToToken(accessToken, { token: device.fcm_token, title, body: notifBody, data: data ?? {} })
        )
      );

      // Send to parent devices with different message
      const parentResults = await Promise.allSettled(
        parentDevices.map((device: { fcm_token: string }) =>
          sendPushToToken(accessToken, { token: device.fcm_token, title: parentTitle, body: parentBody, data: data ?? {} })
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
          sendPushToToken(accessToken, {
            token: device.fcm_token,
            title: title || "New Homework Assigned",
            body: notifBody || "Your teacher has assigned new homework",
            data: notifData,
          })
        )
      );

      // Send to parents with different message
      const parentResults = await Promise.allSettled(
        parentDevices.map((device: { fcm_token: string }) =>
          sendPushToToken(accessToken, {
            token: device.fcm_token,
            title: parentTitle,
            body: parentBody,
            data: notifData,
          })
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
          sendPushToToken(accessToken, { token: device.fcm_token, title, body: notifBody, data: data ?? {} })
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
          sendPushToToken(accessToken, { token: device.fcm_token, title, body: notifBody, data: data ?? {} })
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
          sendPushToToken(accessToken, { token: device.fcm_token, title, body: notifBody, data: data ?? {} })
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

    // ── TRANSPORT ALERT (boarding/drop confirmation -> parent push + bell) ──
    if (type === "transport_alert") {
      const { student_id, direction, stop_name, route_name } = payload;

      if (!student_id || !direction) {
        return Response.json(
          { success: false, message: "student_id and direction are required" },
          { status: 400 }
        );
      }

      // boarding_confirmations.student_id is students.id -> resolve to profiles.id
      const { data: studentRow } = await supabase
        .from("students")
        .select("profile_id, full_name")
        .eq("id", student_id)
        .maybeSingle();

      if (!studentRow?.profile_id) {
        return Response.json({ success: false, message: "Student profile not found" });
      }

      const { data: parentLinks } = await supabase
        .from("parent_students")
        .select("parent_id")
        .eq("student_id", studentRow.profile_id);

      const parentIds = (parentLinks || []).map((p: { parent_id: string }) => p.parent_id);
      if (parentIds.length === 0) {
        return Response.json({ success: false, message: "No parent linked to this student" });
      }

      const isPickup = direction === "pickup";
      const title = isPickup ? "Your child has boarded the bus" : "Your child has been dropped off";
      const notifBody = isPickup
        ? `${studentRow.full_name || "Your child"} boarded the bus at ${stop_name || "their stop"}${route_name ? ` (${route_name})` : ""}.`
        : `${studentRow.full_name || "Your child"} was dropped off at ${stop_name || "their stop"}${route_name ? ` (${route_name})` : ""}.`;

      // In-app bell notification — written for ALL linked parents regardless of
      // push preference, since that preference only gates the FCM push below.
      const govRows = parentIds.map((pid: string) => ({
        user_id: pid,
        event_type: isPickup ? "transport_boarding" : "transport_drop",
        title,
        message: notifBody,
        reference_id: student_id,
        reference_type: "boarding_confirmation",
        channel: "in_app",
        is_read: false,
      }));
      const { error: govError } = await supabase.from("governance_notifications").insert(govRows);
      if (govError) {
        console.error("governance_notifications insert failed:", govError.message);
      }

      // Respect push preference (default enabled if no row exists)
      const { data: prefs } = await supabase
        .from("notification_preferences")
        .select("user_id, push")
        .in("user_id", parentIds);

      const disabledIds = new Set(
        (prefs || []).filter((p: { push: boolean }) => p.push === false).map((p: { user_id: string }) => p.user_id)
      );
      const eligibleParentIds = parentIds.filter((id: string) => !disabledIds.has(id));

      if (eligibleParentIds.length === 0) {
        return Response.json({ success: true, message: "Bell notified; all parents have push disabled" });
      }

      const { data: parentDevices } = await supabase
        .from("user_devices")
        .select("fcm_token")
        .in("user_id", eligibleParentIds)
        .eq("is_active", true);

      if (!parentDevices || parentDevices.length === 0) {
        return Response.json({ success: true, message: "Bell notified; no active parent devices" });
      }

      const results = await Promise.allSettled(
        parentDevices.map((device: { fcm_token: string }) =>
          sendPushToToken(accessToken, {
            token: device.fcm_token,
            title,
            body: notifBody,
            data: { type: "transport_alert", direction, student_id },
          })
        )
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;

      return Response.json({
        success: true,
        parent_devices: parentDevices.length,
        sent: succeeded,
      });
    }

    // ── RESTRICTED ZONE ALERT (driver entered a restricted geofence -> staff push + bell) ──
    if (type === "restricted_zone_alert") {
      const { school_id, zone_name, driver_name, vehicle_id } = payload;

      if (!school_id || !zone_name) {
        return Response.json(
          { success: false, message: "school_id and zone_name are required" },
          { status: 400 }
        );
      }

      const staffRoles = ["knsoft_admin", "principal", "admin", "school_admin", "teacher"];
      const { data: staffUsers } = await supabase
        .from("profiles")
        .select("id")
        .eq("school_id", school_id)
        .in("role", staffRoles);

      if (!staffUsers || staffUsers.length === 0) {
        return Response.json({ success: false, message: "No staff found for this school" });
      }

      const staffIds = staffUsers.map((u: { id: string }) => u.id);
      const title = "Restricted Area Alert";
      const notifBody = `${driver_name || "A driver"} entered a restricted zone: ${zone_name}.`;

      const govRows = staffIds.map((uid: string) => ({
        user_id: uid,
        event_type: "restricted_zone_entry",
        title,
        message: notifBody,
        reference_id: vehicle_id ?? null,
        reference_type: "geofence_event",
        channel: "in_app",
        is_read: false,
      }));
      const { error: govError } = await supabase.from("governance_notifications").insert(govRows);
      if (govError) {
        console.error("governance_notifications insert failed:", govError.message);
      }

      const { data: devices } = await supabase
        .from("user_devices")
        .select("fcm_token")
        .in("user_id", staffIds)
        .eq("is_active", true);

      if (!devices || devices.length === 0) {
        return Response.json({ success: true, message: "Bell notified; no active staff devices" });
      }

      const results = await Promise.allSettled(
        devices.map((device: { fcm_token: string }) =>
          sendPushToToken(accessToken, {
            token: device.fcm_token,
            title,
            body: notifBody,
            data: { type: "restricted_zone_alert", vehicle_id: vehicle_id ?? "" },
          })
        )
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;

      return Response.json({ success: true, staff_devices: devices.length, sent: succeeded });
    }

    // ── UNAUTHORIZED BOARDING ALERT (confirmed far from the stop -> staff push + bell) ──
    if (type === "unauthorized_boarding_alert") {
      const { school_id, student_name, stop_name, direction, distance_meters, vehicle_id } = payload;

      if (!school_id || !stop_name) {
        return Response.json(
          { success: false, message: "school_id and stop_name are required" },
          { status: 400 }
        );
      }

      const staffRoles = ["knsoft_admin", "principal", "admin", "school_admin", "teacher"];
      const { data: staffUsers } = await supabase
        .from("profiles")
        .select("id")
        .eq("school_id", school_id)
        .in("role", staffRoles);

      if (!staffUsers || staffUsers.length === 0) {
        return Response.json({ success: false, message: "No staff found for this school" });
      }

      const staffIds = staffUsers.map((u: { id: string }) => u.id);
      const title = "Unusual Boarding Confirmation";
      const distanceText = distance_meters ? `~${Math.round(distance_meters)}m away` : "far";
      const notifBody = `${student_name || "A student"}'s ${direction || "boarding"} was confirmed at ${stop_name} while the bus was ${distanceText} from that stop.`;

      const govRows = staffIds.map((uid: string) => ({
        user_id: uid,
        event_type: "unauthorized_boarding",
        title,
        message: notifBody,
        reference_id: vehicle_id ?? null,
        reference_type: "boarding_confirmation",
        channel: "in_app",
        is_read: false,
      }));
      const { error: govError } = await supabase.from("governance_notifications").insert(govRows);
      if (govError) {
        console.error("governance_notifications insert failed:", govError.message);
      }

      const { data: devices } = await supabase
        .from("user_devices")
        .select("fcm_token")
        .in("user_id", staffIds)
        .eq("is_active", true);

      if (!devices || devices.length === 0) {
        return Response.json({ success: true, message: "Bell notified; no active staff devices" });
      }

      const results = await Promise.allSettled(
        devices.map((device: { fcm_token: string }) =>
          sendPushToToken(accessToken, {
            token: device.fcm_token,
            title,
            body: notifBody,
            data: { type: "unauthorized_boarding_alert" },
          })
        )
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;

      return Response.json({ success: true, staff_devices: devices.length, sent: succeeded });
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
