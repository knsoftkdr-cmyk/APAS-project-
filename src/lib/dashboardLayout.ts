// Personalized dashboard widgets - pure layout logic (no React, no network), so it is easy to test.
//
// A layout is only the user's *choices*: an order and a hidden list. Which widgets exist, what they
// render and whether they can be hidden always comes from the code, so a new release can add, rename or
// remove widgets without migrating anyone's saved layout.

export interface WidgetDef {
  id: string;
  title: string;
  description?: string;
  /** false = can be moved but not hidden (e.g. the row the guided tour points at). Default true. */
  canHide?: boolean;
  /** false = not applicable right now (e.g. no data). It keeps its saved position but is not shown or listed. */
  available?: boolean;
}

export interface DashboardLayout {
  v: 1;
  /** ms since epoch of the user's last change; the newest of device/server wins. */
  updatedAt: number;
  order: string[];
  hidden: string[];
}

export interface ResolvedWidget extends WidgetDef {
  hidden: boolean;
}

export const emptyLayout = (updatedAt = 0): DashboardLayout => ({ v: 1, updatedAt, order: [], hidden: [] });

export function isLayout(x: unknown): x is DashboardLayout {
  if (!x || typeof x !== "object") return false;
  const l = x as Record<string, unknown>;
  return l.v === 1 && typeof l.updatedAt === "number" && Array.isArray(l.order) && Array.isArray(l.hidden)
    && l.order.every((i) => typeof i === "string") && l.hidden.every((i) => typeof i === "string");
}

/**
 * Turns the saved choices into the list to display.
 *  - unknown ids (removed widgets) are dropped;
 *  - widgets the user has never seen (added in a later release) appear right after the widget that
 *    precedes them in the default order, instead of being lost or jumping to the bottom;
 *  - widgets that cannot be hidden are never hidden, whatever the saved data says.
 */
export function resolveLayout(defs: WidgetDef[], saved: DashboardLayout | null): ResolvedWidget[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of saved?.order ?? []) {
    if (byId.has(id) && !seen.has(id)) { order.push(id); seen.add(id); }
  }
  defs.forEach((d, i) => {
    if (seen.has(d.id)) return;
    // find the nearest earlier default widget that is already placed, and insert after it
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(defs[j].id);
      if (k !== -1) { at = k + 1; break; }
    }
    order.splice(at, 0, d.id);
    seen.add(d.id);
  });
  const hidden = new Set((saved?.hidden ?? []).filter((id) => byId.get(id)?.canHide !== false));
  return order.map((id) => ({ ...byId.get(id)!, hidden: hidden.has(id) }));
}

/** Only widgets that apply right now (what the user sees and can arrange). */
export const availableWidgets = (list: ResolvedWidget[]) => list.filter((w) => w.available !== false);

/** Layout that reproduces `list` (full order, including unavailable widgets so their place is remembered). */
export function toLayout(list: ResolvedWidget[], updatedAt = Date.now()): DashboardLayout {
  return { v: 1, updatedAt, order: list.map((w) => w.id), hidden: list.filter((w) => w.hidden).map((w) => w.id) };
}

/** Move one widget up/down among the *available* ones, keeping unavailable widgets where they were. */
export function moveWidget(list: ResolvedWidget[], id: string, dir: -1 | 1): ResolvedWidget[] {
  const visibleIdx = list.map((w, i) => (w.available !== false ? i : -1)).filter((i) => i !== -1);
  const pos = visibleIdx.findIndex((i) => list[i].id === id);
  const target = pos + dir;
  if (pos === -1 || target < 0 || target >= visibleIdx.length) return list;
  const next = list.slice();
  const a = visibleIdx[pos];
  const b = visibleIdx[target];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Apply a new order of *available* widget ids (from drag-and-drop) to the full list. */
export function reorderAvailable(list: ResolvedWidget[], orderedIds: string[]): ResolvedWidget[] {
  const byId = new Map(list.map((w) => [w.id, w]));
  const queue = orderedIds.map((id) => byId.get(id)).filter((w): w is ResolvedWidget => !!w);
  let q = 0;
  return list.map((w) => (w.available !== false && q < queue.length ? queue[q++] : w));
}

export function setWidgetHidden(list: ResolvedWidget[], id: string, hidden: boolean): ResolvedWidget[] {
  return list.map((w) => (w.id === id && w.canHide !== false ? { ...w, hidden } : w));
}

/** True when the layout differs from the defaults (used to enable "Reset"). */
export function isCustomized(defs: WidgetDef[], saved: DashboardLayout | null): boolean {
  const cur = resolveLayout(defs, saved);
  const def = resolveLayout(defs, null);
  return cur.some((w, i) => w.id !== def[i].id || w.hidden);
}
