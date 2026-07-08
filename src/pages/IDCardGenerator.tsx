import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, IdCard, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Student {
  id: string;
  full_name: string;
  class: string;
  section: string;
  photo_url: string | null;
  blood_group: string | null;
  contact_phone: string | null;
  parent_phone: string | null;
  admission_number: string | null;
}

interface School {
  id: string;
  name: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
}

export default function IDCardGenerator() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [school, setSchool] = useState<School | null>(null);
  const [loading, setLoading] = useState(true);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!profile?.school_id) return;
    loadStudents();
    loadSchool();
  }, [profile?.school_id]);

  async function loadStudents() {
    setLoading(true);
    const { data, error } = await supabase
      .from("students")
      .select("id, full_name, class, section, photo_url, blood_group, contact_phone, parent_phone, admission_number")
      .eq("school_id", profile?.school_id)
      .eq("status", "active")
      .order("class")
      .order("section")
      .order("full_name");

    if (!error && data) {
      const sorted = [...data].sort((a, b) => {
        const classA = parseInt(String(a.class).replace(/\D/g, ""), 10) || 0;
        const classB = parseInt(String(b.class).replace(/\D/g, ""), 10) || 0;
        if (classA !== classB) return classA - classB;
        return a.full_name.localeCompare(b.full_name);
      });
      setStudents(sorted as Student[]);
    }
    setLoading(false);
  }

  async function loadSchool() {
    const { data } = await supabase
      .from("schools")
      .select("id, name, logo_url, address, phone")
      .eq("id", profile?.school_id)
      .maybeSingle();
    if (data) setSchool(data as School);
  }

  const uniqueClasses = Array.from(new Set(students.map((s) => s.class))).sort(
    (a, b) => (parseInt(String(a).replace(/\D/g, ""), 10) || 0) - (parseInt(String(b).replace(/\D/g, ""), 10) || 0)
  );
  const filteredStudents = classFilter === "all" ? students : students.filter((s) => s.class === classFilter);

  function classLabel(raw: string): string {
    const stripped = String(raw).replace(/^class\s*/i, "").trim();
    if (/^\d+$/.test(stripped)) return `Class ${stripped}`;
    const lower = stripped.toLowerCase();
    if (lower === "lkg") return "Class LKG";
    if (lower === "ukg") return "Class UKG";
    if (lower === "nursery") return "Class Nursery";
    return `Class ${stripped}`;
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredStudents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStudents.map((s) => s.id)));
    }
  }

  async function generateCards() {
    const targets = filteredStudents.filter((s) => selectedIds.has(s.id));
    if (targets.length === 0) {
      toast({ title: "No students selected", description: "Pick at least one student to generate cards for.", variant: "destructive" });
      return;
    }

    setGenerating(true);

    const cardsHtml = await Promise.all(
      targets.map(async (s) => {
        const photoHtml = s.photo_url
          ? `<img src="${s.photo_url}" class="photo" />`
          : `<div class="photo photo-placeholder">${(s.full_name || "?").charAt(0)}</div>`;

        return `
        <div class="card-pair">
          <div class="id-card front">
            <div class="card-header">
              ${school?.logo_url ? `<img src="${school.logo_url}" class="school-logo" />` : ""}
              <div class="school-name">${school?.name ?? "School"}</div>
            </div>
            ${photoHtml}
            <div class="student-name">${s.full_name}</div>
            <div class="student-class">Class ${s.class}${s.section ? ` - ${s.section}` : ""}</div>
            ${s.admission_number ? `<div class="adm-no">Adm. No: ${s.admission_number}</div>` : ""}
            <div class="card-footer">Student ID Card · ${new Date().getFullYear()}</div>
          </div>
          <div class="id-card back">
            <div class="back-title">Emergency Information</div>
            <div class="back-row"><span class="back-label">Blood Group:</span> ${s.blood_group ?? "—"}</div>
            <div class="back-row"><span class="back-label">Contact:</span> ${s.contact_phone ?? s.parent_phone ?? "—"}</div>
            ${school?.address ? `<div class="back-row"><span class="back-label">School:</span> ${school.address}</div>` : ""}
            ${school?.phone ? `<div class="back-row"><span class="back-label">School Phone:</span> ${school.phone}</div>` : ""}
          </div>
        </div>`;
      })
    );

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Student ID Cards</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 10mm; background: #f3f4f6; }
  .grid { display: flex; flex-wrap: wrap; gap: 8mm; }
  .card-pair { display: flex; gap: 4mm; page-break-inside: avoid; }
  .id-card {
    width: 54mm; height: 85.6mm;
    border-radius: 3mm;
    border: 1px solid #d1d5db;
    background: white;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    padding: 4mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .id-card.front { justify-content: flex-start; }
  .card-header { display: flex; flex-direction: column; align-items: center; margin-bottom: 3mm; }
  .school-logo { width: 10mm; height: 10mm; object-fit: contain; margin-bottom: 1mm; }
  .school-name { font-size: 3mm; font-weight: 700; color: #1e3a8a; line-height: 1.2; }
  .photo { width: 22mm; height: 22mm; border-radius: 50%; object-fit: cover; border: 1px solid #d1d5db; margin-bottom: 3mm; }
  .photo-placeholder { display: flex; align-items: center; justify-content: center; background: #e5e7eb; color: #6b7280; font-size: 8mm; font-weight: 600; }
  .student-name { font-size: 3.4mm; font-weight: 700; color: #111827; margin-bottom: 1mm; }
  .student-class { font-size: 2.8mm; color: #4b5563; margin-bottom: 1mm; }
  .adm-no { font-size: 2.4mm; color: #6b7280; }
  .card-footer { margin-top: auto; font-size: 2mm; color: #9ca3af; padding-top: 2mm; border-top: 1px solid #e5e7eb; width: 100%; }
  .id-card.back { justify-content: flex-start; }
  .back-title { font-size: 2.8mm; font-weight: 700; color: #1e3a8a; margin-bottom: 3mm; }
  .back-row { font-size: 2.4mm; color: #374151; margin-bottom: 1.5mm; width: 100%; text-align: left; }
  .back-label { font-weight: 600; color: #111827; }
  @media print {
    body { background: white; padding: 0; }
    .card-pair { break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="grid">
    ${cardsHtml.join("")}
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      setTimeout(() => { win.print(); }, 800);
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = `ID_Cards_${classFilter === "all" ? "All_Classes" : `Class_${classFilter}`}.html`;
      a.click();
    }
    URL.revokeObjectURL(url);
    setGenerating(false);
    toast({ title: "ID cards generated", description: "Use Print → Save as PDF, or check your downloads." });
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <IdCard className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Digital ID Cards</h1>
            <p className="text-sm text-muted-foreground">Generate printable student ID cards with QR verification</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Select students</CardTitle>
            <CardDescription>Filter by class, then choose who to generate cards for.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Select value={classFilter} onValueChange={(v) => { setClassFilter(v); setSelectedIds(new Set()); }}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All classes</SelectItem>
                  {uniqueClasses.map((c) => (
                    <SelectItem key={c} value={c}>{classLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" onClick={toggleSelectAll} disabled={loading || filteredStudents.length === 0}>
                {selectedIds.size === filteredStudents.length && filteredStudents.length > 0 ? "Deselect all" : "Select all"}
              </Button>

              <div className="ml-auto">
                <Button onClick={generateCards} disabled={generating || selectedIds.size === 0}>
                  {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
                  Generate {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No students found.</p>
            ) : (
              <div className="border rounded-lg divide-y max-h-[420px] overflow-y-auto">
                {filteredStudents.map((s) => (
                  <label key={s.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50">
                    <Checkbox checked={selectedIds.has(s.id)} onCheckedChange={() => toggleSelected(s.id)} />
                    {s.photo_url ? (
                      <img src={s.photo_url} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                        {s.full_name?.charAt(0) ?? "?"}
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-medium">{s.full_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {classLabel(s.class)}{s.section ? ` - ${s.section}` : ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
