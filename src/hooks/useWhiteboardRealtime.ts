import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";

interface UseWhiteboardRealtimeProps {
  whiteboardId: string;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  canEdit: boolean;
}

// Broadcasts scene changes and applies incoming ones from other clients.
// Throttled to avoid flooding the channel on every single pointer move.
export function useWhiteboardRealtime({
  whiteboardId,
  excalidrawAPI,
  canEdit,
}: UseWhiteboardRealtimeProps) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastBroadcastRef = useRef<number>(0);
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    if (!whiteboardId) return;

    const channel = supabase.channel(`whiteboard:${whiteboardId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "scene-update" }, ({ payload }) => {
      if (!excalidrawAPI) return;
      applyingRemoteRef.current = true;
      excalidrawAPI.updateScene({
        elements: payload.elements,
        appState: { ...excalidrawAPI.getAppState(), ...payload.appStatePartial },
      });
      applyingRemoteRef.current = false;
    });

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [whiteboardId, excalidrawAPI]);

  // Call this from Excalidraw's onChange
  const broadcastChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: any) => {
      if (!canEdit || applyingRemoteRef.current || !channelRef.current) return;

      const now = Date.now();
      if (now - lastBroadcastRef.current < 80) return; // throttle ~12fps
      lastBroadcastRef.current = now;

      channelRef.current.send({
        type: "broadcast",
        event: "scene-update",
        payload: {
          elements,
          appStatePartial: {
            viewBackgroundColor: appState.viewBackgroundColor,
          },
        },
      });
    },
    [canEdit]
  );

  return { broadcastChange };
}