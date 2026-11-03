import { describe, it, expect } from "vitest";
import { processSource } from "../../tools/i18n/uiStrings.mjs";

const run = (code: string, file = "x.tsx") => processSource(code, file, { rewrite: true });
const messages = (code: string, file = "x.tsx") => processSource(code, file).messages;

describe("UI string rewrite (tools/i18n/uiStrings.mjs)", () => {
  it("wraps JSX text, keeping surrounding spaces outside the message", () => {
    const { code } = run(`const A = () => <h1> Upcoming Events </h1>;`);
    expect(code).toContain(`{" "}{__apasT("Upcoming Events")}{" "}`);
  });

  it("merges text and expressions into one message so word order can change", () => {
    const { code, messages: m } = run(`const A = ({ date }) => <p>Submitted {date} ago</p>;`);
    expect(m).toEqual(["Submitted {0} ago"]);
    expect(code).toContain(`__apasT("Submitted {0} ago", [date])`);
  });

  it("translates display attributes but not data attributes", () => {
    const m = messages(`const A = () => <input placeholder="Search students" value="Search students" className="w-full" />;`);
    expect(m).toEqual(["Search students"]);
  });

  it("translates string branches of conditionals, never the condition", () => {
    const m = messages(`const A = ({ s, ok }) => <span>{s === "active" ? "Active now" : ok && "Waiting"}</span>;`);
    expect(m).toEqual(["Active now", "Waiting"]);
  });

  it("treats English plural endings as droppable, not as words", () => {
    const { code, messages: m } = run(`const A = ({ n }) => <p>{n} student{n === 1 ? "" : "s"} enrolled</p>;`);
    expect(m).toEqual(["{0} student{1} enrolled"]);
    expect(code).toContain(`__apasS("s")`);
  });

  it("translates display properties of UI tables and toasts", () => {
    const m = messages(`
      const nav = [{ title: "My Classroom", path: "/classroom", module: "Home" }];
      toast({ title: "Saved", description: "Your changes are live." });
      toast.error("Could not save");
    `, "x.ts");
    expect(m).toEqual(["My Classroom", "Saved", "Your changes are live.", "Could not save"]);
  });

  it("leaves database rows and request payloads alone", () => {
    const m = messages(`
      supabase.from("notifications").insert({ title: "Homework due" });
      const row = { title: "Weekly report", school_id: id };
      fetch(url, { body: JSON.stringify({ title: "Sync" }) });
    `, "x.ts");
    expect(m).toEqual([]);
  });

  it("translates labels returned by label helpers and label tables", () => {
    const m = messages(`
      function getGreeting(h) { return h < 12 ? "Good morning" : "Good evening"; }
      const STATUS_LABELS = { pending: "Awaiting review" };
      function getColor(s) { return "bg-red-100 text-red-700"; }
    `, "x.ts");
    expect(m).toEqual(["Good morning", "Good evening", "Awaiting review"]);
  });

  it("does not treat identifiers, codes, URLs or class lists as text", () => {
    const m = messages(`
      const a = { label: "student_id" };
      const b = { label: "FA-3" };
      const c = { title: "https://apas.app/help" };
      const d = { label: "bg-blue-50 border-s-4" };
    `, "x.ts");
    expect(m).toEqual([]);
  });

  it("skips code samples", () => {
    expect(messages(`const A = () => <pre>Run npm install</pre>;`)).toEqual([]);
  });

  it("keeps every line where it was", () => {
    const src = `const A = () => (\n  <p>\n    Teacher\n    Workspace\n  </p>\n);\nconst B = 1;\n`;
    const { code } = run(src);
    expect(code.split("\n").indexOf("const B = 1;")).toBe(src.split("\n").indexOf("const B = 1;"));
  });
});
