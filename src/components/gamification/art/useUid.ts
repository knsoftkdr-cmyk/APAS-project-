import { useId } from "react";

/** A DOM-safe unique id (React's useId contains colons, which are awkward inside url(#...)). */
export function useUid(): string {
  return "a" + useId().replace(/[^a-zA-Z0-9]/g, "");
}
