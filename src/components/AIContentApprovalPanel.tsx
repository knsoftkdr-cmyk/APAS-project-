import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, AlertCircle, Eye, Loader2 } from "lucide-react";

interface ApprovalQueueItem {
  id: string;
  content_type: string;
  generated_by_model: string;
  status: string;
  confidence_score: number;
  created_at: string;
  generated_content: any;
  quality_issues: Record<string, any>;
}

export const AIContentApprovalPanel = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<ApprovalQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ApprovalQueueItem | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<any>(null);

  const isAdmin = profile?.role === "admin" || profile?.role === "school_admin";

  useEffect(() => {
    if (isAdmin) {
      loadPendingItems();
      loadStats();
    }
  }, [isAdmin]);

  const loadPendingItems = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-approval-workflow`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "user_id": user?.id,
          },
          body: JSON.stringify({
            action: "get_pending_approvals",
            limit: 50,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setItems(data.items || []);
    } catch (e) {
      console.error("Error loading items:", e);
      toast.error("Failed to load pending approvals");
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-approval-workflow`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "user_id": user?.id,
          },
          body: JSON.stringify({
            action: "get_approval_stats",
            days: 30,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setStats(data);
    } catch (e) {
      console.error("Error loading stats:", e);
    }
  };

  const handleApprove = async (queueId: string) => {
    try {
      setIsProcessing(true);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-approval-workflow`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "user_id": user?.id,
          },
          body: JSON.stringify({
            action: "approve_content",
            queue_id: queueId,
            reviewer_notes: reviewNotes,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to approve");
      toast.success("Content approved");
      setSelectedItem(null);
      setReviewNotes("");
      loadPendingItems();
      loadStats();
    } catch (e) {
      console.error("Error approving:", e);
      toast.error("Failed to approve content");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (queueId: string) => {
    try {
      setIsProcessing(true);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-approval-workflow`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "user_id": user?.id,
          },
          body: JSON.stringify({
            action: "reject_content",
            queue_id: queueId,
            reviewer_notes: reviewNotes,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to reject");
      toast.success("Content rejected");
      setSelectedItem(null);
      setReviewNotes("");
      loadPendingItems();
      loadStats();
    } catch (e) {
      console.error("Error rejecting:", e);
      toast.error("Failed to reject content");
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-12">
            <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">Only administrators can access this panel</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4 text-green-600" /> Approved
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <XCircle className="h-4 w-4 text-red-600" /> Rejected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.rejected}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Approval Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.approval_rate}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Content for Review</CardTitle>
          <CardDescription>{items.length} item(s) awaiting approval</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>All content has been reviewed!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Badge variant="outline">{item.content_type}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{item.generated_by_model}</TableCell>
                      <TableCell>
                        <Badge variant={parseFloat(item.confidence_score.toString()) > 0.75 ? "default" : "secondary"}>
                          {(parseFloat(item.confidence_score.toString()) * 100).toFixed(0)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{new Date(item.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedItem(item)}
                          className="gap-1"
                        >
                          <Eye className="h-4 w-4" /> Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-2xl max-h-96 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Content</DialogTitle>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4">
              {/* Content Details */}
              <div>
                <Label className="font-semibold">Content Type</Label>
                <p className="text-sm text-muted-foreground">{selectedItem.content_type}</p>
              </div>

              <div>
                <Label className="font-semibold">Model</Label>
                <p className="text-sm text-muted-foreground">{selectedItem.generated_by_model}</p>
              </div>

              <div>
                <Label className="font-semibold">Confidence Score</Label>
                <p className="text-sm text-muted-foreground">
                  {(parseFloat(selectedItem.confidence_score.toString()) * 100).toFixed(1)}%
                </p>
              </div>

              {/* Generated Content Preview */}
              <div>
                <Label className="font-semibold">Generated Content</Label>
                <div className="bg-muted p-3 rounded text-sm max-h-40 overflow-y-auto">
                  {typeof selectedItem.generated_content === "string"
                    ? selectedItem.generated_content
                    : JSON.stringify(selectedItem.generated_content, null, 2)}
                </div>
              </div>

              {/* Quality Issues */}
              {Object.keys(selectedItem.quality_issues || {}).length > 0 && (
                <div>
                  <Label className="font-semibold">Quality Issues</Label>
                  <ul className="text-sm text-muted-foreground list-disc list-inside">
                    {Object.entries(selectedItem.quality_issues).map(([key, value]) => (
                      <li key={key}>
                        {key}: {String(value)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Review Notes */}
              <div>
                <Label htmlFor="notes">Your Review Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Add your feedback and observations..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="min-h-24"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setSelectedItem(null)}
              disabled={isProcessing}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedItem && handleReject(selectedItem.id)}
              disabled={isProcessing}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <XCircle className="h-4 w-4 mr-1" />}
              Reject
            </Button>
            <Button
              onClick={() => selectedItem && handleApprove(selectedItem.id)}
              disabled={isProcessing}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
