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
  | "resource" | "third_party_app";

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
}

export interface MarketplacePurchase {
  id: string;
  listing_id: string;
  buyer_school_id: string | null;
  buyer_user_id: string;
  price_paid: number;
  license_type: string;
  status: string;
  purchased_at: string;
}

const LISTING_FILES_BUCKET = "marketplace-listing-files";

// ---- Categories ----
export async function getMarketplaceCategories() {
  const { data, error } = await supabase
    .from("marketplace_categories")
    .select("*")
    .eq("publishing_status", "published")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MarketplaceCategory[];
}

// ---- Browse (published listings) ----
export async function getBrowseListings(filters?: { categoryId?: string; contentType?: string }) {
  let query = supabase
    .from("marketplace_listings")
    .select("*")
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (filters?.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters?.contentType) query = query.eq("content_type", filters.contentType);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MarketplaceListing[];
}

// ---- My listings (as publisher) ----
export async function getMyListings(publisherId: string) {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*")
    .eq("publisher_id", publisherId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MarketplaceListing[];
}

export async function createListing(input: {
  publisherId: string;
  publisherSchoolId: string | null;
  categoryId: string | null;
  contentType: MarketplaceContentType;
  title: string;
  description: string;
  visibility: "public" | "school_only" | "private";
}) {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .insert({
      publisher_id: input.publisherId,
      publisher_school_id: input.publisherSchoolId,
      category_id: input.categoryId,
      content_type: input.contentType,
      title: input.title,
      description: input.description,
      price: 0,
      license_type: "free",
      status: "draft",
      visibility: input.visibility,
    })
    .select()
    .single();
  if (error) throw error;
  return data as MarketplaceListing;
}

export async function publishListing(listingId: string) {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", listingId)
    .select()
    .single();
  if (error) throw error;
  return data as MarketplaceListing;
}

export async function archiveListing(listingId: string) {
  const { error } = await supabase
    .from("marketplace_listings")
    .update({ status: "archived" })
    .eq("id", listingId);
  if (error) throw error;
}

// ---- Files ----
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
  return data;
}

export async function getListingFileSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from(LISTING_FILES_BUCKET)
    .createSignedUrl(storagePath, 60);
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
  return data ?? [];
}

// ---- Entitlements (free acquisition for now; payment fields ready for later) ----
export async function acquireListing(listingId: string, buyerUserId: string, buyerSchoolId: string | null) {
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
  return data as MarketplacePurchase;
}

export async function getMyAcquisitions(buyerUserId: string) {
  const { data, error } = await supabase
    .from("marketplace_purchases")
    .select("*, marketplace_listings(*)")
    .eq("buyer_user_id", buyerUserId)
    .eq("status", "active")
    .order("purchased_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}