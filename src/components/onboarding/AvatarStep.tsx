import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AVATAR_PRESETS, type Gender } from "./avatars";

interface Props {
  open: boolean;
  gender: Gender;
  userId: string;
  onSave: (avatarUrl: string) => Promise<void>;
  onSkip: () => Promise<void>;
}

export function AvatarStep({ open, gender, userId, onSave, onSkip }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const presets = AVATAR_PRESETS[gender];

  const handleUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setUploadedUrl(data.publicUrl);
      setSelected(data.publicUrl);
      toast.success("Photo uploaded");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg [&>button]:hidden animate-in fade-in zoom-in-95 duration-300"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Pick your profile picture</DialogTitle>
          <DialogDescription>Choose an avatar or upload your own photo.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 py-2">
          {presets.map((p) => {
            const isSel = selected === p.src;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p.src)}
                className={cn(
                  "relative aspect-square rounded-xl border-2 bg-muted/30 p-1 transition-all",
                  isSel ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
                )}
              >
                <img src={p.src} alt="" className="h-full w-full object-contain" loading="lazy" />
                {isSel && (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}

          {/* Upload tile */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              "relative flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-all",
              uploadedUrl && selected === uploadedUrl
                ? "border-primary bg-primary/5"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
            )}
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : uploadedUrl ? (
              <>
                <img src={uploadedUrl} alt="" className="h-full w-full rounded-lg object-cover" />
                {selected === uploadedUrl && (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                <span className="text-xs font-medium">Upload</span>
              </>
            )}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
        />

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" disabled={saving} onClick={onSkip}>
            Skip for now
          </Button>
          <Button
            className="flex-1"
            disabled={!selected || saving}
            onClick={async () => {
              if (!selected) return;
              setSaving(true);
              try {
                await onSave(selected);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
