export type IncidentCategory =
  | "physical"
  | "emotional"
  | "neglect"
  | "online"
  | "bullying"
  | "other";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export type IncidentStatus =
  | "reported"
  | "under_review"
  | "escalated"
  | "resolved"
  | "closed";

export interface SafeguardingIncident {
  id: string;
  school_id: string;
  student_id: string | null;
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  status: IncidentStatus;
  is_anonymous: boolean;
  reported_by: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  // Joined fields (populated client-side when fetching with a join)
  student_name?: string | null;
}

export interface SafeguardingIncidentUpdate {
  id: string;
  incident_id: string;
  note: string;
  status_change: string | null;
  updated_by: string;
  created_at: string;
}