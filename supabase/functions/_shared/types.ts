export interface EmailAttachment {
  filename: string;
  content: string; // base64-encoded, no data: prefix
}

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
}

export interface DispatchMessageRequest {
  recipient?: { email?: string; push_token?: string; [key: string]: unknown };
  title: string;
  body: string;
  targetChannels?: string[];
  [key: string]: unknown;
}