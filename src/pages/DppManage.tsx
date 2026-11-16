import { useState } from "react";
import { Archive, BarChart3, ClipboardCheck, Pencil, Plus, Send, Settings as SettingsIcon, Users } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DppSetEditor } from "@/components/dpp/DppSetEditor";
import { DppAssignDialog } from "@/components/dpp/DppAssignDialog";
import { DppSetResults } from "@/components/dpp/DppSetResults";
import { AdminAnalyticsPanel, InsightsPanel, PendingMarkingPanel, SettingsPanel } from "@/components/dpp/DppManagePanels";
import { DIFFICULTY_CLASS, friendlyDppError, percentTone, TONE_CLASS } from "@/lib/dpp";
import { useDppOverview, useDppStaffMutations } from "@/hooks/useDpp";

const ADMIN_ROLES = ["admin", "principal", "school_admin", "hod"];

export default function DppManage() {
  const { profile } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(profile?.role ?? "");
  const overview = useDppOverview(30);
  const { archive } = useDppStaffMutations();
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [assigning, setAssigning] = useState<{ id: string; title: string; cls: string | null } | null>(null);
  const [viewing, setViewing] = useState<{ id: string; title: string } | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; title: string } | null>(null);

  return (
    <AppLayout>
      <PageHeader title="Daily Practice" subtitle="Create practice sets, assign them to classes, and follow how students do."
        action={<Button onClick={() => setEditing({ id: null })}><Plus className="mr-1 h-4 w-4" />New practice set</Button>} />
      <Tabs defaultValue="sets">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="sets"><ClipboardCheck className="mr-1 h-4 w-4" />Sets</TabsTrigger>
          <TabsTrigger value="mark">To mark{overview.data?.pending_manual ? ` (${overview.data.pending_manual})` : ""}</TabsTrigger>
          <TabsTrigger value="insights"><Users className="mr-1 h-4 w-4" />Insights</TabsTrigger>
          {isAdmin && <TabsTrigger value="analytics"><BarChart3 className="mr-1 h-4 w-4" />School analytics</TabsTrigger>}
          {isAdmin && <TabsTrigger value="settings"><SettingsIcon className="mr-1 h-4 w-4" />Settings</TabsTrigger>}
        </TabsList>

        <TabsContent value="sets" className="space-y-3">
          {overview.isLoading && <Skeleton className="h-32 w-full" />}
          {overview.error && <p className="text-sm text-red-600">{friendlyDppError(overview.error)}</p>}
          {overview.data?.sets.length === 0 && <EmptyState icon={ClipboardCheck} title="No practice sets yet" description="Create your first set, then assign it to a class." action={<Button onClick={() => setEditing({ id: null })}>Create a set</Button>} />}
          {overview.data?.sets.map((s) => (
            <Card key={s.set_id}><CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-semibold">{s.title}</p>
                  <p className="text-sm text-muted-foreground">{s.subject}{s.class_level ? ` · ${s.class_level}` : ""} · {s.questions} questions{s.time_limit_minutes ? ` · ${s.time_limit_minutes} min` : ""}</p></div>
                <div className="flex gap-2"><Badge variant="outline" className={DIFFICULTY_CLASS[s.difficulty]}>{s.difficulty}</Badge><Badge variant={s.status === "published" ? "default" : "secondary"}>{s.status}</Badge></div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{s.assigned} assigned</span><span>·</span><span>{s.submitted} submitted</span><span>·</span><span>{s.started - s.submitted} in progress</span>
                {s.avg_percent != null && <Badge variant="outline" className={TONE_CLASS[percentTone(s.avg_percent)]}>avg {Math.round(s.avg_percent)}%</Badge>}
                {s.pending_manual > 0 && <Badge variant="outline" className="border-amber-400 text-amber-700">{s.pending_manual} to mark</Badge>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing({ id: s.set_id })} disabled={s.started > 0} title={s.started > 0 ? "Locked: students have started" : undefined}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                <Button size="sm" onClick={() => setAssigning({ id: s.set_id, title: s.title, cls: s.class_level })}><Send className="mr-1 h-3.5 w-3.5" />Assign / schedule</Button>
                <Button size="sm" variant="outline" onClick={() => setViewing({ id: s.set_id, title: s.title })}><Users className="mr-1 h-3.5 w-3.5" />Results</Button>
                <Button size="sm" variant="ghost" onClick={() => setArchiving({ id: s.set_id, title: s.title })}><Archive className="mr-1 h-3.5 w-3.5" />Archive</Button>
              </div>
            </CardContent></Card>
          ))}
        </TabsContent>
        <TabsContent value="mark"><PendingMarkingPanel /></TabsContent>
        <TabsContent value="insights"><InsightsPanel /></TabsContent>
        {isAdmin && <TabsContent value="analytics"><AdminAnalyticsPanel /></TabsContent>}
        {isAdmin && <TabsContent value="settings"><SettingsPanel /></TabsContent>}
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="sr-only">Practice set editor</DialogTitle></DialogHeader>
          {editing && <DppSetEditor setId={editing.id} onClose={() => setEditing(null)} />}</DialogContent>
      </Dialog>
      <DppAssignDialog setId={assigning?.id ?? null} title={assigning?.title ?? ""} defaultClass={assigning?.cls} onClose={() => setAssigning(null)} />
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{viewing?.title} - results</DialogTitle></DialogHeader>
          {viewing && <DppSetResults setId={viewing.id} />}</DialogContent>
      </Dialog>
      <AlertDialog open={!!archiving} onOpenChange={(o) => { if (!o) setArchiving(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Archive "{archiving?.title}"?</AlertDialogTitle>
          <AlertDialogDescription>Students can no longer start it. Results already recorded are kept.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { try { await archive.mutateAsync(archiving!.id); toast.success("Archived."); } catch (e) { toast.error(friendlyDppError(e)); } setArchiving(null); }}>Archive</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
