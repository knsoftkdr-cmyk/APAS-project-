import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, User, UserCircle2, UserCog } from "lucide-react";
import type { Gender } from "./avatars";

interface Props {
  open: boolean;
  onSave: (gender: Gender) => Promise<void>;
}

const OPTIONS: { value: Gender; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "male", label: "Male", icon: User },
  { value: "female", label: "Female", icon: UserCircle2 },
  { value: "prefer_not_to_say", label: "Prefer not to say", icon: UserCog },
];

export function GenderStep({ open, onSave }: Props) {
  const [selected, setSelected] = useState<Gender | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(selected);
    } catch (err: any) {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md w-full [&>button]:hidden animate-in fade-in zoom-in-95 duration-300 flex flex-col gap-0 p-0 overflow-hidden max-h-[90vh]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Scrollable top section */}
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-2">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl">Tell us about yourself</DialogTitle>
            <DialogDescription>This helps us personalize your profile.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            {OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isSel = selected === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelected(opt.value)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all w-full",
                    isSel
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/40 hover:bg-muted/50"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      isSel ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-medium">{opt.label}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <p className="text-sm text-destructive text-center mt-3">{error}</p>
          )}
        </div>

        {/* ✅ Button pinned to bottom — ALWAYS visible, never scrolled away */}
        <div className="shrink-0 px-6 py-4 border-t border-border bg-background">
          <Button
            disabled={!selected || saving}
            onClick={handleContinue}
            className="w-full"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}