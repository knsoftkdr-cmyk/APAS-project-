import { useEffect, useRef, useCallback } from "react";
import { reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import { supabase } from "@/integrations/supabase/client";
import type { ExcalidrawImperativeAPI, BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type BoardMode = "teacher_only" | "student_editable";

interface UseWhiteboardRealtimeProps {
  whiteboardId: string;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  canEdit: boolean;
  onModeChange?: (mode: BoardMode) => void;
}

const THROTTLE_MS = 60;

// Broadcasts scene changes and applies incoming ones from other clients.
// - Only elements whose version changed are sent (Excalidraw elements carry a version), so a scroll or a
//   selection sends nothing and big boards don't flood the channel.
// - Throttled with a trailing send, so the final state of a stroke is never dropped.
// - Incoming elements are merged with reconcileElements (newest version wins per element) instead of
//   replacing the scene, so a teacher and a student drawing at the same time don't erase each other.
// - Remote changes skip the local undo stack: Ctrl+Z only undoes your own strokes.
// - Images travel as files alongside the elements that reference them.
export function useWhiteboardRealtime({
  whiteboardId,
  excalidrawAPI,
  canEdit,
  onModeChange,
}: UseWhiteboardRealtimeProps) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sentVersions = useRef(new Map<string, number>());
  const sentFiles = useRef(new Set<string>());
  const lastSendAt = useRef(0);
  const trailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onModeRef = useRef(onModeChange);
  onModeRef.current = onModeChange;

  /** Mark elements as already known so they are not echoed back (initial load, remote updates). */
  const markSynced = useCallback((elements: readonly ExcalidrawElement[], files?: BinaryFiles) => {
    for (const el of elements) {
      sentVersions.current.set(el.id, Math.max(el.version, sentVersions.current.get(el.id) ?? 0));
    }
    for (const id of Object.keys(files ?? {})) sentFiles.current.add(id);
  }, []);

  useEffect(() => {
    if (!whiteboardId) return;

    const channel = supabase.channel(`whiteboard:${whiteboardId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "scene-update" }, ({ payload }) => {
      if (!excalidrawAPI) return;
      const remote = (payload.elements ?? []) as ExcalidrawElement[];
      const files = (payload.files ?? {}) as BinaryFiles;
      if (Object.keys(files).length) excalidrawAPI.addFiles(Object.values(files) as BinaryFileData[]);
      markSynced(remote, files);
      excalidrawAPI.updateScene({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        elements: reconcileElements(excalidrawAPI.getSceneElementsIncludingDeleted(), remote as any, excalidrawAPI.getAppState()),
        ...(payload.viewBackgroundColor ? { appState: { viewBackgroundColor: payload.viewBackgroundColor } } : {}),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    });

    channel.on("broadcast", { event: "mode-change" }, ({ payload }) => {
      if (payload?.mode === "teacher_only" || payload?.mode === "student_editable") onModeRef.current?.(payload.mode);
    });

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      if (trailingTimer.current) clearTimeout(trailingTimer.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [whiteboardId, excalidrawAPI, markSynced]);

  const sendPending = useCallback(() => {
    trailingTimer.current = null;
    if (!excalidrawAPI || !channelRef.current) return;
    lastSendAt.current = Date.now();

    const changed = excalidrawAPI
      .getSceneElementsIncludingDeleted()
      .filter((el) => sentVersions.current.get(el.id) !== el.version);
    if (!changed.length) return;

    const allFiles = excalidrawAPI.getFiles();
    const files: BinaryFiles = {};
    for (const el of changed) {
      const fileId = (el as { fileId?: string }).fileId;
      if (fileId && allFiles[fileId] && !sentFiles.current.has(fileId)) files[fileId] = allFiles[fileId];
    }

    for (const el of changed) sentVersions.current.set(el.id, el.version);
    for (const id of Object.keys(files)) sentFiles.current.add(id);

    channelRef.current.send({
      type: "broadcast",
      event: "scene-update",
      payload: {
        elements: changed,
        files,
        viewBackgroundColor: excalidrawAPI.getAppState().viewBackgroundColor,
      },
    });
  }, [excalidrawAPI]);

  // Call this from Excalidraw's onChange
  const broadcastChange = useCallback(() => {
    if (!canEdit || trailingTimer.current) return;
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastSendAt.current));
    trailingTimer.current = setTimeout(sendPending, wait);
  }, [canEdit, sendPending]);

  const broadcastMode = useCallback((mode: BoardMode) => {
    channelRef.current?.send({ type: "broadcast", event: "mode-change", payload: { mode } });
  }, []);

  return { broadcastChange, broadcastMode, markSynced };
}
