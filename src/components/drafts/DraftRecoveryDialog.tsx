import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { FormDraft } from "@/hooks/useFormDraft";

/** Asks whether to restore or discard a recovered draft. Nothing is applied until the user chooses. */
export function DraftRecoveryDialog({ draft, noun = "draft" }: { draft: Pick<FormDraft, "recovery" | "restore" | "discard">; noun?: string }) {
  const r = draft.recovery;
  const when = r ? new Date(r.savedAt).toLocaleString() : "";
  return (
    <AlertDialog open={!!r}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{r?.conflict ? `A newer ${noun} was found` : `Restore your unsaved ${noun}?`}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                {r?.conflict
                  ? `A newer ${noun} (saved ${when}) exists from another device or tab. Nothing has been overwritten.`
                  : `We found a ${noun} saved ${when}${r?.source === "local" ? " on this device" : ""}. It has not been submitted.`}
              </p>
              {r?.baseChanged && (
                <p className="text-amber-700 dark:text-amber-400">
                  The saved version of this item has changed since this {noun} was started. Restoring only fills in the form - nothing is saved until you press the normal save/submit button.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel onClick={draft.discard}>{r?.conflict ? "Keep what I have" : "Discard draft"}</AlertDialogCancel>
          <AlertDialogAction onClick={draft.restore}>{r?.conflict ? "Load newer draft" : "Restore draft"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
