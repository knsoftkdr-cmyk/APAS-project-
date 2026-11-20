// supabase/functions/_shared/telephony/providers.ts
// Provider registry. Adding a provider = one adapter file + one line here; nothing else in APAS names a provider.
import { ProviderNotConfigured, type ProviderName, type TelephonyProvider } from "../telephonyModel.ts";
import { ExotelProvider, exotelConfigFromEnv, type FetchLike } from "./exotel.ts";
import { AirtelIqProvider } from "./airtelIq.ts";

export function getProvider(name: string, env: (k: string) => string | undefined, fetchFn?: FetchLike): TelephonyProvider {
  switch (name as ProviderName) {
    case "exotel": return new ExotelProvider(exotelConfigFromEnv(env), fetchFn);
    case "airtel_iq": return new AirtelIqProvider();
    default: throw new ProviderNotConfigured(`Unknown telephony provider "${name}".`);
  }
}
