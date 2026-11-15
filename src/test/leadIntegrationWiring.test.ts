// Guards the wiring that unit tests of the individual modules cannot see: the browser calls `log-audit` with
// `mode: adm_int_<action>`, `log-audit` must route that to the admin handler (which switches on `action`), and the
// public webhook URL the UI shows must be dispatched by `log-audit` before any other routing.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { webhookUrl, type IntegrationAction } from "@/lib/admissionIntegrations";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const logAudit = read("supabase/functions/log-audit/index.ts");
const handler = read("supabase/functions/_shared/handlers/admissionIntegrations.ts");

// Compile-time exhaustive list: adding an IntegrationAction without listing it here is a type error.
const ACTIONS: Record<IntegrationAction, true> = {
  create: true, update: true, rotate: true, delete: true, test: true, subscribe: true, sync: true, retry: true,
};

describe("lead integrations wiring", () => {
  it.each(Object.keys(ACTIONS))("adm_int_%s is routed by log-audit to the matching handler case", (a) => {
    const re = new RegExp(`adm_int_${a}:\\s*\\{\\s*handler:\\s*handleAdmissionIntegrations,\\s*action:\\s*"${a}"\\s*\\}`);
    expect(logAudit).toMatch(re);
    expect(handler).toMatch(new RegExp(`case "${a}":`));
  });

  it("the handler has no case the UI cannot reach", () => {
    const cases = [...handler.matchAll(/^\s{6}case "(\w+)":/gm)].map((m) => m[1]);
    expect(cases.sort()).toEqual(Object.keys(ACTIONS).sort());
  });

  it("dispatches ?lead_hook before CORS preflight and merged routing (Meta handshake is a GET)", () => {
    const hook = logAudit.indexOf('searchParams.has("lead_hook")');
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(logAudit.indexOf('req.method === "OPTIONS"'));
    expect(hook).toBeLessThan(logAudit.indexOf("routeMerged(req"));
    expect(logAudit).toContain("handleLeadWebhookRequest");
  });

  it("log-audit stays public (providers cannot send a Supabase JWT) and the webhook URL points at it", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.log-audit\]\s*\nverify_jwt = false/);
    const url = new URL(webhookUrl("tok123"));
    expect(url.pathname).toBe("/functions/v1/log-audit");
    expect(url.searchParams.get("lead_hook")).toBe("tok123");
  });

  it("does not disturb the existing log-audit routes", () => {
    for (const k of ["sec_record", "sess_heartbeat", "ui_translate"]) expect(logAudit).toContain(`${k}:`);
  });

  it("every frontend import of the lead label table resolves", () => {
    expect(read("src/types/admission.ts")).toContain("export const LEAD_SOURCE_LABELS");
  });
});
