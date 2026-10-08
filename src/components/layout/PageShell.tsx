import type { ReactNode } from "react";
import { AppLayout } from "@/components/layout/AppLayout";

/**
 * Wraps a page in the app layout (sidebar + header) — unless the page is rendered *inside* another
 * page that already provides it (`embedded`), in which case only the content is rendered.
 */
export function PageShell({ embedded = false, children }: { embedded?: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <AppLayout>{children}</AppLayout>;
}
