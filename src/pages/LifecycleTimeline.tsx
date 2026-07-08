import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, History, LogIn, ArrowUpCircle, ArrowRightLeft, LogOut, GraduationCap } from "lucide-react";

interface Student {
  id: string;
  profile_id: string;
  full_name: string;
  class: string;
  section: string;
}

interface LifecycleEvent {
  id: string;
  event_type: string;
  event_date: string;
  details: Record<string, any>;
  created_at: string;
}

const EVENT_META: Record<string, { label: string; icon: any; color: string }> = {
  admission: { label: "Admitted", icon: LogIn, color: "text-blue-600 bg-blue-50" },
  promotion: { label: "Promoted", icon: ArrowUpCircle, color: "text-green-600 bg-green-50" },
  transfer_internal: { label: "Transferred (Internal)", icon: ArrowRightLeft, color: "text-purple-600 bg-purple-50" },
  transfer_external_in: { label: "Joined (External Transfer)", icon: LogIn, color: "text-blue-600 bg-blue-50" },
  transfer_external_out: { label: "Left (External Transfer)", icon: LogOut, color: "text-orange-600 bg-orange-50" },
  alumni_conversion: { label: "Graduated", icon: GraduationCap, color: "text-indigo-600 bg-indigo-50" },
};

function describeEvent(e: LifecycleEvent): string {
  const d = e.details || {};
  switch (e.event_type) {
    case "promotion":
      return `Class ${d.from_class ?? "—"} → Class ${d.to_class ?? "—"}${d.academic_year ? ` (${d.academic_year})` : ""}`;
    case "transfer_internal":
      return `Moved to a new school${d.new_class ? `, Class ${d.new_class}${d.new_section ? ` ${d.new_section}` : ""}` : ""}${d.reason ? ` — ${d.reason}` : ""}`;
    case "transfer_external_in":
      return `Joined${d.previous_school_name ? ` from ${d.previous_school_name}` : ""}${d.reason ? ` — ${d.reason}` : ""}`;
    case "transfer_external_out":
      return `Left${d.new_school_name ? ` for ${d.new_school_name}` : ""}${d.reason ? ` — ${d.reason}` : ""}`;
    case "alumni_conversion":
      return `Graduated from Class ${d.graduated_class ?? "—"}${d.batch_year ? `, Batch ${d.batch_year}` : ""}`;
    default:
      return "";
  }
}

export default function LifecycleTimeline() {
  const { profile } = useAuth();

  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    if (!profile?.school_id) return;
    loadStudents();
  }, [profile?.school_id]);

  async function loadStudents() {
    setLoadingStudents(true);
    const { data, error } = await supabase
      .from("students")
      .select("id, profile_id, full_name, class, section")
      .eq("school_id", profile?.school_id)
      .order("full_name");
    if (!error && data) setStudents(data as Student[]);
    setLoadingStudents(false);
  }

  async function selectStudent(s: Student) {
    setSelectedStudent(s);
    setLoadingEvents(true);
    const { data, error } = await supabase
      .from("student_lifecycle_events")
      .select("id, event_type, event_date, details, created_at")
      .eq("student_id", s.profile_id)
      .order("event_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error && data) setEvents(data as LifecycleEvent[]);
    setLoadingEvents(false);
  }

  function classLabel(raw: string): string {
    const stripped = String(raw).replace(/^class\s*/i, "").trim();
    if (/^\d+$/.test(stripped)) return `Class ${stripped}`;
    const lower = stripped.toLowerCase();
    if (lower === "lkg") return "Class LKG";
    if (lower === "ukg") return "Class UKG";
    if (lower === "nursery") return "Class Nursery";
    return `Class ${stripped}`;
  }

  const uniqueClasses = Array.from(new Set(students.map((s) => s.class))).sort(
    (a, b) => (parseInt(String(a).replace(/\D/g, ""), 10) || 0) - (parseInt(String(b).replace(/\D/g, ""), 10) || 0)
  );

  const filteredStudents = students.filter((s) => {
    const matchesSearch = search.trim() ? s.full_name?.toLowerCase().includes(search.toLowerCase()) : true;
    const matchesClass = classFilter === "all" ? true : s.class === classFilter;
    return matchesSearch && matchesClass;
  });

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Student Lifecycle Timeline</h1>
            <p className="text-sm text-muted-foreground">Track a student's journey — promotions, transfers, and graduation</p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Students</CardTitle>
              <Input
                placeholder="Search by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mt-2"
              />
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All classes</SelectItem>
                  {uniqueClasses.map((c) => (
                    <SelectItem key={c} value={c}>{classLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0">
              {loadingStudents ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No students found.</p>
              ) : (
                <div className="max-h-[500px] overflow-y-auto divide-y">
                  {filteredStudents.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => selectStudent(s)}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                        selectedStudent?.id === s.id ? "bg-muted" : ""
                      }`}
                    >
                      <div className="text-sm font-medium">{s.full_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {classLabel(s.class)}{s.section ? ` - ${s.section}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                {selectedStudent ? `${selectedStudent.full_name}'s Timeline` : "Select a student"}
              </CardTitle>
              <CardDescription>
                {selectedStudent ? "Chronological record of school lifecycle events" : "Choose a student from the list to view their history"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedStudent ? (
                <p className="text-sm text-muted-foreground text-center py-16">No student selected yet.</p>
              ) : loadingEvents ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : events.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-16">
                  No lifecycle events recorded yet for this student.
                </p>
              ) : (
                <div className="relative pl-6">
                  <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />
                  <div className="space-y-6">
                    {events.map((e) => {
                      const meta = EVENT_META[e.event_type] ?? { label: e.event_type, icon: History, color: "text-gray-600 bg-gray-50" };
                      const Icon = meta.icon;
                      return (
                        <div key={e.id} className="relative flex gap-3">
                          <div className={`absolute -left-6 w-5 h-5 rounded-full flex items-center justify-center ${meta.color}`}>
                            <Icon className="h-3 w-3" />
                          </div>
                          <div className="ml-2">
                            <div className="text-sm font-medium">{meta.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(e.event_date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                            </div>
                            {describeEvent(e) && (
                              <div className="text-sm text-muted-foreground mt-1">{describeEvent(e)}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
