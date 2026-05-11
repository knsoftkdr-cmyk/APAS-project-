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

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden animate-in fade-in zoom-in-95 duration-300"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Tell us about yourself</DialogTitle>
          <DialogDescription>This helps us personalize your profile.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSel = selected === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelected(opt.value)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all",
                  isSel
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary/40 hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full",
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

        <Button
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
          className="w-full"
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </DialogContent>
    </Dialog>
  );
}
