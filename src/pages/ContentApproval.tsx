import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Layers } from "lucide-react";
import { useCanSeeQueue, useIsAdminLevel, useIsStaff } from "@/hooks/useApprovalWorkflow";
import { MyContentTab } from "@/components/approval/MyContentTab";
import { ApprovalQueueTab } from "@/components/approval/ApprovalQueueTab";
import { ApprovalSettingsTab } from "@/components/approval/ApprovalSettingsTab";
import { ReviewSheet } from "@/components/approval/ReviewSheet";

/**
 * Content Approval: one page, tabs by role.
 *  - My content        every staff member: status dashboard of the content they manage, submit / resubmit / history
 *  - Approval queue    admin-level, HOD: centralised queue + review screen
 *  - Settings          admin-level: switch the workflow on, configure the approval chain
 */
export default function ContentApproval() {
  const staff = useIsStaff();
  const reviewer = useCanSeeQueue();
  const adminLevel = useIsAdminLevel();
  const [params, setParams] = useSearchParams();
  const wanted = params.get("tab");
  const tabs = [staff && "mine", reviewer && "queue", (adminLevel || reviewer) && "settings"].filter(Boolean) as string[];
  const tab = wanted && tabs.includes(wanted) ? wanted : reviewer ? "queue" : "mine";
  const [reviewId, setReviewId] = useState<string | null>(params.get("review"));
  useEffect(() => { /* keep the URL shareable */
    const next = new URLSearchParams(params);
    if (reviewId) next.set("review", reviewId); else next.delete("review");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [reviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Content approval</h1>
            <p className="text-sm text-muted-foreground">Review, approve and publish learning content before students can see it.</p>
          </div>
          <Button variant="outline" asChild><Link to="/course-structure"><Layers className="h-4 w-4 me-1.5" />Course structure</Link></Button>
        </div>

        {!staff ? (
          <p className="rounded-md border p-6 text-sm text-muted-foreground">This page is for teachers and school administrators.</p>
        ) : (
          <Tabs value={tab} onValueChange={(v) => { const n = new URLSearchParams(params); n.set("tab", v); setParams(n, { replace: true }); }}>
            <TabsList>
              <TabsTrigger value="mine">My content</TabsTrigger>
              {reviewer && <TabsTrigger value="queue">Approval queue</TabsTrigger>}
              {(adminLevel || reviewer) && <TabsTrigger value="settings">Settings</TabsTrigger>}
            </TabsList>
            <TabsContent value="mine" className="mt-4">
              <MyContentTab onOpenSubmission={setReviewId} onOpenSettings={() => { const n = new URLSearchParams(params); n.set("tab", "settings"); setParams(n, { replace: true }); }} />
            </TabsContent>
            {reviewer && <TabsContent value="queue" className="mt-4"><ApprovalQueueTab onOpen={setReviewId} /></TabsContent>}
            {(adminLevel || reviewer) && <TabsContent value="settings" className="mt-4"><ApprovalSettingsTab /></TabsContent>}
          </Tabs>
        )}
        <ReviewSheet submissionId={reviewId} onClose={() => setReviewId(null)} />
      </div>
    </AppLayout>
  );
}
