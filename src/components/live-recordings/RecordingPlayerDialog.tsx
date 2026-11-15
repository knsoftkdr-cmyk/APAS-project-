import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, Loader2 } from "lucide-react";
import { getPlayInfo, type PlayInfo, type Recording } from "@/lib/liveRecordings";

/**
 * Plays a recording. The server hands out a short-lived (1 hour) signed link only to someone allowed to watch it, so
 * nothing is stored in the page and a copied link stops working. Recordings kept as a Google Drive link open in Drive.
 */
export function RecordingPlayerDialog({ recording, onClose }: { recording: Recording | null; onClose: () => void }) {
  const [info, setInfo] = useState<PlayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(id: string) {
    setLoading(true);
    setError(null);
    try {
      setInfo(await getPlayInfo(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setInfo(null);
    setError(null);
    if (recording) void load(recording.id);
  }, [recording?.id]);

  return (
    <Dialog open={!!recording} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-[calc(100%-1.5rem)] sm:w-full p-3 sm:p-5">
        <DialogHeader>
          <DialogTitle className="text-base pe-6 truncate">{recording?.title}</DialogTitle>
        </DialogHeader>
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing the recording...
          </div>
        )}
        {error && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-red-600">{error}</p>
            {recording && <Button variant="outline" size="sm" onClick={() => load(recording.id)}>Try again</Button>}
          </div>
        )}
        {info?.kind === "file" && (
          <video
            key={info.url}
            className="w-full max-h-[70vh] rounded-lg bg-black"
            controls
            playsInline
            preload="metadata"
            controlsList={info.download ? undefined : "nodownload"}
            onContextMenu={info.download ? undefined : (e) => e.preventDefault()}
            onError={() => { if (recording) void load(recording.id); }}   // the link expires after an hour: fetch a fresh one
          >
            <source src={info.url} type={info.mime_type || "video/mp4"} />
          </video>
        )}
        {info?.kind === "external" && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-slate-600">This recording is stored in Google Drive and opens in a new tab.</p>
            <Button asChild className="gap-1.5">
              <a href={info.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Open recording</a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default RecordingPlayerDialog;
