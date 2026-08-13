import { supabase } from "@/integrations/supabase/client";

export interface DriverContact {
  driverId: string;       // drivers.id
  profileId: string;      // drivers.profile_id — the actual auth.uid() used for chat
  name: string;
  phone: string | null;
  routeName: string | null;
  routeNumber: string | null;
}

/**
 * Resolves the active transport driver for a single child, given the
 * child's PROFILE id (profiles.id), not students.id.
 *
 * Chain: profiles.id -> students.id (via students.profile_id)
 *        -> transport_assignments (active, by students.id)
 *        -> transport_routes.driver_id -> drivers.id/profile_id
 *
 * Mirrors the resolution already used in ParentDashboard.tsx's
 * fetchTransport(), extended to also select drivers.profile_id since that
 * (not drivers.id) is what teacher_messages.sender_id/recipient_id expects.
 *
 * Returns null if the child has no students row, no active transport
 * assignment, or the assigned route has no driver set.
 */
export async function getDriverForChild(
  childProfileId: string
): Promise<DriverContact | null> {
  const { data: studentRow } = await supabase
    .from("students")
    .select("id")
    .eq("profile_id", childProfileId)
    .maybeSingle();

  if (!studentRow) return null;

  const { data } = await supabase
    .from("transport_assignments")
    .select(
      "status, route_id, transport_routes(route_name, route_number, drivers(id, profile_id, name, phone))"
    )
    .eq("student_id", studentRow.id)
    .eq("status", "active")
    .maybeSingle();

  const row: any = data ?? null;
  const route: any = row?.transport_routes ?? null;
  const driver: any = route?.drivers ?? null;

  if (!driver || !driver.profile_id) return null;

  return {
    driverId: driver.id,
    profileId: driver.profile_id,
    name: driver.name || "Unnamed Driver",
    phone: driver.phone ?? null,
    routeName: route?.route_name ?? null,
    routeNumber: route?.route_number ?? null,
  };
}

export interface ParentContactForDriver {
  parentProfileId: string; // profiles.id — matches auth.uid() for chat
  name: string;
  studentName: string;
  routeLabel: string;
}

/**
 * Resolves the parent contacts a driver should see, given the driver's own
 * PROFILE id (drivers.profile_id, i.e. auth.uid()).
 *
 * Chain: profiles.id -> drivers.id/school_id (via drivers.profile_id)
 *        -> transport_routes (driver_id = drivers.id)
 *        -> transport_assignments (active, by route_id) -> students.id
 *        -> students.profile_id -> parent_students (student_id = profile.id,
 *           per the existing convention) -> parent profiles
 *
 * One row per parent, deduped, with student names combined if a parent has
 * more than one child on the driver's routes.
 */
export async function getParentsForDriver(
  driverProfileId: string
): Promise<ParentContactForDriver[]> {
  const { data: driverRow } = await supabase
    .from("drivers")
    .select("id, school_id")
    .eq("profile_id", driverProfileId)
    .maybeSingle();

  if (!driverRow) return [];

  const { data: routes } = await supabase
    .from("transport_routes")
    .select("id, route_name, route_number")
    .eq("driver_id", driverRow.id);

  if (!routes || routes.length === 0) return [];

  const routeById = new Map(routes.map(r => [r.id, r]));
  const routeIds = routes.map(r => r.id);

  const { data: assignments } = await supabase
    .from("transport_assignments")
    .select("student_id, route_id")
    .in("route_id", routeIds)
    .eq("status", "active");

  if (!assignments || assignments.length === 0) return [];

  const studentIds = [...new Set(assignments.map(a => a.student_id))];

  const { data: studentRows } = await supabase
    .from("students")
    .select("id, profile_id")
    .in("id", studentIds);

  if (!studentRows || studentRows.length === 0) return [];

  const studentProfileIds = studentRows
    .map(s => s.profile_id)
    .filter((id): id is string => !!id);

  const { data: studentProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", studentProfileIds);

  const studentNameByProfileId = new Map(
    (studentProfiles || []).map(p => [p.id, p.full_name || "Unnamed Student"])
  );
  const studentIdToProfileId = new Map(
    studentRows.map(s => [s.id, s.profile_id])
  );
  const routeIdByStudentId = new Map(
    assignments.map(a => [a.student_id, a.route_id])
  );

  const { data: parentLinks } = await supabase
    .from("parent_students")
    .select("student_id, parent_id")
    .in("student_id", studentProfileIds);

  if (!parentLinks || parentLinks.length === 0) return [];

  const parentIds = [...new Set(parentLinks.map(l => l.parent_id))];

  const { data: parentProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", parentIds);

  const parentNameById = new Map(
    (parentProfiles || []).map(p => [p.id, p.full_name || "Unnamed Parent"])
  );

  const contactMap = new Map<string, ParentContactForDriver>();
  for (const link of parentLinks) {
    const studentProfileId = link.student_id;
    const studentName = studentNameByProfileId.get(studentProfileId) || "Unnamed Student";
    const studentRow = studentRows.find(s => s.profile_id === studentProfileId);
    const routeId = studentRow ? routeIdByStudentId.get(studentRow.id) : undefined;
    const route = routeId ? routeById.get(routeId) : undefined;
    const routeLabel = route?.route_number
      ? `Route ${route.route_number}`
      : route?.route_name || "Transport";

    const existing = contactMap.get(link.parent_id);
    if (existing) {
      if (!existing.studentName.includes(studentName)) {
        existing.studentName = `${existing.studentName}, ${studentName}`;
      }
    } else {
      contactMap.set(link.parent_id, {
        parentProfileId: link.parent_id,
        name: parentNameById.get(link.parent_id) || "Unnamed Parent",
        studentName,
        routeLabel,
      });
    }
  }

  return [...contactMap.values()];
}
