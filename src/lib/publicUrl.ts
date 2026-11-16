// Links that leave the app (QR codes, parent enquiry forms) must open for people who aren't using this device. In the
// Android app window.location is https://localhost, so set VITE_PUBLIC_SITE_URL to the deployed site for those builds.

export function publicSiteOrigin(): string {
  const configured = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return window.location.origin;
}

export const certificateVerifyUrl = (code: string) => `${publicSiteOrigin()}/verify-certificate/${encodeURIComponent(code)}`;
export const enquiryFormUrl = (schoolId: string) => `${publicSiteOrigin()}/enquiry/${encodeURIComponent(schoolId)}`;
