import { supabase } from "@/integrations/supabase/client";

export interface MarketplaceCategory {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  content_type_scope: string[];
  visibility: "public" | "internal";
  publishing_status: "draft" | "published" | "archived";
  sort_order: number;
}

export type MarketplaceContentType =
  | "lesson_plan" | "worksheet" | "assessment" | "question_bank"
  | "ai_prompt" | "digital_content" | "course" | "template"
  | "resource" | "third_party_app" | "video";

export interface MarketplaceListing {
  id: string;
  category_id: string | null;
  publisher_id: string;
  publisher_school_id: string | null;
  content_type: MarketplaceContentType;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  price: number;
  currency: string;
  license_type: string;
  status: "draft" | "pending_review" | "published" | "rejected" | "archived";
  visibility: "public" | "school_only" | "private";
  avg_rating: number;
  acquisition_count: number;
  created_at: string;
  published_at: string | null;
  class_label: string | null;
  subject: string | null;
  video_url: string | null;
  syllabus: string | null;
  syllabus_file_path: string | null;
  syllabus_file_type: string | null;
}

export interface MarketplaceListingFile {
  id: string;
  listing_id: string;
  version: number;
  storage_path: string;
  file_type: string | null;
  is_current: boolean;
  created_at: string;
}

const LISTING_FILES_BUCKET = "marketplace-listing-files";

export const CLASS_OPTIONS: { value: string; label: string }[] = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `Class ${i + 1}` })),
];

export const SUBJECT_OPTIONS: string[] = [
  "Mathematics", "Science", "English", "Social Studies", "Hindi", "EVS", "Computer Science",
];

export function getClassLabel(value: string | null): string {
  if (!value) return "—";
  return CLASS_OPTIONS.find((c) => c.value === value)?.label || value;
}

export async function getSchoolVideos(schoolId: string) {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*")
    .eq("publisher_school_id", schoolId)
    .eq("content_type", "video")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MarketplaceListing[];
}

export async function getMyClassVideos() {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*")
    .eq("content_type", "video")
    .eq("status", "published")
    .order("subject", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MarketplaceListing[];
}

export async function createVideoListing(input: {
  publisherId: string;
  publisherSchoolId: string;
  title: string;
  description: string;
  classLabel: string;
  subject: string;
  videoUrl: string | null;
  file: File | null;
}) {
  const { data: listing, error } = await supabase
    .from("marketplace_listings")
    .insert({
      publisher_id: input.publisherId,
      publisher_school_id: input.publisherSchoolId,
      content_type: "video",
      title: input.title,
      description: input.description,
      class_label: input.classLabel,
      subject: input.subject,
      video_url: input.videoUrl,
      price: 0,
      license_type: "free",
      status: "published",
      visibility: "school_only",
      published_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;

  if (input.file) {
    await uploadListingFile(input.file, listing.id);
  }
  return listing as MarketplaceListing;
}

export async function deleteVideoListing(listingId: string) {
  const { error } = await supabase.from("marketplace_listings").delete().eq("id", listingId);
  if (error) throw error;
}

export async function uploadListingFile(file: File, listingId: string) {
  const filePath = `${listingId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from(LISTING_FILES_BUCKET)
    .upload(filePath, file);
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("marketplace_listing_files")
    .insert({
      listing_id: listingId,
      storage_path: filePath,
      file_type: file.type || file.name.split(".").pop(),
      is_current: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data as MarketplaceListingFile;
}

export async function getListingFileSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from(LISTING_FILES_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function getListingFiles(listingId: string) {
  const { data, error } = await supabase
    .from("marketplace_listing_files")
    .select("*")
    .eq("listing_id", listingId)
    .eq("is_current", true);
  if (error) throw error;
  return (data ?? []) as MarketplaceListingFile[];
}

// ---- Courses (simple enroll + roster, not related to timetable) ----

export interface CourseEnrollment {
  id: string;
  listing_id: string;
  buyer_user_id: string;
  buyer_school_id: string | null;
  purchased_at: string;
}

export interface CourseRosterEntry {
  buyer_user_id: string;
  purchased_at: string;
  student_name: string | null;
  student_class: string | null;
  roll_number: string | null;
}

export async function getSchoolCourses(schoolId: string) {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*")
    .eq("publisher_school_id", schoolId)
    .eq("content_type", "course")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MarketplaceListing[];
}

// RLS scopes this to the student's own school automatically
export async function getAvailableCourses() {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*")
    .eq("content_type", "course")
    .eq("status", "published")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MarketplaceListing[];
}

export async function createCourseListing(input: {
  publisherId: string;
  publisherSchoolId: string;
  title: string;
  description: string;
  classLabel: string | null;
  syllabus: string | null;
  syllabusFile?: File | null;
}) {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .insert({
      publisher_id: input.publisherId,
      publisher_school_id: input.publisherSchoolId,
      content_type: "course",
      title: input.title,
      description: input.description,
      class_label: input.classLabel,
      syllabus: input.syllabus,
      price: 0,
      license_type: "free",
      status: "published",
      visibility: "school_only",
      published_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;

  if (input.syllabusFile) {
    await uploadSyllabusFile(data.id, input.syllabusFile);
  }
  return data as MarketplaceListing;
}

export async function enrollInCourse(listingId: string, buyerUserId: string, buyerSchoolId: string | null) {
  const { data, error } = await supabase
    .from("marketplace_purchases")
    .insert({
      listing_id: listingId,
      buyer_user_id: buyerUserId,
      buyer_school_id: buyerSchoolId,
      price_paid: 0,
      license_type: "free",
      status: "active",
    })
    .select()
    .single();
  if (error) throw error;
  return data as CourseEnrollment;
}

export async function getMyEnrolledCourseIds(buyerUserId: string) {
  const { data, error } = await supabase
    .from("marketplace_purchases")
    .select("listing_id")
    .eq("buyer_user_id", buyerUserId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.listing_id));
}

export async function unenrollFromCourse(listingId: string, buyerUserId: string) {
  const { error } = await supabase
    .from("marketplace_purchases")
    .delete()
    .eq("listing_id", listingId)
    .eq("buyer_user_id", buyerUserId);
  if (error) throw error;
}

export async function getCourseRoster(listingId: string): Promise<CourseRosterEntry[]> {
  const { data: purchases, error } = await supabase
    .from("marketplace_purchases")
    .select("buyer_user_id, purchased_at")
    .eq("listing_id", listingId)
    .order("purchased_at", { ascending: false });
  if (error) throw error;
  if (!purchases || purchases.length === 0) return [];

  const buyerIds = purchases.map((p) => p.buyer_user_id);
  const { data: students, error: studentsError } = await supabase
    .from("students")
    .select("profile_id, full_name, class, roll_number")
    .in("profile_id", buyerIds);
  if (studentsError) throw studentsError;

  const studentMap = new Map((students ?? []).map((s) => [s.profile_id, s]));
  return purchases.map((p) => {
    const s = studentMap.get(p.buyer_user_id);
    return {
      buyer_user_id: p.buyer_user_id,
      purchased_at: p.purchased_at,
      student_name: s?.full_name ?? null,
      student_class: s?.class ?? null,
      roll_number: s?.roll_number ?? null,
    };
  });
}

export async function updateCourseListing(
  listingId: string,
  input: {
    title: string;
    description: string;
    classLabel: string | null;
    syllabus: string | null;
    syllabusFile?: File | null;
  }
) {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .update({
      title: input.title,
      description: input.description,
      class_label: input.classLabel,
      syllabus: input.syllabus,
    })
    .eq("id", listingId)
    .select()
    .single();
  if (error) throw error;

  if (input.syllabusFile) {
    await uploadSyllabusFile(listingId, input.syllabusFile);
  }
  return data as MarketplaceListing;
}

const SYLLABUS_BUCKET = "course-syllabi";

export async function uploadSyllabusFile(listingId: string, file: File) {
  const filePath = `${listingId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(SYLLABUS_BUCKET).upload(filePath, file);
  if (uploadError) throw uploadError;

  const fileType = file.type || file.name.split(".").pop() || null;
  const { error } = await supabase
    .from("marketplace_listings")
    .update({ syllabus_file_path: filePath, syllabus_file_type: fileType })
    .eq("id", listingId);
  if (error) throw error;
  return filePath;
}

export async function removeSyllabusFile(listingId: string, storagePath: string) {
  await supabase.storage.from(SYLLABUS_BUCKET).remove([storagePath]);
  const { error } = await supabase
    .from("marketplace_listings")
    .update({ syllabus_file_path: null, syllabus_file_type: null })
    .eq("id", listingId);
  if (error) throw error;
}

export async function getSyllabusFileSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage.from(SYLLABUS_BUCKET).createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteCourseListing(listingId: string) {
  const { error } = await supabase.from("marketplace_listings").delete().eq("id", listingId);
  if (error) throw error;
}

// ---- Course materials (videos/docs, gated by enrollment via RLS) ----

const COURSE_MATERIALS_BUCKET = "course-materials";

export interface CourseMaterial {
  id: string;
  listing_id: string;
  material_type: "video" | "document";
  title: string;
  video_url: string | null;
  storage_path: string | null;
  file_type: string | null;
  uploaded_by: string;
  created_at: string;
}

export async function getCourseMaterials(listingId: string) {
  const { data, error } = await supabase
    .from("course_materials")
    .select("*")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CourseMaterial[];
}

export async function addCourseMaterial(input: {
  listingId: string;
  uploadedBy: string;
  title: string;
  materialType: "video" | "document";
  videoUrl?: string | null;
  file?: File | null;
}) {
  let storagePath: string | null = null;
  let fileType: string | null = null;

  if (input.file) {
    storagePath = `${input.listingId}/${Date.now()}-${input.file.name}`;
    const { error: uploadError } = await supabase.storage
      .from(COURSE_MATERIALS_BUCKET)
      .upload(storagePath, input.file);
    if (uploadError) throw uploadError;
    fileType = input.file.type || input.file.name.split(".").pop() || null;
  }

  const { data, error } = await supabase
    .from("course_materials")
    .insert({
      listing_id: input.listingId,
      material_type: input.materialType,
      title: input.title,
      video_url: input.videoUrl || null,
      storage_path: storagePath,
      file_type: fileType,
      uploaded_by: input.uploadedBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data as CourseMaterial;
}

export async function deleteCourseMaterial(materialId: string, storagePath: string | null) {
  if (storagePath) {
    await supabase.storage.from(COURSE_MATERIALS_BUCKET).remove([storagePath]);
  }
  const { error } = await supabase.from("course_materials").delete().eq("id", materialId);
  if (error) throw error;
}

export async function getCourseMaterialSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from(COURSE_MATERIALS_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}
