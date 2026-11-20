import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// AppSidebar (the menu definitions we compare against) pulls in app services; none are exercised here.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "student" } }) }));

import { navItems, isNavItemAllowedForRole } from "@/components/layout/AppSidebar";
import {
  STUDENT_FEATURES,
  allStudentFeatures,
  studentMenuRows,
  uncuratedStudentRows,
  selectFeatures,
  featureIndex,
  describeFeature,
  buildFeatureGuidePrompt,
} from "../../supabase/functions/_shared/studentFeatureGuide";
import { GENERATED_NAV, GENERATED_STUDENT_MODULES } from "../../supabase/functions/_shared/featureManifest.generated";
// @ts-expect-error - plain .mjs tool, no types
import { parseSidebar, render } from "../../tools/generate-feature-manifest.mjs";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const ids = (text: string, history: { role: string; text: string }[] = []) => selectFeatures(text, history).map((f) => f.id);

// ───────────────────────────── the guide cannot fall behind the app ─────────────────────────────
describe("Study Buddy feature guide - covers everything a student can open", () => {
  // Everything the student sees in the sidebar, plus the two tabs that have no sidebar row of their own.
  const studentPaths = (() => {
    const set = new Set<string>();
    for (const it of navItems) {
      if (!isNavItemAllowedForRole(it, "student")) continue;
      set.add(it.path);
      if (it.subItem) set.add(it.subItem.path);
    }
    set.add("/exam-readiness");
    set.add("/flashcards");
    return set;
  })();
  const covered = new Set(STUDENT_FEATURES.flatMap((f) => f.routes ?? []));

  it("knows every sidebar page a student can see (written entry or automatic one)", () => {
    const known = new Set(allStudentFeatures().flatMap((f) => f.routes ?? []));
    const missing = [...studentPaths].filter((p) => !known.has(p) && !["/exam-readiness", "/flashcards"].includes(p));
    expect(missing).toEqual([]);
  });

  it("reports menu pages that have no written how-to yet (they are still known by name)", () => {
    const names = uncuratedStudentRows().map((r) => `${r.name} (${r.path})`);
    if (names.length) console.warn(`Study Buddy: known by name only, add details in studentFeatureGuide.ts: ${names.join(", ")}`);
    expect(Array.isArray(names)).toBe(true);
  });

  it("does not describe pages a student cannot open (no stale routes)", () => {
    const stale = [...covered].filter((p) => !studentPaths.has(p));
    expect(stale).toEqual([]);
  });

  it("has an entry for every Student 360 Profile tab", () => {
    const src = read("src/components/student/Student360Profile.tsx");
    const block = src.slice(src.indexOf("const TABS = ["), src.indexOf("] as const", src.indexOf("const TABS = [")));
    const labels = [...block.matchAll(/value:\s*"[^"]+",\s*label:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(5); // the parse itself works
    const described = new Set(STUDENT_FEATURES.flatMap((f) => f.profileTabs ?? []));
    const missing = labels.filter((l) => !described.has(l));
    expect(missing, `Student 360 tabs with no guide entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("describes the My Engagement Score card shown on the dashboard", () => {
    expect(read("src/components/engagement/StudentEngagementCard.tsx")).toContain("My Engagement Score");
    expect(STUDENT_FEATURES.some((f) => f.name === "My Engagement Score")).toBe(true);
  });
});

describe("Study Buddy feature guide - entries are well formed", () => {
  it("has unique ids and names", () => {
    expect(new Set(STUDENT_FEATURES.map((f) => f.id)).size).toBe(STUDENT_FEATURES.length);
    expect(new Set(STUDENT_FEATURES.map((f) => f.name)).size).toBe(STUDENT_FEATURES.length);
  });

  it("every entry says where it is, what it is, and how it can be asked for", () => {
    for (const f of STUDENT_FEATURES) {
      expect(f.where.length, f.id).toBeGreaterThan(5);
      expect(f.summary.length, f.id).toBeGreaterThan(15);
      expect(f.keywords.length, f.id).toBeGreaterThan(0);
    }
  });

  it("is plain text, because answers are read aloud (no markdown characters)", () => {
    for (const f of STUDENT_FEATURES) {
      const text = describeFeature(f);
      expect(text, f.id).not.toMatch(/[*#`|]|\]\(/);
    }
  });
});

// ───────────────────────────── automatic layer: stays current without editing the guide ─────────────────────────────
describe("Study Buddy feature manifest - generated from the real sidebar", () => {
  it("is up to date (run `npm run features:generate` if this fails)", () => {
    const expected = render(parseSidebar(read("src/components/layout/AppSidebar.tsx")));
    const actual = read("supabase/functions/_shared/featureManifest.generated.ts");
    expect(actual === expected, "featureManifest.generated.ts is stale: run npm run features:generate").toBe(true);
  });

  it("matches the real navItems row for row", () => {
    expect(GENERATED_NAV).toHaveLength(navItems.length);
    navItems.forEach((it, i) => {
      const g = GENERATED_NAV[i];
      expect(g.title, `row ${i}`).toBe(it.title);
      expect(g.path, `row ${i}`).toBe(it.path);
      expect(g.roles, `row ${i}`).toEqual(it.roles);
      expect(g.module, `row ${i}`).toBe(it.module);
      expect(g.studentTitle, `row ${i}`).toBe(it.studentTitle);
      expect(g.subItem?.path, `row ${i}`).toBe(it.subItem?.path);
    });
  });

  it("gives the same student menu as the sidebar's own visibility rule", () => {
    const fromSidebar = navItems
      .filter((it) => isNavItemAllowedForRole(it, "student"))
      .flatMap((it) => [it.path, ...(it.subItem ? [it.subItem.path] : [])]);
    expect([...new Set(studentMenuRows().map((r) => r.path))].sort()).toEqual([...new Set(fromSidebar)].sort());
    expect(GENERATED_STUDENT_MODULES.length).toBeGreaterThan(5);
  });

  it("uses the name the student sees (studentTitle) when there is one", () => {
    const rows = studentMenuRows([{ title: "Diagnostics", studentTitle: "Assessments", path: "/diagnostic", roles: ["student"] }], []);
    expect(rows).toEqual([{ name: "Assessments", path: "/diagnostic" }]);
  });
});

describe("A brand-new student feature is known automatically", () => {
  // Pretend the sidebar just gained these rows and nobody has touched the guide.
  const nav = [
    ...GENERATED_NAV,
    { title: "Brain Gym", path: "/brain-gym", roles: ["student"] },
    { title: "Study Streaks", path: "/study-streaks" }, // no roles = everyone
    { title: "Billing Hub", path: "/billing-hub", roles: ["student"], module: "Billing" }, // hidden from students
    { title: "Teacher Only Thing", path: "/teacher-only", roles: ["teacher"] },
  ];
  const feats = allStudentFeatures(nav);

  it("adds an entry for each new page a student can see, and none for pages they cannot", () => {
    expect(feats.find((f) => f.name === "Brain Gym")?.auto).toBe(true);
    expect(feats.find((f) => f.name === "Study Streaks")?.auto).toBe(true);
    expect(feats.some((f) => f.name === "Billing Hub")).toBe(false);
    expect(feats.some((f) => f.name === "Teacher Only Thing")).toBe(false);
  });

  it("finds it when a student asks about it, even a little misspelt", () => {
    expect(selectFeatures("what is brain gym?", [], 3, feats)[0]?.name).toBe("Brain Gym");
    expect(selectFeatures("what is study streeks", [], 3, feats)[0]?.name).toBe("Study Streaks");
  });

  it("tells the model the page exists but its details are not written, so it does not invent them", () => {
    const p = buildFeatureGuidePrompt("what is brain gym", [], feats);
    expect(p).toContain("Brain Gym: a page in your left menu (details not written yet)");
    expect(p).toContain("Where: Left menu, Brain Gym.");
    expect(p).toContain("Its full details are not in my notes yet");
  });

  it("leaves written entries alone and does not duplicate them", () => {
    const names = feats.map((f) => f.name);
    expect(names.filter((n) => n === "Credentials")).toHaveLength(1);
    expect(names.filter((n) => n === "Surveys")).toHaveLength(1);
  });
});

// ───────────────────────────── My Doubts (from the live screen) ─────────────────────────────
describe("My Doubts - the page the Study Buddy did not know", () => {
  it.each([
    "what is the my doubts",
    "what is the my doughts", // exactly what voice typing produced in the screenshot
    "what is my doubts page",
    "how do I ask a doubt",
    "how can I ask my teacher a question",
    "where do I see my resolved doubts",
  ])("%s", (q) => {
    expect(selectFeatures(q)[0]?.id).toBe("my-doubts");
  });

  it("explains it with steps and what the three counters mean", () => {
    const p = buildFeatureGuidePrompt("what is the my doughts", []);
    expect(p).toContain("FULL DETAILS");
    expect(p).toContain("Press the Ask a doubt button");
    expect(p).toContain("New, In Progress and Resolved");
    expect(p).toContain("Search doubts");
  });
});

// ───────────────────────────── choosing what to explain ─────────────────────────────
describe("selectFeatures - finds the feature a student is asking about", () => {
  it.each([
    ["What is Daily Review?", "daily-review"],
    ["how do I use the adaptive test", "adaptive-test"],
    ["what are flashcards", "flashcards"],
    ["explain the forgetting forecast to me", "forgetting-forecast"],
    ["what is learning path", "learning-path"],
    ["what does exam readiness show", "exam-readiness"],
    ["where do I see my mock exams", "my-exams"],
    ["what is my engagement score", "engagement-score"],
    ["what is the fees tab", "profile-fees"],
    ["where can I see my fee plan and outstanding balance", "profile-fees"],
    ["what is the learning twin", "profile-learning-twin"],
    ["how do I practise pronunciation", "pronunciation"],
    ["what is the career coach", "career-coach"],
    ["how do I enroll in a course", "marketplace"],
    ["what is my classroom", "my-classroom"],
    ["what is ask apas", "ask-apas"],
    ["what does ctrl j do", "ask-apas"],
    ["how do I search for something", "global-search"],
    ["what is ctrl k", "global-search"],
    ["what is daily reveiw", "daily-review"], // typo
    ["how do i use the adaptiv test", "adaptive-test"], // typo
    ["what is the forgeting forecast", "forgetting-forecast"], // typo
    ["how do i check my attendence", "attendance"], // typo
    ["what is the leaderboard", "leaderboard"],
    ["what are credentials", "credentials"],
    ["how do i join a live class", "virtual-classroom"],
    ["what is group projects", "group-projects"],
    ["what is a survey", "surveys"],
  ])("%s -> %s", (q, id) => {
    expect(ids(q)[0]).toBe(id);
  });

  it("understands a short follow-up from the conversation so far", () => {
    const history = [
      { role: "user", text: "What is the adaptive test?" },
      { role: "assistant", text: "The Adaptive Test is a test that adjusts to you." },
    ];
    expect(ids("how do I use it?", history)[0]).toBe("adaptive-test");
  });

  it("lets the current question win over older conversation", () => {
    const history = [{ role: "user", text: "What is the adaptive test?" }, { role: "assistant", text: "..." }];
    expect(ids("and what is daily review", history)[0]).toBe("daily-review");
  });

  it("does not match plain academic questions", () => {
    expect(ids("explain photosynthesis")).toEqual([]);
    expect(ids("what is 12 times 8")).toEqual([]);
  });

  it("returns at most 3 features and is safe with empty or odd input", () => {
    expect(selectFeatures("test review practice tutor game worksheet homework", []).length).toBeLessThanOrEqual(3);
    expect(selectFeatures("", [])).toEqual([]);
    expect(selectFeatures("what is (this [feature] *", [])).toEqual([]); // regex characters in a question
  });
});

// ───────────────────────────── the prompt section ─────────────────────────────
describe("buildFeatureGuidePrompt", () => {
  it("always lists every feature, so nothing is 'unknown'", () => {
    const p = buildFeatureGuidePrompt("hello", []);
    for (const f of STUDENT_FEATURES) expect(p).toContain(f.name);
    expect(p).not.toContain("FULL DETAILS");
    expect(featureIndex().split("\n")).toHaveLength(STUDENT_FEATURES.length);
  });

  it("adds the how-to steps for the feature being asked about", () => {
    const p = buildFeatureGuidePrompt("how do I use flashcards?", []);
    expect(p).toContain("FULL DETAILS");
    expect(p).toContain("Easy, Medium or Difficult");
    expect(p).toContain("Where: Second tab on the Daily Review page");
  });

  it("explains the new Fees tab without promising what a student cannot do there", () => {
    const p = buildFeatureGuidePrompt("what is the Fees tab in my profile?", []);
    expect(p).toContain("outstanding balance");
    expect(p).toContain("view-only");
  });
});

// ───────────────────────────── wiring in the edge function ─────────────────────────────
describe("student-self-assistant uses the guide", () => {
  const src = read("supabase/functions/student-self-assistant/index.ts");

  it("imports the guide and puts it in the system prompt", () => {
    expect(src).toContain('from "../_shared/studentFeatureGuide.ts"');
    expect(src).toContain("buildFeatureGuidePrompt(message, recentHistory)");
  });

  it("tells the model to explain features instead of saying it does not know them", () => {
    expect(src).toContain("NEVER say \"I don't know this feature\"");
    expect(src).toContain("do not invent buttons, steps or numbers");
  });

  it("asks for simple, child-friendly answers", () => {
    expect(src).toContain("friendly older buddy");
    expect(src).toContain("simple everyday words");
  });

  it("asks for a step-by-step layout, one step per line, not a paragraph", () => {
    expect(src).toContain("do NOT write a paragraph");
    expect(src).toContain('"Step 1:", "Step 2:", "Step 3:"');
    expect(src).toContain("each on its own line");
    expect(src).toContain('one line starting "Example:"');
    expect(src).toContain("Want me to open it for you?");
  });

  it("keeps line breaks visible in the chat bubble (otherwise the steps collapse into a paragraph)", () => {
    const widget = read("src/components/ai-assistant/AIStudentAssistantWidget.tsx");
    expect(widget).toContain('<p className="whitespace-pre-line">{m.text}</p>');
  });

  it("stops the model swapping the page the student named for a different one", () => {
    expect(src).toContain("never guess that the student means a different page");
    expect(src).toContain("details not written yet");
  });

  it("keeps app-feature questions out of the YouTube topic route", () => {
    expect(src).toContain("how the APAS app itself works");
  });
});
