import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { friendlyDppError } from "@/lib/dpp";
import { useDppStaffMutations, useDppStaffOptions } from "@/hooks/useDpp";

export function DppAssignDialog({ setId, title, defaultClass, onClose }: { setId: string | null; title: string; defaultClass?: string | null; onClose: () => void }) {
  const opts = useDppStaffOptions();
  const { assign } = useDppStaffMutations();
  const [cls, setCls] = useState<string>(defaultClass ?? "");
  const [section, setSection] = useState<string>("all");
  const [date, setDate] = useState("");
  const classes = Array.from(new Set((opts.data?.classes ?? []).map((c) => c.class_level)));
  const sections = Array.from(new Set((opts.data?.classes ?? []).filter((c) => c.class_level === cls && c.section).map((c) => c.section)));
  const count = (opts.data?.classes ?? []).filter((c) => c.class_level === cls && (section === "all" || c.section === section)).reduce((n, c) => n + Number(c.students), 0);

  const go = async () => {
    if (!setId || !cls) return toast.error("Choose a class.");
    try {
      const r = await assign.mutateAsync({ setId, classLevel: cls, section: section === "all" ? null : section, date: date || null });
      toast.success(`Assigned to ${r.assigned} student(s)${r.already_assigned ? ` (${r.already_assigned} already had it)` : ""}. Opens ${r.assigned_for}.`);
      onClose();
    } catch (e) { toast.error(friendlyDppError(e)); }
  };

  return (
    <Dialog open={!!setId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Assign "{title}"</DialogTitle><DialogDescription>Publishes the set and gives it to every student in the selected class. Students who already have it are skipped.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Class</Label>
            <Select value={cls} onValueChange={(v) => { setCls(v); setSection("all"); }}><SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
              <SelectContent>{classes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          {sections.length > 0 && (
            <div className="space-y-1"><Label>Section</Label>
              <Select value={section} onValueChange={setSection}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All sections</SelectItem>{sections.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
          )}
          <div className="space-y-1"><Label htmlFor="dpp-date">Open on (leave empty for today, up to 60 days ahead)</Label>
            <Input id="dpp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {cls && <p className="text-sm text-muted-foreground">{count} student(s) selected.</p>}
          {!opts.isLoading && classes.length === 0 && <p className="text-sm text-amber-700">No students with a class were found in your school.</p>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void go()} disabled={assign.isPending || !cls}>{assign.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Assign</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
