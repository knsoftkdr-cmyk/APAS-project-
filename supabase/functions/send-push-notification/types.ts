export interface PushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

export type NotificationChannel = "push" | "email";

export interface DispatchMessageRequest {
  source_table: string;
  source_id: string;
  recipient_id: string;
  title: string;
  body: string;
  channels?: NotificationChannel[];
}
