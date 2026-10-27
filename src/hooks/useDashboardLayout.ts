import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  availableWidgets, emptyLayout, isCustomized, moveWidget, reorderAvailable, resolveLayout, setWidgetHidden, toLayout,
  type DashboardLayout, type ResolvedWidget, type WidgetDef,
} from "@/lib/dashboardLayout";
import { fetchServerLayout, readLocalLayout, saveServerLayout, writeLocalLayout } from "@/lib/dashboardLayoutStore";

export type LayoutSaveState = "idle" | "saving" | "saved" | "device-only" | "error";

/**
 * Per-user order + visibility of a dashboard's widgets.
 * Loads the device copy instantly (no flicker), then reconciles with the server: the NEWER of the two wins,
 * so an old device copy never overwrites a newer server layout (and vice versa).
 */
export function useDashboardLayout(dashboardKey: string, defs: WidgetDef[]) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [saved, setSaved] = useState<DashboardLayout | null>(() => (userId ? readLocalLayout(userId, dashboardKey) : null));
  const [saveState, setSaveState] = useState<LayoutSaveState>("idle");
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<DashboardLayout | null>(null);

  const pushToServer = useCallback(async (layout: DashboardLayout) => {
    if (!userId) return;
    setSaveState("saving");
    const r = await saveServerLayout(userId, dashboardKey, layout);
    setSaveState(r === "saved" ? "saved" : r === "unavailable" ? "device-only" : "error");
  }, [userId, dashboardKey]);

  // Load: device copy now, server copy when it arrives.
  useEffect(() => {
    if (!userId) { setSaved(null); return; }
    let alive = true;
    const local = readLocalLayout(userId, dashboardKey);
    setSaved(local);
    void fetchServerLayout(userId, dashboardKey).then((res) => {
      if (!alive) return;
      if (!res.ok) { setSaveState(res.reason === "unavailable" ? "device-only" : "idle"); return; }
      const current = savedRef.current;
      if (res.layout && (!current || res.layout.updatedAt > current.updatedAt)) {
        setSaved(res.layout);
        writeLocalLayout(userId, dashboardKey, res.layout);
      } else if (current && (!res.layout || current.updatedAt > res.layout.updatedAt)) {
        void pushToServer(current); // this device has the newer layout
      }
    });
    return () => { alive = false; };
  }, [userId, dashboardKey, pushToServer]);

  // Flush a pending save when leaving the page.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current) { void pushToServer(pending.current); pending.current = null; }
  }, [pushToServer]);

  const defsKey = JSON.stringify(defs.map((d) => [d.id, d.title, d.canHide, d.available]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => resolveLayout(defs, saved), [defsKey, saved]);
  const widgets = useMemo(() => availableWidgets(all), [all]);

  const commit = useCallback((next: ResolvedWidget[]) => {
    if (!userId) return;
    const prev = savedRef.current?.updatedAt ?? 0;
    const layout = toLayout(next, Math.max(Date.now(), prev + 1));
    setSaved(layout);
    savedRef.current = layout;
    writeLocalLayout(userId, dashboardKey, layout);
    pending.current = layout;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const l = pending.current;
      pending.current = null;
      if (l) void pushToServer(l);
    }, 600);
  }, [userId, dashboardKey, pushToServer]);

  const move = useCallback((id: string, dir: -1 | 1) => commit(moveWidget(all, id, dir)), [all, commit]);
  const reorder = useCallback((ids: string[]) => commit(reorderAvailable(all, ids)), [all, commit]);
  const setHidden = useCallback((id: string, hidden: boolean) => commit(setWidgetHidden(all, id, hidden)), [all, commit]);
  const reset = useCallback(() => commit(resolveLayout(defs, emptyLayout())), [defs, commit]);

  return { widgets, move, reorder, setHidden, reset, saveState, customized: isCustomized(defs, saved) };
}
