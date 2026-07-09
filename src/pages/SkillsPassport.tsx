import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Award, Sparkles } from "lucide-react";

interface Competency {
  id: string;
  subject: string;
  name: string;
  description: string | null;
  grade_level: string | null;
}

interface LatestAssessment {
  competency_id: string;
  proficiency: "beginner" | "developing" | "proficient" | "advanced";
  assessed_date: string;
  notes: string | null;
}

interface ChildOption {
  id: string; // profiles.id
  full_name: string;
}

const PROFICIENCY_COLOR: Record<string, string> = {
  beginner: "bg-red-100 text-red-700 border-red-200",
  developing: "bg-amber-100 text-amber-700 border-amber-200",
  proficient: "bg-blue-100 text-blue-700 border-blue-200",
  advanced: "bg-green-100 text-green-700 border-green-200",
};

const PROFICIENCY_LABEL: Record<string, string> = {
  beginner: "Beginner",
  developing: "Developing",
  proficient: "Proficient",
  advanced: "Advanced",
};

export default function SkillsPassport() {
  const { profile, user } = useAuth();

  const isParent = profile?.role === "parent";

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [loadingChildren, setLoadingChildren] = useState(isParent);

  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [latestByCompetency, setLatestByCompetency] = useState<
    Record<string, LatestAssessment>
  >({});
  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState<string>("");

  // Determine the target student id: self, or selected child if parent
  const targetStudentId = isParent ? selectedChildId : user?.id;

  // If parent, load linked children
  useEffect(() => {
    if (!isParent || !user?.id) return;
    const fetchChildren = async () => {
      setLoadingChildren(true);

      const { data: links, error: linksError } = await supabase
        .from("parent_students")
        .select("student_id")
        .eq("parent_id", user.id);

      if (linksError || !links || links.length === 0) {
        setLoadingChildren(false);
        return;
      }

      const studentIds = links.map((l: any) => l.student_id);
      const { data: studentRows, error: studentsError } = await supabase
        .from("students")
        .select("profile_id, full_name")
        .in("profile_id", studentIds);

      if (!studentsError && studentRows) {
        const mapped: ChildOption[] = studentRows.map((s: any) => ({
          id: s.profile_id,
          full_name: s.full_name || "Student",
        }));
        setChildren(mapped);
        if (mapped.length > 0) setSelectedChildId(mapped[0].id);
      }
      setLoadingChildren(false);
    };
    fetchChildren();
  }, [isParent, user?.id]);

  // Load competencies + latest assessments for the target student
  useEffect(() => {
    if (!targetStudentId) {
      setLoading(false);
      return;
    }

    const fetchPassport = async () => {
      setLoading(true);

      // Get the student's school + grade + name via the students table
      const { data: studentRow, error: studentError } = await supabase
        .from("students")
        .select("school_id, grade, full_name")
        .eq("profile_id", targetStudentId)
        .maybeSingle();

      if (studentError || !studentRow) {
        setLoading(false);
        return;
      }
      setStudentName(studentRow.full_name || "");

      const normalizedGrade = studentRow.grade?.replace(/\D/g, "");

      const { data: compData, error: compError } = await supabase
        .from("competencies")
        .select("id, subject, name, description, grade_level")
        .eq("school_id", studentRow.school_id);

      if (compError || !compData) {
        setLoading(false);
        return;
      }

      const relevant = compData.filter((c) => {
        if (!c.grade_level || c.grade_level === "All Grades") return true;
        const compGrade = c.grade_level.replace(/\D/g, "");
        return compGrade === normalizedGrade;
      });
      setCompetencies(relevant);

      if (relevant.length > 0) {
        const { data: assessData } = await supabase
          .from("competency_assessments")
          .select("competency_id, proficiency, assessed_date, notes")
          .eq("student_id", targetStudentId)
          .in(
            "competency_id",
            relevant.map((c) => c.id)
          )
          .order("assessed_date", { ascending: false });

        const latest: Record<string, LatestAssessment> = {};
        (assessData || []).forEach((a: any) => {
          if (!latest[a.competency_id]) {
            latest[a.competency_id] = a; // first hit per competency = most recent, due to ordering
          }
        });
        setLatestByCompetency(latest);
      } else {
        setLatestByCompetency({});
      }

      setLoading(false);
    };
    fetchPassport();
  }, [targetStudentId]);

  const grouped = competencies.reduce<Record<string, Competency[]>>((acc, c) => {
    if (!acc[c.subject]) acc[c.subject] = [];
    acc[c.subject].push(c);
    return acc;
  }, {});

  const assessedCount = Object.keys(latestByCompetency).length;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Award className="h-6 w-6 text-primary" />
              Skills Passport
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {studentName
                ? `${studentName}'s competency progress across subjects.`
                : "Competency progress across subjects."}
            </p>
          </div>

          {isParent && (
            <Select
              value={selectedChildId}
              onValueChange={setSelectedChildId}
              disabled={loadingChildren || children.length === 0}
            >
              <SelectTrigger className="w-56">
                <SelectValue
                  placeholder={loadingChildren ? "Loading..." : "Select child"}
                />
              </SelectTrigger>
              <SelectContent>
                {children.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {isParent && children.length === 0 && !loadingChildren ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No linked students found on your account.
            </CardContent>
          </Card>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : competencies.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No competencies have been defined for this grade yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              {assessedCount} of {competencies.length} competencies assessed
            </div>

            {Object.entries(grouped).map(([subject, comps]) => (
              <Card key={subject}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{subject}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {comps.map((c) => {
                    const latest = latestByCompetency[c.id];
                    return (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-4 py-2 border-b last:border-0"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{c.name}</p>
                          {c.description && (
                            <p className="text-sm text-muted-foreground truncate">
                              {c.description}
                            </p>
                          )}
                          {latest?.notes && (
                            <p className="text-xs text-muted-foreground italic mt-1">
                              "{latest.notes}"
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {latest ? (
                            <>
                              <Badge
                                variant="outline"
                                className={`border ${PROFICIENCY_COLOR[latest.proficiency]}`}
                              >
                                {PROFICIENCY_LABEL[latest.proficiency]}
                              </Badge>
                              <p className="text-xs text-muted-foreground mt-1">
                                {latest.assessed_date}
                              </p>
                            </>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Not yet assessed
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
    </AppLayout>
  );
}
