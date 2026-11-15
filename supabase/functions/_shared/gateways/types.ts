// _shared/gateways/types.ts
// The one interface every payment gateway implements. Each adapter does exactly three things:
//   1. createOrder  - open an order/session at the gateway for an amount the SERVER read from the database
//   2. fetchStatus  - ask the gateway what really happened (authoritative; the browser is never believed)
//   3. parseWebhook - verify the gateway's signature on a server-to-server callback and say what it means
// Everything after that (crediting balances, receipts, refunds, duplicates) is gateway-neutral and lives in the database.

export type GatewayId = "razorpay" | "stripe" | "payu" | "cashfree";
export const GATEWAY_IDS: GatewayId[] = ["razorpay", "stripe", "payu", "cashfree"];
export const isGatewayId = (v: unknown): v is GatewayId => typeof v === "string" && (GATEWAY_IDS as string[]).includes(v);

/** Money is always integer minor units (paise / cents) once it leaves the database. */
export const toMinor = (amount: number | string): number => Math.round(Number(amount) * 100);

export interface Customer { name?: string; email?: string; phone?: string }

export interface CreateOrderInput {
  merchantRef: string;          // our own unique reference for this attempt (<= 40 chars, [a-z0-9_])
  amountMinor: number;
  currency: string;
  description: string;
  customer: Customer;
  appBaseUrl: string | null;    // where the browser comes back to after a redirect gateway
  functionUrl: string;          // public URL of the verify function (webhooks / PayU return)
  notes: Record<string, string>;
}

/** What the browser needs to start paying. Contains NO secrets (only public keys / one-time session ids / signed form fields). */
export type Checkout =
  | { type: "razorpay"; key_id: string; order_id: string; amount: number; currency: string }
  | { type: "redirect"; url: string }
  | { type: "form_post"; url: string; fields: Record<string, string> }
  | { type: "cashfree"; payment_session_id: string; mode: "sandbox" | "production" };

export type CreateOrderResult = { ok: true; orderId: string; checkout: Checkout } | { ok: false; error: string };

export type Decision =
  | { kind: "success"; paymentId: string; method: string | null }
  | { kind: "pending"; paymentId: string | null }
  | { kind: "failed"; paymentId: string | null; reason: string }
  | { kind: "mismatch"; reason: string };

export type HookAction =
  | { kind: "payment_success"; orderId: string; paymentId: string; amountMinor: number; method: string | null }
  | { kind: "payment_failed"; orderId: string; paymentId: string | null; reason: string }
  | { kind: "refund"; paymentId: string; orderId?: string; totalRefundedMinor?: number }   // total omitted => ask the gateway (cumulativeRefundMinor)
  | { kind: "ignore"; reason: string };

export interface GatewayAdapter {
  id: GatewayId;
  label: string;
  /** Names of the required Supabase secrets that are NOT set (empty = ready). Never returns values. */
  missingConfig(): string[];
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  fetchStatus(orderId: string, expected: { amountMinor: number; currency: string }): Promise<Decision>;
  /** null = the signature is invalid (reject with 401). */
  parseWebhook(headers: Headers, raw: string): Promise<HookAction | null>;
  /** Cumulative refunded amount for a payment, straight from the gateway. */
  cumulativeRefundMinor(action: Extract<HookAction, { kind: "refund" }>): Promise<number>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
