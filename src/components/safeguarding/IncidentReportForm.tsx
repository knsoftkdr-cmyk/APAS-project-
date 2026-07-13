import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client"; // adjust path if your client lives elsewhere
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { IncidentCategory, IncidentSeverity } from "@/types/safeguarding";

interface StudentOption {
  id: string; // students.id — NOT profiles.id
  name: string;
  class: string | null;
  section: string | null;
}

const CATEGORY_OPTIONS: { value: IncidentCategory; label: string }[] = [
  { value: "physical", label: "Physical" },
  { value: "emotional", label: "Emotional" },
  { value: "neglect", label: "Neglect" },
  { value: "online", label: "Online / Cyber" },
  { value: "bullying", label: "Bullying" },
  { value: "other", label: "Other" },
];

const SEVERITY_OPTIONS: { value: IncidentSeverity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export function IncidentReportForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const { toast } = useToast();
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [studentId, setStudentId] = useState<string>("");
  const [category, setCategory] = useState<IncidentCategory | "">("");
  const [severity, setSeverity] = useState<IncidentSeverity | "">("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Loads students for the reporting teacher's school so this dropdown
    // stays consistent with the students.id / profiles.id distinction
    // used elsewhere in APAS. full_name/class/section live directly on
    // the students table, so no join is needed.
    async function loadStudents() {
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, class, section")
        .order("full_name");

      if (error) {
        console.error("Failed to load students:", error);
        return;
      }

      setStudents(
        (data ?? []).map((s: any) => ({
          id: s.id,
          name: s.full_name ?? "Unnamed student",
          class: s.class,
          section: s.section,
        }))
      );
    }
    loadStudents();
  }, []);

  const handleSubmit = async () => {
    if (!category || !severity || !description.trim()) {
      toast({
        title: "Missing information",
        description: "Category, severity, and description are required.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const { data, error } = await supabase.functions.invoke(
        "create-safeguarding-incident",
        {
          body: {
            student_id: studentId || null,
            category,
            severity,
            description,
          },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      );

      if (error) throw error;

      toast({
        title: "Report submitted",
        description: "The Designated Safeguarding Lead has been notified.",
      });

      setSelectedClass("");
      setSelectedSection("");
      setStudentId("");
      setCategory("");
      setSeverity("");
      setDescription("");
      onSubmitted?.();
    } catch (err) {
      console.error("Submit error:", err);
      toast({
        title: "Submission failed",
        description: "Please try again, or contact an administrator directly.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Extract the numeric part of a class label for proper sorting
  // (so "Class 2" comes before "Class 10", not after)
  function classSortValue(label: string): number {
    const match = label.match(/\d+/);
    return match ? parseInt(match[0], 10) : 999;
  }

  const uniqueClasses = Array.from(
    new Set(students.map((s) => s.class).filter((c): c is string => !!c))
  ).sort((a, b) => classSortValue(a) - classSortValue(b));

  const sectionsForClass = Array.from(
    new Set(
      students
        .filter((s) => s.class === selectedClass)
        .map((s) => s.section)
        .filter((sec): sec is string => !!sec)
    )
  ).sort();

  const filteredStudents = students.filter((s) => {
    if (selectedClass && s.class !== selectedClass) return false;
    if (selectedSection && s.section !== selectedSection) return false;
    return true;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report a Safeguarding Concern</CardTitle>
        <CardDescription>
          This report goes directly to the Designated Safeguarding Lead. Only submit
          factual observations — this is not the place for anonymous reports (use the
          Anonymous Reporting form for that).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Class</Label>
            <Select
              value={selectedClass}
              onValueChange={(v) => {
                setSelectedClass(v);
                setSelectedSection("");
                setStudentId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select class" />
              </SelectTrigger>
              <SelectContent>
                {uniqueClasses.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Section</Label>
            <Select
              value={selectedSection}
              onValueChange={(v) => {
                setSelectedSection(v);
                setStudentId("");
              }}
              disabled={!selectedClass}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select section" />
              </SelectTrigger>
              <SelectContent>
                {sectionsForClass.map((sec) => (
                  <SelectItem key={sec} value={sec}>
                    {sec}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Student (optional)</Label>
          <Select value={studentId} onValueChange={setStudentId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a student, if applicable" />
            </SelectTrigger>
            <SelectContent>
              {filteredStudents.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Category *</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as IncidentCategory)}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Severity *</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as IncidentSeverity)}>
              <SelectTrigger>
                <SelectValue placeholder="Select severity" />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Description *</Label>
          <Textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what was observed, when, and where. Stick to facts."
          />
        </div>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full">
          {submitting ? "Submitting..." : "Submit Report"}
        </Button>
      </CardContent>
    </Card>
  );
}