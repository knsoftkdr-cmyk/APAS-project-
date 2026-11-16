import { useRef, useState } from "react";
import type { DragEvent } from "react";

/**
 * Minimal native drag-and-drop for one sortable list (no extra dependency).
 * `ids` is the current order; `onReorder` receives the new order when an item is dropped on another.
 * Items from a different list are ignored, so modules can't be dropped into a chapter list.
 */
export function useSortable(scope: string, ids: string[], onReorder: (next: string[]) => void, enabled = true) {
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const MIME = `application/x-apas-${scope}`;

  const itemProps = (id: string) => ({
    draggable: enabled,
    onDragStart: (e: DragEvent) => {
      dragId.current = id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(MIME, id);
      e.stopPropagation();
    },
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      if (overId !== id) setOverId(id);
    },
    onDragLeave: () => setOverId((cur) => (cur === id ? null : cur)),
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      const from = dragId.current;
      dragId.current = null;
      setOverId(null);
      if (!from || from === id) return;
      const next = ids.filter((x) => x !== from);
      next.splice(ids.indexOf(id), 0, from);
      onReorder(next);
    },
    onDragEnd: () => { dragId.current = null; setOverId(null); },
  });
  return { itemProps, overId };
}
