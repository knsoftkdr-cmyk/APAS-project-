import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Users, User } from "lucide-react";

interface ScoreEntrySelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "pretest" | "posttest";
  onSelectWholeClass: () => void;
  onSelectIndividual: () => void;
}

export function ScoreEntrySelectionModal({
  open,
  onOpenChange,
  mode,
  onSelectWholeClass,
  onSelectIndividual,
}: ScoreEntrySelectionModalProps) {
  const title = mode === "pretest" ? "Record Pre-test Scores" : "Record Post-test Scores";
  const description = mode === "pretest" 
    ? "How would you like to record the pre-test scores?"
    : "How would you like to record the post-test scores?";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-muted-foreground mt-2">{description}</p>
        </DialogHeader>

        <div className="grid gap-3 py-4">
          {/* Whole Class Option */}
          <Button
            onClick={() => {
              onSelectWholeClass();
              onOpenChange(false);
            }}
            className="h-auto flex flex-col items-start justify-start p-4 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900 text-left border border-blue-200 dark:border-blue-800"
            variant="outline"
          >
            <div className="flex items-center gap-3 w-full">
              <Users className="h-6 w-6 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <div>
                <p className="font-semibold text-blue-900 dark:text-blue-100">Whole Class</p>
                <p className="text-xs text-blue-800 dark:text-blue-300 mt-0.5">
                  Enter scores for all students at once in a table
                </p>
              </div>
            </div>
          </Button>

          {/* Individual Option */}
          <Button
            onClick={() => {
              onSelectIndividual();
              onOpenChange(false);
            }}
            className="h-auto flex flex-col items-start justify-start p-4 bg-green-50 hover:bg-green-100 dark:bg-green-950 dark:hover:bg-green-900 text-left border border-green-200 dark:border-green-800"
            variant="outline"
          >
            <div className="flex items-center gap-3 w-full">
              <User className="h-6 w-6 text-green-600 dark:text-green-400 flex-shrink-0" />
              <div>
                <p className="font-semibold text-green-900 dark:text-green-100">Individual Student</p>
                <p className="text-xs text-green-800 dark:text-green-300 mt-0.5">
                  Record score for one student at a time
                </p>
              </div>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
