import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2, GraduationCap } from "lucide-react";

interface Props {
  open: boolean;
  onSave: (classGrade: string) => Promise<void>;
}

const CLASS_OPTIONS = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `Class ${i + 1}` })),
];

export function ClassStep({ open, onSave }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
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
          <DialogHeader className="mb-6">
            <DialogTitle className="text-xl flex items-center gap-2">
              <GraduationCap className="h-6 w-6 text-primary" />
              What's your class?
            </DialogTitle>
            <DialogDescription>This helps us provide age-appropriate content.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Select value={selected || ""} onValueChange={setSelected}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Select your class..." />
              </SelectTrigger>
              <SelectContent>
                {CLASS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selected && (
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-sm font-medium text-foreground">
                  ✓ Selected: <span className="text-primary">{CLASS_OPTIONS.find(o => o.value === selected)?.label}</span>
                </p>
              </div>
            )}
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
