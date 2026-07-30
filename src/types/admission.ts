export type ApplicantStatus =
  | "under_review"
  | "shortlisted"
  | "selected"
  | "waitlisted"
  | "rejected"
  | "admitted"
  | "withdrawn";

export type ApplicantSource = "walk_in" | "referral" | "phone_enquiry" | "online_enquiry" | "other";

export type ApplicantGender = "male" | "female" | "other";

export type AdmissionDocumentType =
  | "report_card"
  | "birth_certificate"
  | "id_proof"
  | "transfer_certificate"
  | "photo"
  | "other";

export interface AdmissionIntake {
  id: string;
  school_id: string;
  academic_year: string;
  grade: string;
  total_seats: number;
  min_percentage_required: number | null;
  criteria_notes: string | null;
  is_open: boolean;
  opens_on: string | null;
  closes_on: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // populated client-side from admission_intake_seat_summary
  seats_filled?: number;
  seats_remaining?: number;
  applicants_pending_review?: number;
}

export interface AdmissionApplicant {
  id: string;
  intake_id: string;
  school_id: string;
  full_name: string;
  date_of_birth: string | null;
  gender: ApplicantGender | null;
  parent_name: string;
  parent_phone: string;
  parent_email: string | null;
  address: string | null;
  previous_school_name: string | null;
  previous_grade: string | null;
  previous_percentage: number | null;
  sibling_studying_here: boolean;
  distance_from_school_km: number | null;
  category: string | null;
  source: ApplicantSource;
  meeting_date: string;
  meeting_notes: string | null;
  priority_score: number | null;
  status: ApplicantStatus;
  decision_notes: string | null;
  decided_by: string | null;
  decided_at: string | null;
  recorded_by: string;
  created_at: string;
  updated_at: string;
  // joined fields (populated client-side)
  intake?: Pick<AdmissionIntake, "id" | "grade" | "academic_year" | "total_seats">;
  // embedded count aggregate from admission_documents, e.g. [{ count: 3 }]
  documents?: { count: number }[];
}

export interface AdmissionDocument {
  id: string;
  applicant_id: string;
  school_id: string;
  document_type: AdmissionDocumentType;
  file_path: string;
  file_name: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export const APPLICANT_STATUS_LABELS: Record<ApplicantStatus, string> = {
  under_review: "Under Review",
  shortlisted: "Shortlisted",
  selected: "Selected",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  admitted: "Admitted",
  withdrawn: "Withdrawn",
};

export const APPLICANT_STATUS_BADGE_VARIANT: Record<ApplicantStatus, "success" | "warning" | "danger" | "info"> = {
  under_review: "info",
  shortlisted: "warning",
  selected: "success",
  waitlisted: "warning",
  rejected: "danger",
  admitted: "success",
  withdrawn: "danger",
};

export const APPLICANT_SOURCE_LABELS: Record<ApplicantSource, string> = {
  walk_in: "Walk-in",
  referral: "Referral",
  phone_enquiry: "Phone Enquiry",
  online_enquiry: "Online Enquiry",
  other: "Other",
};

export const DOCUMENT_TYPE_LABELS: Record<AdmissionDocumentType, string> = {
  report_card: "Report Card",
  birth_certificate: "Birth Certificate",
  id_proof: "ID Proof",
  transfer_certificate: "Transfer Certificate",
  photo: "Photo",
  other: "Other",
};

// Known pre-primary stages, in the order they should sort before numbered grades.
const KNOWN_GRADE_ORDER = ["nursery", "pre-kg", "prekg", "pp1", "lkg", "pp2", "ukg"];

/**
 * Returns a sortable rank for a free-text grade label like "Nursery", "LKG",
 * "UKG", "Grade 5", "Class 10", "5". Lower = earlier. Recognized pre-primary
 * stages come first, then numbered grades in numeric order, then anything
 * unrecognized sorts last (alphabetically, via the caller's tiebreaker).
 */
export function getGradeSortRank(gradeLabel: string): number {
  const normalized = gradeLabel
    .trim()
    .toLowerCase()
    .replace(/^grade\s+/, "")
    .replace(/^class\s+/, "");

  const knownIndex = KNOWN_GRADE_ORDER.indexOf(normalized);
  if (knownIndex !== -1) return knownIndex;

  const numeric = normalized.match(/\d+/);
  if (numeric) return 100 + parseInt(numeric[0], 10);

  return 1000;
}