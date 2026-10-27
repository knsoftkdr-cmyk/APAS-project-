import { useState, useCallback, useRef, useEffect } from "react";
import { Excalidraw, exportToBlob, getSceneVersion, reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI, BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useWhiteboardRealtime } from "@/hooks/useWhiteboardRealtime";
import { toast } from "@/hooks/use-toast";
import { Save, Lock, Unlock, Sparkles, Maximize2, Minimize2, Check, Loader2, CloudOff, Download, FileText, FileType2, ImageIcon } from "lucide-react";
import { AIDrawPanel } from "./AIDrawPanel";
import { exportWhiteboard, type BoardNote, type ExportFormat } from "@/lib/whiteboardExport";

// Excalidraw's own "Save to..." / "Open" / "Export image" write .excalidraw data files, which teachers can't
// use; the toolbar's Export menu (PDF / Word / PNG) replaces them, and Ctrl+S opens that menu instead.
const UI_OPTIONS = {
  canvasActions: { saveToActiveFile: false, loadScene: false, export: false as const, saveAsImage: false },
};

const EXPORTS: Array<{ format: ExportFormat; label: string; hint: string; Icon: typeof FileText }> = [
  { format: "pdf", label: "PDF", hint: "Print or share", Icon: FileText },
  { format: "docx", label: "Word (.docx)", hint: "Edit in Word", Icon: FileType2 },
  { format: "png", label: "Image (.png)", hint: "Picture only", Icon: ImageIcon },
];


interface WhiteboardCanvasProps {
  whiteboardId: string;
  /** Heading for exported files, e.g. the session title. */
  title?: string;
  lessonId?: string;
  currentUserId: string;
  currentUserRole: "teacher" | "student" | "parent" | "admin";
  initialMode: "teacher_only" | "student_editable";
  isOwner: boolean; // true if currentUserId === whiteboards.created_by
}

type SaveState = "idle" | "saving" | "saved" | "error";
const AUTOSAVE_MS = 1500;

// Fullscreen API with the WebKit prefix (older Safari / some Android WebViews).
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
const fsElement = () => document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;
const fsSupported = () =>
  typeof document !== "undefined" &&
  !!(document.fullscreenEnabled || (document.documentElement as FsEl).webkitRequestFullscreen);

/** Files still referenced by a live image element; deleted images don't bloat the saved row. */
function usedFiles(elements: readonly ExcalidrawElement[], files: BinaryFiles): BinaryFiles {
  const out: BinaryFiles = {};
  for (const el of elements) {
    const id = (el as { fileId?: string }).fileId;
    if (id && !el.isDeleted && files[id]) out[id] = files[id];
  }
  return out;
}

export function WhiteboardCanvas({
  whiteboardId,
  title = "Whiteboard",
  lessonId,
  currentUserId,
  currentUserRole,
  initialMode,
  isOwner,
}: WhiteboardCanvasProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [mode, setMode] = useState(initialMode);
  const [saving, setSaving] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [notes, setNotes] = useState<BoardNote[]>([]); // AI Draw explanations, added to PDF / Word exports
  const rootRef = useRef<HTMLDivElement>(null);
  const initialSceneLoaded = useRef(false);
  const lastSavedVersion = useRef(-1);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistRef = useRef<() => Promise<void>>();

  const canEdit =
    currentUserRole === "teacher" ||
    currentUserRole === "admin" ||
    (mode === "student_editable" && currentUserRole === "student");
  // Staff clients keep the saved row current; students' strokes reach it through the teacher's board.
  const canPersist = currentUserRole === "teacher" || currentUserRole === "admin";

  const { broadcastChange, broadcastMode, markSynced } = useWhiteboardRealtime({
    whiteboardId,
    excalidrawAPI,
    canEdit,
    onModeChange: setMode,
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
        const saved = (data.scene_data.elements ?? []) as ExcalidrawElement[];
        const files = (data.scene_data.files ?? {}) as BinaryFiles;
        if (Object.keys(files).length) excalidrawAPI.addFiles(Object.values(files) as BinaryFileData[]);
        markSynced(saved, files);
        excalidrawAPI.updateScene({
          // Merge, so strokes that arrived live while the row was loading are kept.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          elements: reconcileElements(excalidrawAPI.getSceneElementsIncludingDeleted(), saved as any, excalidrawAPI.getAppState()),
          appState: data.scene_data.appState ?? {},
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      lastSavedVersion.current = getSceneVersion(excalidrawAPI.getSceneElementsIncludingDeleted());
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
            viewportZoomFactor: isMobile ? 0.85 : 0.9,
          });
        } else {
          // Empty board: just set a comfortable default zoom
          excalidrawAPI.updateScene({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            appState: { zoom: { value: (isMobile ? 0.6 : 0.8) as any } },
          });
        }
      });
    })();
  }, [excalidrawAPI, whiteboardId, markSynced]);

  // Persist current scene to the whiteboards row (autosave and "Save to Lesson")
  const persistScene = useCallback(async () => {
    if (!excalidrawAPI) return;
    const elements = excalidrawAPI.getSceneElements();
    const appState = excalidrawAPI.getAppState();
    const version = getSceneVersion(excalidrawAPI.getSceneElementsIncludingDeleted());

    const { error } = await supabase
      .from("whiteboards")
      .update({
        scene_data: {
          elements,
          appState: { viewBackgroundColor: appState.viewBackgroundColor },
          files: usedFiles(elements, excalidrawAPI.getFiles()),
        },
      })
      .eq("id", whiteboardId);

    if (error) throw error;
    lastSavedVersion.current = version;
  }, [excalidrawAPI, whiteboardId]);

  const autosave = useCallback(async () => {
    autosaveTimer.current = null;
    setSaveState("saving");
    try {
      await persistScene();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [persistScene]);
  persistRef.current = autosave;

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      broadcastChange();
      if (!canPersist || !initialSceneLoaded.current) return;
      if (getSceneVersion(elements) === lastSavedVersion.current) return; // scroll / select / zoom: nothing to save
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => persistRef.current?.(), AUTOSAVE_MS);
    },
    [broadcastChange, canPersist]
  );

  // Flush a pending autosave when the board is closed, so the last strokes are never lost.
  useEffect(() => () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      void persistRef.current?.();
    }
  }, []);

  // Explicit snapshot: persists scene + exports PNG + links to lesson notes
  const handleSaveSnapshot = useCallback(async () => {
    if (!excalidrawAPI) return;
    setSaving(true);
    try {
      await persistScene();
      setSaveState("saved");

      const elements = excalidrawAPI.getSceneElements();
      if (!elements.length) throw new Error("The board is empty - draw something first.");
      const blob = await exportToBlob({
        elements,
        appState: { ...excalidrawAPI.getAppState(), exportBackground: true },
        files: excalidrawAPI.getFiles(),
        mimeType: "image/png",
        exportPadding: 24,
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
    } catch (err: unknown) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
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
    broadcastMode(newMode); // students' boards unlock / lock straight away
  }, [mode, isOwner, whiteboardId, broadcastMode]);

  // ---------- Export (PDF / Word / PNG) ----------
  const handleExport = useCallback(async (format: ExportFormat) => {
    if (!excalidrawAPI) return;
    setExporting(format);
    try {
      await exportWhiteboard(excalidrawAPI, format, title, notes);
      setExportOpen(false);
    } catch (err: unknown) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }, [excalidrawAPI, title, notes]);

  // Ctrl/Cmd+S opens the Export menu (instead of Excalidraw's data-file dialog or the browser's "Save page").
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        setExportOpen(true);
      }
    };
    root.addEventListener("keydown", onKey, true);
    return () => root.removeEventListener("keydown", onKey, true);
  }, []);

  // ---------- Fullscreen ----------
  useEffect(() => {
    const root = rootRef.current;
    const onFs = () => setIsFullscreen(!!root && fsElement() === root);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      // Closing the board while in full screen must not leave the page stuck in full screen.
      if (root && fsElement() === root) void document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  // Keep the drawing in view when the board changes size (fullscreen on/off, rotating a tablet).
  useEffect(() => {
    if (!excalidrawAPI || !initialSceneLoaded.current) return;
    // Wait for Excalidraw to pick up its new size (it re-measures on the resize event) before fitting.
    const id = setTimeout(() => {
      const els = excalidrawAPI.getSceneElements();
      if (els.length) excalidrawAPI.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.9 });
    }, 200);
    return () => clearTimeout(id);
  }, [isFullscreen, excalidrawAPI]);

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current as FsEl | null;
    if (!el) return;
    try {
      if (fsElement()) {
        await (document.exitFullscreen?.() ?? (document as FsDoc).webkitExitFullscreen?.());
      } else {
        await (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.());
      }
    } catch {
      toast({ title: "Full screen isn't available", description: "This device or browser blocked full screen mode." });
    }
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col h-full w-full bg-background">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 sm:px-4 py-2 border-b bg-background">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge variant={mode === "student_editable" ? "default" : "secondary"} className="shrink-0">
            {mode === "student_editable" ? "Students can draw" : "Teacher only"}
          </Badge>
          {!canEdit && <span className="text-xs sm:text-sm text-muted-foreground">View only</span>}
          {canPersist && saveState !== "idle" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
              {saveState === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>}
              {saveState === "saved" && <><Check className="h-3 w-3 text-emerald-600" /> Saved</>}
              {saveState === "error" && <><CloudOff className="h-3 w-3 text-destructive" /> Not saved - retrying on next change</>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAiOpen(true)}
              title="AI Draw: step-by-step diagrams and equations"
              className="px-2 sm:px-3"
            >
              <Sparkles className="h-4 w-4 sm:mr-1 text-indigo-600" />
              <span className="hidden sm:inline">AI Draw</span>
            </Button>
          )}
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
          {canPersist && (
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
          )}
          {/* Inline menu, not a dropdown: dropdowns portal to <body>, which is hidden in full screen. */}
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExportOpen((o) => !o)}
              title="Export as PDF, Word or image (Ctrl+S)"
              aria-expanded={exportOpen}
              aria-haspopup="menu"
              className="px-2 sm:px-3"
            >
              <Download className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Export</span>
            </Button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => !exporting && setExportOpen(false)} aria-hidden />
                <div role="menu" className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border bg-popover p-1 shadow-lg">
                  {EXPORTS.map(({ format, label, hint, Icon }) => (
                    <button
                      key={format}
                      role="menuitem"
                      type="button"
                      disabled={!!exporting}
                      onClick={() => handleExport(format)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
                    >
                      {exporting === format ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4 text-muted-foreground" />}
                      <span className="flex-1">{label}</span>
                      <span className="text-xs text-muted-foreground">{hint}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {fsSupported() && (
            <Button
              size="sm"
              variant="outline"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
              className="px-2"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0" style={{ width: "100%", position: "relative" }}>
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          viewModeEnabled={!canEdit}
          onChange={handleChange}
          UIOptions={UI_OPTIONS}
        />
        <AIDrawPanel
          api={excalidrawAPI}
          open={aiOpen}
          onOpenChange={setAiOpen}
          onExplanation={(note) => setNotes((n) => [...n, note])}
        />
      </div>
    </div>
  );
}
