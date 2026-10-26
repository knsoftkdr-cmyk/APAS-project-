import { useRef } from "react";
import { Camera, FileText, Image as ImageIcon, Loader2, Mic, MicOff, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ATTACH_ACCEPT, IMAGE_ACCEPT, type TutorAttachment } from "@/lib/tutorAttachments";

/** Paperclip menu: take a photo, choose a photo, or attach a document. Files are handed to `onFiles`. */
export function AttachMenu({ onFiles, disabled, preparing }: { onFiles: (files: File[]) => void; disabled?: boolean; preparing?: boolean }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow choosing the same file again
    if (files.length) onFiles(files);
  };
  return (
    <>
      <input ref={cameraRef} type="file" accept={IMAGE_ACCEPT} capture="environment" className="hidden" onChange={pick} data-testid="input-camera" />
      <input ref={photoRef} type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={pick} data-testid="input-photo" />
      <input ref={docRef} type="file" accept={ATTACH_ACCEPT} multiple className="hidden" onChange={pick} data-testid="input-document" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="shrink-0 h-11 w-11" disabled={disabled || preparing} aria-label="Attach a photo or document" title="Attach a photo or document">
            {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={() => cameraRef.current?.click()} className="gap-2"><Camera className="h-4 w-4" /> Take a photo</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => photoRef.current?.click()} className="gap-2"><ImageIcon className="h-4 w-4" /> Choose a photo</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => docRef.current?.click()} className="gap-2"><FileText className="h-4 w-4" /> PDF, Word or text file</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Mic button. Hidden-looking but explained when the browser has no speech recognition. */
export function VoiceButton({ supported, listening, onToggle, disabled }: { supported: boolean; listening: boolean; onToggle: () => void; disabled?: boolean }) {
  const label = !supported ? "Voice input isn't available in this browser (try Chrome or Edge)" : listening ? "Stop listening" : "Ask by voice";
  return (
    <Button
      type="button"
      variant={listening ? "destructive" : "outline"}
      size="icon"
      className={`shrink-0 h-11 w-11 ${listening ? "animate-pulse" : ""}`}
      disabled={disabled || !supported}
      onClick={onToggle}
      aria-label={label}
      aria-pressed={listening}
      title={label}
      data-testid="voice-button"
    >
      {supported ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
    </Button>
  );
}

/** What is attached and will be sent with the next message(s). */
export function AttachmentChips({ items, onRemove, disabled }: { items: TutorAttachment[]; onRemove: (id: string) => void; disabled?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="mb-2" data-testid="attachment-chips">
      <div className="flex flex-wrap gap-2">
        {items.map((a) => (
          <div key={a.id} className="flex max-w-full items-center gap-2 rounded-lg border bg-card py-1 pl-1 pr-1.5 text-xs">
            {a.preview ? (
              <img src={a.preview} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted"><FileText className="h-4 w-4 text-muted-foreground" /></span>
            )}
            <span className="min-w-0">
              <span className="block max-w-[11rem] truncate font-medium sm:max-w-[16rem]">{a.name}</span>
              {a.note && <span className="block max-w-[11rem] truncate text-[11px] text-muted-foreground sm:max-w-[16rem]">{a.note}{a.truncated ? " (long: using the first part)" : ""}</span>}
            </span>
            <button type="button" disabled={disabled} onClick={() => onRemove(a.id)} aria-label={`Remove ${a.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Included with your messages until you remove it. Photos and files are sent to the tutor only and are not saved.</p>
    </div>
  );
}
