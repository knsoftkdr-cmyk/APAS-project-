import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, isValidElement } from "react";

// The runtime reads the language once, when its module first loads, so each
// test sets storage and then imports a fresh copy.
async function runtimeIn(lang: string | null) {
  vi.resetModules();
  if (lang) localStorage.setItem("apas.language", lang);
  const runtime = await import("@/i18n/runtime");
  await runtime.loadActiveLocale();
  return runtime;
}

describe("i18n runtime", () => {
  beforeEach(() => localStorage.clear());

  it("passes English through and keeps plural endings", async () => {
    const { __t, __s, activeLanguage } = await runtimeIn(null);
    expect(activeLanguage()).toBe("en");
    expect(__t("Home")).toBe("Home");
    expect(__t("Submitted {0} ago", ["2 days"])).toBe("Submitted 2 days ago");
    expect(__s("s")).toBe("s");
  });

  it("uses reviewed Arabic overrides and drops English plural endings", async () => {
    const { __t, __s, activeLanguage } = await runtimeIn("ar");
    expect(activeLanguage()).toBe("ar");
    expect(__t("Home")).toBe("الرئيسية");
    expect(__s("s")).toBe("");
  });

  it("falls back to English for a message with no translation", async () => {
    const { __t } = await runtimeIn("ar");
    expect(__t("A message nobody has translated {0}", [3])).toBe("A message nobody has translated 3");
  });

  it("prints nothing for null, undefined and booleans, like React", async () => {
    const { __t } = await runtimeIn(null);
    expect(__t("[{0}|{1}|{2}]", [null, undefined, false])).toBe("[||]");
  });

  it("returns a fragment when an argument is an element", async () => {
    const { __t } = await runtimeIn(null);
    expect(isValidElement(__t("Hello {0}", [createElement("b", null, "Asha")]))).toBe(true);
  });

  it("ignores an unsupported stored language", async () => {
    const { activeLanguage } = await runtimeIn("xx");
    expect(activeLanguage()).toBe("en");
  });

  it("does not report a language as saved when storage refuses it", async () => {
    const { persistLanguage } = await runtimeIn(null);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(persistLanguage("ar")).toBe(false);
    spy.mockRestore();
  });
});
