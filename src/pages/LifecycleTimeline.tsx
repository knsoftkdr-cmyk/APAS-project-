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
import { Loader2, History, LogIn, ArrowUpCircle, ArrowRightLeft, LogOut, GraduationCap, Search } from "lucide-react";

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

const EVENT_META: Record<string, { label: string; icon: any; color: string; ring: string }> = {
  admission: { label: "Admitted", icon: LogIn, color: "text-cyan-600 bg-cyan-50", ring: "ring-cyan-100" },
  promotion: { label: "Promoted", icon: ArrowUpCircle, color: "text-teal-600 bg-teal-50", ring: "ring-teal-100" },
  transfer_internal: { label: "Transferred (Internal)", icon: ArrowRightLeft, color: "text-purple-600 bg-purple-50", ring: "ring-purple-100" },
  transfer_external_in: { label: "Joined (External Transfer)", icon: LogIn, color: "text-cyan-600 bg-cyan-50", ring: "ring-cyan-100" },
  transfer_external_out: { label: "Left (External Transfer)", icon: LogOut, color: "text-orange-600 bg-orange-50", ring: "ring-orange-100" },
  alumni_conversion: { label: "Graduated", icon: GraduationCap, color: "text-indigo-600 bg-indigo-50", ring: "ring-indigo-100" },
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
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-500 p-6 text-white shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-sm">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Student Lifecycle Timeline</h1>
              <p className="text-sm text-white/80">Track a student's journey — promotions, transfers, and graduation</p>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Students list */}
          <Card className="md:col-span-1 border-l-4 border-l-teal-500 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-teal-700">
                Students
              </CardTitle>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 rounded-full border-teal-100 focus-visible:ring-teal-400"
                />
              </div>
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="mt-2 rounded-full border-teal-100">
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
                  <Loader2 className="h-5 w-5 animate-spin text-teal-500" />
                </div>
              ) : filteredStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No students found.</p>
              ) : (
                <div className="max-h-[500px] overflow-y-auto divide-y px-2 pb-2">
                  {filteredStudents.map((s) => {
                    const isSelected = selectedStudent?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => selectStudent(s)}
                        className={`w-full text-left px-4 py-3 my-1 rounded-xl transition-colors ${
                          isSelected
                            ? "bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-sm"
                            : "hover:bg-teal-50"
                        }`}
                      >
                        <div className={`text-sm font-medium ${isSelected ? "text-white" : "text-foreground"}`}>
                          {s.full_name}
                        </div>
                        <div className={`text-xs ${isSelected ? "text-white/80" : "text-muted-foreground"}`}>
                          {classLabel(s.class)}{s.section ? ` - ${s.section}` : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card className="md:col-span-2 border-l-4 border-l-cyan-500 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base text-cyan-700">
                {selectedStudent ? `${selectedStudent.full_name}'s Timeline` : "Select a student"}
              </CardTitle>
              <CardDescription>
                {selectedStudent ? "Chronological record of school lifecycle events" : "Choose a student from the list to view their history"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedStudent ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="h-12 w-12 rounded-full bg-teal-50 flex items-center justify-center">
                    <History className="h-6 w-6 text-teal-400" />
                  </div>
                  <p className="text-sm text-muted-foreground">No student selected yet.</p>
                </div>
              ) : loadingEvents ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-cyan-500" />
                </div>
              ) : events.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-16">
                  No lifecycle events recorded yet for this student.
                </p>
              ) : (
                <div className="relative pl-6">
                  <div className="absolute left-[9px] top-2 bottom-2 w-px bg-gradient-to-b from-teal-300 via-cyan-300 to-transparent" />
                  <div className="space-y-6">
                    {events.map((e) => {
                      const meta = EVENT_META[e.event_type] ?? { label: e.event_type, icon: History, color: "text-gray-600 bg-gray-50", ring: "ring-gray-100" };
                      const Icon = meta.icon;
                      return (
                        <div key={e.id} className="relative flex gap-3">
                          <div className={`absolute -left-6 w-5 h-5 rounded-full flex items-center justify-center ring-4 ${meta.color} ${meta.ring}`}>
                            <Icon className="h-3 w-3" />
                          </div>
                          <div className="ml-2 rounded-xl bg-teal-50/40 border border-teal-100 px-4 py-3 flex-1">
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