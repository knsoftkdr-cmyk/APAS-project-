import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "module", "chapter" */
  noun: string;
  mode: "create" | "edit";
  initial?: { title?: string; description?: string | null };
  saving?: boolean;
  onSubmit: (values: { title: string; description: string | null }) => void;
}

/** Create / rename dialog shared by modules and chapters. */
export function NodeDialog({ open, onOpenChange, noun, mode, initial, saving, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (open) { setTitle(initial?.title ?? ""); setDescription(initial?.description ?? ""); }
  }, [open, initial?.title, initial?.description]);

  const valid = title.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit({ title: title.trim(), description: description.trim() || null }); }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{mode === "create" ? `Add ${noun}` : `Edit ${noun}`}</DialogTitle>
            <DialogDescription>
              {mode === "create" ? `New ${noun}s start as drafts, so students can't see them until you publish.` : `Update the ${noun} details.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="node-title">Title</Label>
            <Input id="node-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={160} placeholder={`e.g. ${noun === "module" ? "Algebra" : "Introduction to Algebra"}`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="node-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea id="node-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {mode === "create" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
