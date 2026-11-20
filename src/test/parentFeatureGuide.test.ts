import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// AppSidebar (the menu definitions we compare against) pulls in app services; none are exercised here.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "parent" } }) }));

import { navItems, isNavItemAllowedForRole, PARENT_NAV_MODULES } from "@/components/layout/AppSidebar";
import {
  PARENT_FEATURES,
  allParentFeatures,
  parentMenuRows,
  uncuratedParentRows,
  selectParentFeatures,
  parentFeatureIndex,
  describeParentFeature,
  buildParentFeatureGuidePrompt,
} from "../../supabase/functions/_shared/parentFeatureGuide";
import { GENERATED_NAV, GENERATED_PARENT_MODULES } from "../../supabase/functions/_shared/featureManifest.generated";
// @ts-expect-error - plain .mjs tool, no types
import { parseSidebar, render } from "../../tools/generate-feature-manifest.mjs";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const ids = (text: string, history: { role: string; text: string }[] = []) => selectParentFeatures(text, history).map((f) => f.id);

// ───────────────────────────── the guide cannot fall behind the app ─────────────────────────────
describe("Parent feature guide - covers everything a parent can open", () => {
  const parentPaths = new Set(
    navItems
      .filter((it) => isNavItemAllowedForRole(it, "parent"))
      .flatMap((it) => [it.path, ...(it.subItem ? [it.subItem.path] : [])]),
  );
  const covered = new Set(PARENT_FEATURES.flatMap((f) => f.routes ?? []));

  it("knows every menu page a parent can see (written entry or automatic one)", () => {
    const known = new Set(allParentFeatures().flatMap((f) => f.routes ?? []));
    expect([...parentPaths].filter((p) => !known.has(p))).toEqual([]);
  });

  it("reports menu pages that have no written how-to yet (they are still known by name)", () => {
    const names = uncuratedParentRows().map((r) => `${r.name} (${r.path})`);
    if (names.length) console.warn(`Parent assistant: known by name only, add details in parentFeatureGuide.ts: ${names.join(", ")}`);
    expect(Array.isArray(names)).toBe(true);
  });

  it("does not describe pages a parent cannot open (no stale routes)", () => {
    expect([...covered].filter((p) => !parentPaths.has(p))).toEqual([]);
  });

  it("has an entry for every Student 360 Profile tab", () => {
    const src = read("src/components/student/Student360Profile.tsx");
    const block = src.slice(src.indexOf("const TABS = ["), src.indexOf("] as const", src.indexOf("const TABS = [")));
    const labels = [...block.matchAll(/value:\s*"[^"]+",\s*label:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(5);
    const described = new Set(PARENT_FEATURES.flatMap((f) => f.profileTabs ?? []));
    expect(labels.filter((l) => !described.has(l))).toEqual([]);
  });

  it("covers the Home dashboard tabs and the screens that are not in the menu (fees, pickup, bus)", () => {
    const home = read("src/pages/ParentDashboard.tsx");
    for (const label of ["Test Scores", "Homework", "Pickup Guardians", "Bus Tracking", "Pay Fees", "Add Guardian", "View Report"]) expect(home).toContain(label);
    for (const id of ["home", "pickup-guardians", "bus-tracking", "fee-payment", "fee-instalments"]) {
      expect(PARENT_FEATURES.some((f) => f.id === id), id).toBe(true);
    }
  });

  it("is generated from the same module list the parent sidebar uses", () => {
    expect([...GENERATED_PARENT_MODULES].sort()).toEqual([...PARENT_NAV_MODULES].sort());
  });
});

describe("Parent feature guide - the on-screen names it quotes really exist", () => {
  // If someone renames a button, this fails and the guide gets updated instead of telling parents about a button that is gone.
  const mustExist: [string, string[]][] = [
    ["src/pages/ParentFeePayment.tsx", ["Payment Gateway", "Finance (Easy Monthly Installments)", "Student Information", "Fee Particulars", "Proceed For Payment", "Select Exam", "Payment history", "Payment successful", "Payment is being confirmed", "Payment failed"]],
    ["src/components/erp-fees/instalments/ParentInstalmentPanel.tsx", ["Request instalments", "Pay Now", "Receipt", "Payment schedule", "Plan progress", "Instalment requests", "Fee summary", "Check"]],
    ["src/pages/AppointmentBooking.tsx", ["Available slots (next 14 days)", "Meeting mode", "In person", "Virtual", "Reason", "Cancel", "Confirm", "Decline"]],
    ["src/pages/ParentCommunicationCenter.tsx", ["Communication Center", "Search teachers", "Type a message..."]],
    ["src/components/safeguarding/ParentSafeguardingView.tsx", ["No reports on file", "Nothing has been filed about your child."]],
    ["src/components/transport/DriverRatingForm.tsx", ["Rate your driver this semester"]],
  ];
  it.each(mustExist)("%s", (file, labels) => {
    const src = read(file);
    for (const l of labels) expect(src, `"${l}" not found in ${file}`).toContain(l);
  });
});

describe("Parent feature guide - entries are well formed", () => {
  it("has unique ids and names", () => {
    expect(new Set(PARENT_FEATURES.map((f) => f.id)).size).toBe(PARENT_FEATURES.length);
    expect(new Set(PARENT_FEATURES.map((f) => f.name)).size).toBe(PARENT_FEATURES.length);
  });

  it("every entry says where it is, what it is, and how it can be asked for", () => {
    for (const f of PARENT_FEATURES) {
      expect(f.where.length, f.id).toBeGreaterThan(5);
      expect(f.summary.length, f.id).toBeGreaterThan(15);
      expect(f.keywords.length, f.id).toBeGreaterThan(0);
    }
  });

  it("is plain text, because answers are read aloud (no markdown characters)", () => {
    for (const f of allParentFeatures()) expect(describeParentFeature(f), f.id).not.toMatch(/[*#`|]|\]\(/);
  });

  it("never asks a parent to share card numbers, OTPs or passwords", () => {
    const all = PARENT_FEATURES.map(describeParentFeature).join(" ");
    expect(all).not.toMatch(/enter your (card|otp|pin|password)/i);
  });
});

// ───────────────────────────── automatic layer ─────────────────────────────
describe("Parent feature manifest - generated from the real sidebar", () => {
  it("is up to date (run `npm run features:generate` if this fails)", () => {
    const expected = render(parseSidebar(read("src/components/layout/AppSidebar.tsx")));
    expect(read("supabase/functions/_shared/featureManifest.generated.ts") === expected, "stale: run npm run features:generate").toBe(true);
  });

  it("gives the same parent menu as the sidebar's own visibility rule", () => {
    const fromSidebar = navItems
      .filter((it) => isNavItemAllowedForRole(it, "parent"))
      .flatMap((it) => [it.path, ...(it.subItem ? [it.subItem.path] : [])]);
    expect([...new Set(parentMenuRows().map((r) => r.path))].sort()).toEqual([...new Set(fromSidebar)].sort());
  });
});

describe("A brand-new parent page is known automatically", () => {
  const nav = [
    ...GENERATED_NAV,
    { title: "Fee Reminders", path: "/fee-reminders", roles: ["parent"] },
    { title: "School Photos", path: "/school-photos" }, // no roles = everyone
    { title: "Staff Payroll", path: "/payroll", roles: ["parent"], module: "Payroll" }, // module not allowed for parents
    { title: "Teacher Only", path: "/teacher-only", roles: ["teacher"] },
  ];
  const feats = allParentFeatures(nav);

  it("adds an entry for each new page a parent can see, and none for pages they cannot", () => {
    expect(feats.find((f) => f.name === "Fee Reminders")?.auto).toBe(true);
    expect(feats.find((f) => f.name === "School Photos")?.auto).toBe(true);
    expect(feats.some((f) => f.name === "Staff Payroll")).toBe(false);
    expect(feats.some((f) => f.name === "Teacher Only")).toBe(false);
  });

  it("finds it when asked, even a little misspelt", () => {
    expect(selectParentFeatures("what is school photos", [], 3, feats)[0]?.name).toBe("School Photos");
    expect(selectParentFeatures("what is school fotos", [], 3, feats)[0]?.name).toBeUndefined(); // 'fotos' is too far: no false certainty
    expect(selectParentFeatures("what is fee remnders", [], 3, feats)[0]?.name).toBe("Fee Reminders");
  });

  it("tells the model the page exists but its details are not written", () => {
    const p = buildParentFeatureGuidePrompt("what is school photos", [], feats);
    expect(p).toContain("School Photos: a page in your left menu (details not written yet)");
    expect(p).toContain("Its full details are not in my notes yet");
  });

  it("does not duplicate written entries", () => {
    const names = feats.map((f) => f.name.replace(/\s*\(.*\)$/, ""));
    expect(names.filter((n) => n === "Surveys")).toHaveLength(1);
    expect(names.filter((n) => n === "Safeguarding")).toHaveLength(1);
  });
});

// ───────────────────────────── choosing what to explain ─────────────────────────────
describe("selectParentFeatures - finds the feature a parent is asking about", () => {
  it.each([
    ["how do I pay fees?", "fee-payment"],
    ["where can I pay my child's school fees", "fee-payment"],
    ["my payment is stuck what should I do", "fee-payment"],
    ["how do I get the fee receipt", "fee-payment"],
    ["can I pay in installments", "fee-instalments"],
    ["what is easy monthly installments", "fee-instalments"],
    ["how do I request instalments", "fee-instalments"],
    ["what is the fee plan tab", "profile-fees"],
    ["what is pickup guardians", "pickup-guardians"],
    ["how do I add someone to pick up my child early", "pickup-guardians"],
    ["how do I track the school bus", "bus-tracking"],
    ["where is the bus now", "bus-tracking"],
    ["how do I rate the driver", "bus-tracking"],
    ["how do I book a meeting with the teacher", "appointments"],
    ["what is ptm", "appointments"],
    ["how do I message my child's teacher", "communication"],
    ["what is the communication center", "communication"],
    ["what is safeguarding", "safeguarding"],
    ["how do I see my child's attendance", "attendance"],
    ["where is the report card", "report-cards"],
    ["how do I download hall ticket", "hall-tickets"],
    ["when are the holidays", "academic-calendar"],
    ["what is a survey", "surveys"],
    ["what is my child's student profile", "student-profile"],
    ["what is the learning twin", "profile-learning-twin"],
    ["what is ask apas", "ask-apas"],
    ["what does ctrl k do", "global-search"],
    ["how do I see homework", "home"],
    ["what is the parent dashboard", "home"],
    ["what is pickup gaurdians", "pickup-guardians"], // typo
    ["how do i check atendance", "attendance"], // typo
    ["how do i book an apointment", "appointments"], // typo
  ])("%s -> %s", (q, id) => {
    expect(ids(q)[0]).toBe(id);
  });

  it("understands a short follow-up from the conversation so far", () => {
    const history = [
      { role: "user", text: "What is pickup guardians?" },
      { role: "assistant", text: "Pickup Guardians is where you add people allowed to collect your child." },
    ];
    expect(ids("how do I use it?", history)[0]).toBe("pickup-guardians");
  });

  it("lets the current question win over older conversation", () => {
    const history = [{ role: "user", text: "What is pickup guardians?" }, { role: "assistant", text: "..." }];
    expect(ids("and how do I pay fees", history)[0]).toBe("fee-payment");
  });

  it("does not match plain academic or small-talk messages", () => {
    expect(ids("explain photosynthesis")).toEqual([]);
    expect(ids("hello")).toEqual([]);
    expect(ids("what is 12 times 8")).toEqual([]);
  });

  it("returns at most 3 features and is safe with empty or odd input", () => {
    expect(selectParentFeatures("fees bus attendance survey message homework", []).length).toBeLessThanOrEqual(3);
    expect(selectParentFeatures("", [])).toEqual([]);
    expect(selectParentFeatures("what is (this [feature] *", [])).toEqual([]);
  });
});

// ───────────────────────────── the prompt section ─────────────────────────────
describe("buildParentFeatureGuidePrompt", () => {
  it("always lists every feature, so nothing is 'unknown'", () => {
    const p = buildParentFeatureGuidePrompt("hello", []);
    for (const f of allParentFeatures()) expect(p).toContain(f.name);
    expect(p).not.toContain("FULL DETAILS");
    expect(parentFeatureIndex().split("\n")).toHaveLength(allParentFeatures().length);
  });

  it("gives the real steps for paying fees, in order, and what to do when it is stuck", () => {
    const p = buildParentFeatureGuidePrompt("how do I pay fees?", []);
    expect(p).toContain("FULL DETAILS");
    expect(p).toContain("press Pay Fees");
    expect(p).toContain("Proceed For Payment");
    expect(p.indexOf("press Pay Fees")).toBeLessThan(p.indexOf("Proceed For Payment"));
    expect(p).toContain("Do not pay again");
    expect(p).toContain("Payment failed, no money was recorded");
  });

  it("says the fee plan tab is view-only and points to Pay Fees for paying", () => {
    const p = buildParentFeatureGuidePrompt("what is the fee plan tab", []);
    expect(p).toContain("This tab is for viewing");
    expect(p).toContain("use Pay Fees on your Home page");
  });
});

// ───────────────────────────── wiring in the edge function ─────────────────────────────
describe("parent-assistant uses the guide", () => {
  const src = read("supabase/functions/parent-assistant/index.ts");

  it("imports the guide and puts it in the system prompt, before the data", () => {
    expect(src).toContain('from "../_shared/parentFeatureGuide.ts"');
    expect(src).toContain("buildParentFeatureGuidePrompt(");
    expect(src.indexOf("buildParentFeatureGuidePrompt(")).toBeLessThan(src.lastIndexOf("CURRENT DATA:"));
  });

  it("explains features instead of saying it does not know them, and does not swap pages", () => {
    expect(src).toContain('NEVER say "I don\'t know this feature"');
    expect(src).toContain("never guess that the parent means a different page");
    expect(src).toContain("details not written yet");
  });

  it("asks for a warm, simple, step-by-step layout (not a paragraph)", () => {
    expect(src).toContain("Speak warmly and respectfully");
    expect(src).toContain("do NOT write a paragraph");
    expect(src).toContain('"Step 1:", "Step 2:", "Step 3:"');
    expect(src).toContain('one line starting "Tip:"');
  });

  it("has money-safety rules, and only offers to open real menu pages", () => {
    expect(src).toContain("never ask for or repeat card numbers, OTPs, PINs or passwords");
    expect(src).toContain("never tell the parent a payment went through unless CURRENT DATA says so");
    expect(src).toContain("press Pay Fees on the Home page instead, because it is not a menu page");
  });

  it("keeps app questions out of the YouTube topic route", () => {
    expect(src).toContain("how the APAS app itself works");
  });

  it("still keeps the original data-only rules for the child's own records", () => {
    expect(src).toContain("SECURITY: you have information ONLY about this parent's own child(ren)");
    expect(src).toContain("never invent dates, amounts, scores, contact details, or seat numbers");
  });
});

describe("the parent chat bubble keeps line breaks", () => {
  it("renders assistant text with whitespace-pre-line so the steps do not collapse into a paragraph", () => {
    expect(read("src/components/parent-transport/ParentBusAssistantWidget.tsx")).toContain('<p className="whitespace-pre-line">{m.text}</p>');
  });
});
