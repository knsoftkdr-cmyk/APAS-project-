import { Check, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormDraft } from "@/hooks/useFormDraft";

/** Small save-status pill: "Saving...", "Saved", "Unable to save" (+ "Saved offline" while disconnected). */
export function DraftStatus({ draft, className }: { draft: Pick<FormDraft, "status" | "lastSavedAt">; className?: string }) {
  const { status, lastSavedAt } = draft;
  if (status === "idle") return null;
  const cfg = {
    saving: { icon: <Loader2 className="h-3 w-3 animate-spin" />, text: "Saving...", cls: "text-muted-foreground" },
    saved: { icon: <Check className="h-3 w-3" />, text: "Saved", cls: "text-emerald-600 dark:text-emerald-400" },
    offline: { icon: <CloudOff className="h-3 w-3" />, text: "Saved offline - will sync", cls: "text-amber-600 dark:text-amber-400" },
    error: { icon: <TriangleAlert className="h-3 w-3" />, text: "Unable to save", cls: "text-destructive" },
  }[status];
  const title =
    status === "saved" && lastSavedAt ? `Draft saved at ${new Date(lastSavedAt).toLocaleTimeString()}`
    : status === "offline" ? "You're offline. Your draft is kept on this device and will sync when you reconnect."
    : status === "error" ? "Your latest changes couldn't be saved to the server. We'll keep retrying."
    : undefined;
  return (
    <span role="status" aria-live="polite" title={title} className={cn("inline-flex items-center gap-1 text-[11px] sm:text-xs font-medium whitespace-nowrap", cfg.cls, className)} data-testid="draft-status">
      {cfg.icon}
      {cfg.text}
    </span>
  );
}
