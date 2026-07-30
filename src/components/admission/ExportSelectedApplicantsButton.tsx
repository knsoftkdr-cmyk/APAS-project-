import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Download, Loader2 } from "lucide-react";
import { exportSelectedApplicants } from "@/lib/exportSelectedApplicants";

export function ExportSelectedApplicantsButton() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!profile?.school_id) return;
    setExporting(true);
    const { error } = await exportSelectedApplicants(profile.school_id);
    setExporting(false);

    if (error) {
      toast({ title: "Could not export", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Export ready" });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
      {exporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
      Export Selected
    </Button>
  );
}