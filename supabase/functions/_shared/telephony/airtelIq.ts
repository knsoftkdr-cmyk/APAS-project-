// supabase/functions/_shared/telephony/airtelIq.ts
//
// Airtel IQ - READINESS ONLY. This adapter exists so the rest of APAS is provider-neutral and Airtel IQ can be plugged in later.
// It deliberately does not call any Airtel API: no endpoints, auth scheme or callback format have been verified against Airtel's
// documentation or an approved account. Every operation reports that clearly instead of pretending to work.

import {
  normalizePhone, ProviderNotConfigured,
  type InitiateCallResult, type NormalizedCallEvent, type PhoneResult, type TelephonyProvider,
} from "../telephonyModel.ts";

const NOT_READY = "Airtel IQ is not integrated yet. Select Exotel, or implement and test the Airtel IQ adapter with an approved account first.";

export class AirtelIqProvider implements TelephonyProvider {
  readonly name = "airtel_iq" as const;
  assertConfigured(): never { throw new ProviderNotConfigured(NOT_READY); }
  validatePhoneNumber(raw: unknown): PhoneResult { return normalizePhone(raw); }
  initiateCall(): Promise<InitiateCallResult> { return Promise.reject(new ProviderNotConfigured(NOT_READY)); }
  getCallStatus(): Promise<NormalizedCallEvent> { return Promise.reject(new ProviderNotConfigured(NOT_READY)); }
  getCallDetails(): Promise<NormalizedCallEvent> { return Promise.reject(new ProviderNotConfigured(NOT_READY)); }
  processWebhook(): NormalizedCallEvent | null { return null; }
}
