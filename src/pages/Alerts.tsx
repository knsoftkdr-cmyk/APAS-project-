import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useNotifications } from "@/contexts/NotificationContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, CheckCheck, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";

type Filter = "all" | "flagged" | "resolved";

const Alerts = () => {
  const { profile } = useAuth();
  const isStudent = profile?.role === "student";
  const { alerts, readAlertIds, markAsRead, markAllAsRead, refreshAlerts } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");
  const [bulkResolving, setBulkResolving] = useState(false);

  const filtered = alerts
    .filter((a) => filter === "all" || a.status === filter)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const bulkResolve = async () => {
    setBulkResolving(true);
    const flagged = alerts.filter((a) => a.status === "flagged");
    for (const a of flagged) {
      await supabase.from("mismatch_alerts").update({ status: "resolved" }).eq("id", a.id);
    }
    await refreshAlerts();
    setBulkResolving(false);
    toast.success(`${flagged.length} alerts resolved`);
  };

  const exportCSV = () => {
    const header = "Student Group,Lesson Type,Trigger,Recommendation,Status,Date\n";
    const rows = filtered.map((a) =>
      `"${a.student_group || ""}","${a.lesson_type || ""}","${a.trigger_condition || ""}","${a.recommendation || ""}","${a.status}","${a.created_at}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "alerts.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  // Mark visible alerts as read
  const handleViewAlert = (id: string) => {
    markAsRead(id);
  };

  if (isStudent) {
    return (
      <AppLayout>
        <PageHeader title="Alerts" subtitle="Your notifications" />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ShieldCheck className="h-12 w-12 text-success mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">All Clear!</h2>
            <p className="text-muted-foreground max-w-md">
              No alerts for you. Your teacher manages delivery mismatch alerts.
            </p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Alerts"
        subtitle="All delivery mismatch alerts"
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={bulkResolve} disabled={bulkResolving}>
              <CheckCheck className="h-4 w-4 mr-1" /> Bulk Resolve
            </Button>
            <Button variant="outline" size="sm" onClick={markAllAsRead}>
              Mark All Read
            </Button>
          </div>
        }
      />

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {(["all", "flagged", "resolved"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
              filter === f ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-accent/20"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student Group</TableHead>
                <TableHead>Lesson Type</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No alerts found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((a) => (
                  <TableRow
                    key={a.id}
                    className={readAlertIds.has(a.id) ? "" : "bg-accent/5"}
                    onMouseEnter={() => handleViewAlert(a.id)}
                  >
                    <TableCell className="font-medium">{a.student_group || "—"}</TableCell>
                    <TableCell>{a.lesson_type || "—"}</TableCell>
                    <TableCell>{a.trigger_condition || "—"}</TableCell>
                    <TableCell className="text-sm">{a.recommendation || "—"}</TableCell>
                    <TableCell>
                      <StatusBadge variant={a.status === "flagged" ? "danger" : "success"}>
                        {a.status}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppLayout>
  );
};

export default Alerts;
