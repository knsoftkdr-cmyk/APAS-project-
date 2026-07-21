import { useState, useCallback, useRef, useEffect } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useWhiteboardRealtime } from "@/hooks/useWhiteboardRealtime";
import { toast } from "@/hooks/use-toast";
import { Save, Lock, Unlock, Download } from "lucide-react";


interface WhiteboardCanvasProps {
  whiteboardId: string;
  lessonId?: string;
  currentUserId: string;
  currentUserRole: "teacher" | "student" | "parent" | "admin";
  initialMode: "teacher_only" | "student_editable";
  isOwner: boolean; // true if currentUserId === whiteboards.created_by
}

export function WhiteboardCanvas({
  whiteboardId,
  lessonId,
  currentUserId,
  currentUserRole,
  initialMode,
  isOwner,
}: WhiteboardCanvasProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [mode, setMode] = useState(initialMode);
  const [saving, setSaving] = useState(false);
  const initialSceneLoaded = useRef(false);

  const canEdit =
    currentUserRole === "teacher" ||
    currentUserRole === "admin" ||
    (mode === "student_editable" && currentUserRole === "student");

  const { broadcastChange } = useWhiteboardRealtime({
    whiteboardId,
    excalidrawAPI,
    canEdit,
  });

  // Load the persisted scene once on mount
  useEffect(() => {
    if (!excalidrawAPI || initialSceneLoaded.current) return;

    (async () => {
      const { data, error } = await supabase
        .from("whiteboards")
        .select("scene_data, mode")
        .eq("id", whiteboardId)
        .single();

      if (error) {
        toast({ title: "Couldn't load whiteboard", description: error.message, variant: "destructive" });
        return;
      }

      if (data?.scene_data) {
        excalidrawAPI.updateScene({
          elements: data.scene_data.elements ?? [],
          appState: data.scene_data.appState ?? {},
        });
      }
      if (data?.mode) setMode(data.mode);
      initialSceneLoaded.current = true;

      // Zoom out on open so the full board (and toolbar) is visible at a glance,
      // especially on small mobile screens.
      requestAnimationFrame(() => {
        const elements = excalidrawAPI.getSceneElements();
        const isMobile = window.innerWidth < 640;
        if (elements.length > 0) {
          // Fit existing content into view
          excalidrawAPI.scrollToContent(elements, {
            fitToViewport: true,
            viewportZoomFactor: isMobile ? 0.85 : 1,
          });
        } else {
          // Empty board: just set a comfortable default zoom
          excalidrawAPI.updateScene({
            appState: { zoom: { value: (isMobile ? 0.6 : 0.8) as any } },
          });
        }
      });
    })();
  }, [excalidrawAPI, whiteboardId]);

  const handleChange = useCallback(
    (elements: any, appState: any) => {
      broadcastChange(elements, appState);
    },
    [broadcastChange]
  );

  // Persist current scene to the whiteboards row (call periodically or on "Save")
  const persistScene = useCallback(async () => {
    if (!excalidrawAPI) return;
    const elements = excalidrawAPI.getSceneElements();
    const appState = excalidrawAPI.getAppState();

    const { error } = await supabase
      .from("whiteboards")
      .update({
        scene_data: {
          elements,
          appState: { viewBackgroundColor: appState.viewBackgroundColor },
        },
      })
      .eq("id", whiteboardId);

    if (error) throw error;
  }, [excalidrawAPI, whiteboardId]);

  // Explicit snapshot: persists scene + exports PNG + links to lesson notes
  const handleSaveSnapshot = useCallback(async () => {
    if (!excalidrawAPI) return;
    setSaving(true);
    try {
      await persistScene();

      const elements = excalidrawAPI.getSceneElements();
      const blob = await exportToBlob({
        elements,
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
        mimeType: "image/png",
      });

      const fileName = `${whiteboardId}/${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from("whiteboard-snapshots")
        .upload(fileName, blob, { contentType: "image/png" });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("whiteboard-snapshots").getPublicUrl(fileName);

      const { error: snapshotError } = await supabase.from("whiteboard_snapshots").insert({
        whiteboard_id: whiteboardId,
        scene_data: { elements, appState: {} },
        image_url: publicUrl,
        saved_by: currentUserId,
      });
      if (snapshotError) throw snapshotError;

      toast({ title: "Saved to lesson notes", description: "Snapshot added successfully." });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [excalidrawAPI, whiteboardId, currentUserId, persistScene]);

  const toggleMode = useCallback(async () => {
    if (!isOwner) return;
    const newMode = mode === "teacher_only" ? "student_editable" : "teacher_only";
    const { error } = await supabase.from("whiteboards").update({ mode: newMode }).eq("id", whiteboardId);
    if (error) {
      toast({ title: "Couldn't change mode", description: error.message, variant: "destructive" });
      return;
    }
    setMode(newMode);
  }, [mode, isOwner, whiteboardId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 sm:px-4 py-2 border-b bg-background">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge variant={mode === "student_editable" ? "default" : "secondary"} className="shrink-0">
            {mode === "student_editable" ? "Students can draw" : "Teacher only"}
          </Badge>
          {!canEdit && <span className="text-xs sm:text-sm text-muted-foreground">View only</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              onClick={toggleMode}
              title={mode === "student_editable" ? "Lock to teacher" : "Allow students"}
              className="px-2 sm:px-3"
            >
              {mode === "student_editable" ? <Lock className="h-4 w-4 sm:mr-1" /> : <Unlock className="h-4 w-4 sm:mr-1" />}
              <span className="hidden sm:inline">
                {mode === "student_editable" ? "Lock to teacher" : "Allow students"}
              </span>
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSaveSnapshot}
            disabled={saving}
            title="Save to Lesson"
            className="px-2 sm:px-3"
          >
            <Save className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">{saving ? "Saving..." : "Save to Lesson"}</span>
            <span className="sm:hidden">{saving ? "..." : ""}</span>
          </Button>
        </div>
      </div>

      <div className="flex-1" style={{ height: "100%", width: "100%", position: "relative" }}>
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          viewModeEnabled={!canEdit}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}