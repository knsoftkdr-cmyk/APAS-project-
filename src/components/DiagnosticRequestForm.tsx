import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Clock, CheckCircle, XCircle, ClipboardList } from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { AGE_GROUPS } from "@/data/assessmentQuestions";

const EXCELLENCIA_EMAILS = [
  "excellencia1@gmail.com",
  "excellencia2@gmail.com",
  "excellencia3@gmail.com",
  "excellencia4@gmail.com",
  "excellencia5@gmail.com",
  "excellencia6@gmail.com",
];

/** Map class name to age group */
function getAgeGroupForClass(className: string): number {
  const lower = className.toLowerCase().trim();
  if (["nursery", "lkg", "ukg"].includes(lower)) return 3;
  const num = parseInt(lower.replace(/\D/g, ""));
  if (!isNaN(num)) {
    if (num <= 4) return 5;
    if (num <= 10) return 10;
    return 15;
  }
  return 5;
}

/** Build a 25-question distribution across all dimensions for a given class */
function build25QuestionDistribution(className: string): Record<string, number> {
  const ageGroup = getAgeGroupForClass(className);
  const config = AGE_GROUPS.find(g => g.ageGroup === ageGroup);
  if (!config) return {};

  const dims = config.dimensions;
  const total = 25;
  const base = Math.floor(total / dims.length);
  let remainder = total - base * dims.length;

  const distribution: Record<string, number> = {};
  for (const dim of dims) {
    const count = base + (remainder > 0 ? 1 : 0);
    distribution[dim.name] = Math.min(count, dim.questions.length);
    if (remainder > 0) remainder--;
  }

  return distribution;
}

const CLASS_OPTIONS = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `Class ${i + 1}`, label: `Class ${i + 1}` })),
];

const SUBJECT_OPTIONS = ["Mathematics", "Science", "English", "Social Studies", "Hindi", "EVS", "Computer Science"];

interface DiagnosticRequest {
  id: string;
  class_name: string;
  section: string;
  subject: string;
  purpose: string;
  suggested_count: number;
  approved_count: number | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  approved_at: string | null;
  assigned_at: string | null;
}

export const DiagnosticRequestForm = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("A");
  const [subject, setSubject] = useState("");
  const [purpose, setPurpose] = useState("");
  const [suggestedCount, setSuggestedCount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: requests, isLoading } = useQuery({
    queryKey: ["diagnostic-requests", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diagnostic_requests")
        .select("*")
        .eq("teacher_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DiagnosticRequest[];
    },
    enabled: !!user?.id,
  });

  const handleSubmit = async () => {
    if (!className || !subject || !purpose.trim() || !suggestedCount) {
      toast.error("Please fill all fields");
      return;
    }
    const count = parseInt(suggestedCount);
    if (isNaN(count) || count < 5 || count > 100) {
      toast.error("Question count must be between 5 and 100");
      return;
    }

    setSubmitting(true);

    const isExcellencia = EXCELLENCIA_EMAILS.includes(user!.email?.toLowerCase() || "");
    const finalCount = isExcellencia ? 25 : count;
    const questionDistribution = isExcellencia ? build25QuestionDistribution(className) : undefined;

    const insertPayload: any = {
      teacher_id: user!.id,
      class_name: className,
      section: (section.trim() || "A").toUpperCase(),
      subject,
      purpose: purpose.trim(),
      suggested_count: finalCount,
    };
    if (questionDistribution) {
      insertPayload.question_distribution = questionDistribution;
    }

    const { error } = await supabase.from("diagnostic_requests").insert(insertPayload);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Request submitted! Awaiting Master User approval.");
      setClassName("");
      setSection("A");
      setSubject("");
      setPurpose("");
      setSuggestedCount("");
      queryClient.invalidateQueries({ queryKey: ["diagnostic-requests"] });
    }
    setSubmitting(false);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "pending": return <Clock className="h-3.5 w-3.5" />;
      case "approved": return <CheckCircle className="h-3.5 w-3.5" />;
      case "rejected": return <XCircle className="h-3.5 w-3.5" />;
      case "assigned": return <ClipboardList className="h-3.5 w-3.5" />;
      case "completed": return <CheckCircle className="h-3.5 w-3.5" />;
      default: return null;
    }
  };

  const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "pending": return "secondary";
      case "approved": return "default";
      case "rejected": return "destructive";
      case "assigned": return "outline";
      case "completed": return "default";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-6">
      {/* Request Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Request Diagnostic Questions
          </CardTitle>
          <CardDescription>Submit a request for diagnostic question approval. Master User will review and set the final question count.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select value={className} onValueChange={setClassName}>
                <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Section</Label>
              <Input value={section} onChange={e => setSection(e.target.value.toUpperCase())} placeholder="e.g. A, B, C" />
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                <SelectContent>
                  {SUBJECT_OPTIONS.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Suggested Question Count (5–100)</Label>
              <Input type="number" min={5} max={100} value={suggestedCount} onChange={e => setSuggestedCount(e.target.value)} placeholder="e.g. 20" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Purpose / Rationale</Label>
            <Textarea value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Describe why this diagnostic is needed, target learning outcomes, etc." rows={3} />
          </div>
          <Button onClick={handleSubmit} disabled={submitting} className="w-full md:w-auto">
            {submitting ? <LoadingSpinner size="sm" /> : <Send className="h-4 w-4 mr-1" />}
            Submit Request
          </Button>
        </CardContent>
      </Card>

      {/* My Requests */}
      <Card>
        <CardHeader>
          <CardTitle>My Diagnostic Requests</CardTitle>
          <CardDescription>Track the status of your submitted requests</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : !requests || requests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No requests submitted yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Suggested</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Admin Notes</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.class_name} - {r.section}</TableCell>
                    <TableCell>{r.subject}</TableCell>
                    <TableCell>{r.suggested_count}</TableCell>
                    <TableCell>{r.approved_count ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)} className="gap-1 capitalize">
                        {statusIcon(r.status)} {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{r.admin_notes || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
