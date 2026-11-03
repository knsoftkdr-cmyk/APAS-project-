// tools/i18n/vitePlugin.mjs
//
// Rewrites user-facing English in src/ into runtime lookups while Vite serves or
// builds the app. The files on disk are never changed. See uiStrings.mjs for what
// counts as user-facing text, and src/i18n/runtime.ts for the lookup itself.

import { isTranslatableFile, processSource } from "./uiStrings.mjs";

/** @returns {import("vite").Plugin} */
export function apasI18n() {
  return {
    name: "apas-i18n",
    // Before the React/SWC plugin, which would otherwise compile the JSX away.
    enforce: "pre",
    transform(code, id) {
      if (!isTranslatableFile(id)) return null;
      if (!/__apasT|["'`>]/.test(code)) return null;
      const { code: out } = processSource(code, id.split("?")[0], { rewrite: true });
      // Replacements are made in place and the import is appended, so lines do
      // not move; a null map keeps Vite's line-based mapping close enough.
      return out ? { code: out, map: null } : null;
    },
  };
}
