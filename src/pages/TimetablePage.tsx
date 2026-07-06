/**
 * TimetablePage.tsx v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Supports both CLASS timetables and TEACHER timetables
 * 
 * Principal/Admin:
 *  - Tab 1: Upload class timetable (class + section)
 *  - Tab 2: Upload teacher timetable (select teacher from dropdown)
 *  - View/delete all timetables
 * 
 * Student: sees their class+section timetable (read-only)
 * Teacher: sees their own assigned timetable (read-only)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import * as XLSX from "xlsx";
import {
  CalendarDays, Upload, Trash2, Eye, FileSpreadsheet,
  BookOpen, GraduationCap, RefreshCw, Users, User,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimetableRow {
  id: number;
  school_id: string;
  class_grade: string | null;
  section: string | null;
  teacher_id: string | null;
  timetable_type: string;
  file_path: string;
  file_name: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  teacher_name?: string;
}

interface ParsedTimetable {
  headers: string[];
  rows: string[][];
}

interface TeacherProfile {
  id: string;
  full_name: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

const TimetablePage = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const isPrincipal = profile?.role === "principal" || profile?.role === "admin" || profile?.role === "school_admin";
  const isStudent = profile?.role === "student";
  const isTeacher = profile?.role === "teacher";
  const isHOD = profile?.role === "hod";

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [timetables, setTimetables] = useState<TimetableRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);

  // Class upload
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [classFile, setClassFile] = useState<File | null>(null);
  const classFileRef = useRef<HTMLInputElement>(null);
  const [uploadingClass, setUploadingClass] = useState(false);

  // Teacher upload
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [teacherFile, setTeacherFile] = useState<File | null>(null);
  const teacherFileRef = useRef<HTMLInputElement>(null);
  const [uploadingTeacher, setUploadingTeacher] = useState(false);

  // Viewer
  const [viewingTimetable, setViewingTimetable] = useState<ParsedTimetable | null>(null);
  const [viewingLabel, setViewingLabel] = useState("");
  const [loadingView, setLoadingView] = useState(false);

  // Clash detection
  const [checkingClashes, setCheckingClashes] = useState(false);
  const [clashResults, setClashResults] = useState<{
    clashes: { day: string; period: string; teacherName: string; classesInvolved: { className: string; section: string; subject: string }[]; suggestedSwap: string | null }[];
    unmatched: { className: string; section: string; day: string; period: string; rawText: string }[];
  } | null>(null);

  const handleCheckClashes = async () => {
    if (!schoolId) return;
    setCheckingClashes(true);
    setClashResults(null);
    try {
      const { data, error } = await supabase.functions.invoke("check-timetable-clashes", {
        body: { school_id: schoolId },
      });
      if (error) throw error;
      setClashResults(data);
    } catch (e: any) {
      toast({ title: "Couldn't check clashes", description: e.message, variant: "destructive" });
    } finally {
      setCheckingClashes(false);
    }
  };

  // What-If: simulate a teacher's absence
  const [absenceTeacherId, setAbsenceTeacherId] = useState("");
  const [absenceDay, setAbsenceDay] = useState("monday");
  const [checkingAbsence, setCheckingAbsence] = useState(false);
  const [absenceResults, setAbsenceResults] = useState<{
    teacherName: string;
    day: string;
    impact: { className: string; section: string; period: string; subject: string; candidateSubstitutes: string[] }[];
  } | null>(null);

  const handleSimulateAbsence = async () => {
    if (!schoolId || !absenceTeacherId) return;
    setCheckingAbsence(true);
    setAbsenceResults(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatif-timetable", {
        body: { mode: "teacher_absence", school_id: schoolId, teacher_id: absenceTeacherId, day: absenceDay },
      });
      if (error) throw error;
      setAbsenceResults(data);
    } catch (e: any) {
      toast({ title: "Couldn't simulate absence", description: e.message, variant: "destructive" });
    } finally {
      setCheckingAbsence(false);
    }
  };

  const schoolId = profile?.school_id;

  // ── Fetch teachers ─────────────────────────────────────────────────────────
  const fetchTeachers = useCallback(async () => {
    if (!schoolId) return;
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("school_id", schoolId)
      .eq("role", "teacher")
      .order("full_name");
    setTeachers(data ?? []);
  }, [schoolId]);

  // ── Fetch timetables ───────────────────────────────────────────────────────
  const fetchTimetables = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("timetables")
        .select("*")
        .eq("school_id", schoolId)
        .order("timetable_type")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Enrich teacher timetables with teacher name
      const enriched = (data ?? []).map((tt: any) => ({
        ...tt,
        teacher_name: tt.teacher_id
          ? teachers.find(t => t.id === tt.teacher_id)?.full_name ?? "Unknown Teacher"
          : null,
      }));
      setTimetables(enriched);
    } catch (e: any) {
      toast({ title: "Error loading timetables", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [schoolId, teachers, toast]);

  // ── Auto-load student timetable ────────────────────────────────────────────
  const fetchStudentTimetable = useCallback(async () => {
    if (!profile?.class_grade || !schoolId) { setLoading(false); return; }
    try {
      const { data } = await supabase
        .from("timetables")
        .select("*")
        .eq("school_id", schoolId)
        .eq("class_grade", profile.class_grade)
        .eq("section", profile.section ?? "")
        .eq("timetable_type", "class")
        .single();
      if (data) await loadAndParseFile(data.file_path, `Class ${data.class_grade} - Section ${data.section}`);
    } catch (e: any) {
      console.warn("No student timetable found");
    } finally {
      setLoading(false);
    }
  }, [profile, schoolId]);

  // ── Auto-load teacher timetable ────────────────────────────────────────────
  const fetchTeacherTimetable = useCallback(async () => {
    if (!user?.id || !schoolId) { setLoading(false); return; }
    try {
      const { data } = await supabase
        .from("timetables")
        .select("*")
        .eq("school_id", schoolId)
        .eq("teacher_id", user.id)
        .eq("timetable_type", "teacher")
        .single();
      if (data) await loadAndParseFile(data.file_path, `My Timetable - ${profile?.full_name ?? "Teacher"}`);
    } catch (e: any) {
      console.warn("No teacher timetable found");
    } finally {
      setLoading(false);
    }
  }, [user, schoolId, profile]);

  useEffect(() => {
    if (isPrincipal || isHOD) {
      fetchTeachers().then(() => fetchTimetables());
    } else if (isStudent) {
      fetchStudentTimetable();
    } else if (isTeacher) {
      fetchTeacherTimetable();
    } else {
      setLoading(false);
    }
  }, [profile]);

  // Re-fetch timetables after teachers are loaded
  useEffect(() => {
    if ((isPrincipal || isHOD) && teachers.length > 0) fetchTimetables();
  }, [teachers]);

  // ── Parse Excel from storage ───────────────────────────────────────────────
  const loadAndParseFile = async (filePath: string, label: string) => {
    setLoadingView(true);
    try {
      const { data, error } = await supabase.storage.from("timetables").download(filePath);
      if (error) throw error;
      const arrayBuffer = await data.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (json.length === 0) { toast({ title: "Empty file", variant: "destructive" }); return; }
      setViewingTimetable({ headers: (json[0] ?? []).map(String), rows: json.slice(1).map(r => r.map(String)) });
      setViewingLabel(label);
    } catch (e: any) {
      toast({ title: "Error reading file", description: e.message, variant: "destructive" });
    } finally {
      setLoadingView(false);
    }
  };

  // ── Upload class timetable ─────────────────────────────────────────────────
  const handleUploadClass = async () => {
    if (!classFile || !selectedClass.trim() || !selectedSection.trim()) {
      toast({ title: "All fields required", variant: "destructive" }); return;
    }
    if (!schoolId) return;
    setUploadingClass(true);
    try {
      // Parse the grid now (same shape as the existing "view" feature: headers + rows)
      // so clash-detection can read structured data later without re-parsing the file.
      let parsedGrid: { headers: string[]; rows: string[][] } | null = null;
      try {
        const arrayBuffer = await classFile.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (json.length > 0) {
          parsedGrid = { headers: (json[0] ?? []).map(String), rows: json.slice(1).map(r => r.map(String)) };
        }
      } catch {
        // If parsing fails, we still upload the file itself — clash detection
        // just won't be available for this class until it's re-uploaded in a readable format.
      }

      const filePath = `${schoolId}/class_${selectedClass}_section_${selectedSection}.xlsx`;
      const { error: uploadError } = await supabase.storage.from("timetables").upload(filePath, classFile, { upsert: true });
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase.from("timetables").upsert({
        school_id: schoolId,
        class_grade: selectedClass.trim(),
        section: selectedSection.trim().toUpperCase(),
        teacher_id: null,
        timetable_type: "class",
        file_path: filePath,
        file_name: classFile.name,
        parsed_grid: parsedGrid,
        uploaded_by: user?.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "school_id,class_grade,section,teacher_id,timetable_type" });
      if (dbError) throw dbError;
      toast({ title: "Class timetable uploaded ✅", description: `Class ${selectedClass} - Section ${selectedSection}` });
      setClassFile(null); setSelectedClass(""); setSelectedSection("");
      if (classFileRef.current) classFileRef.current.value = "";
      fetchTimetables();

toast({ title: "Class timetable uploaded ✅", description: `Class ${selectedClass} - Section ${selectedSection}` });
setClassFile(null); setSelectedClass(""); setSelectedSection("");
if (classFileRef.current) classFileRef.current.value = "";
fetchTimetables();

// Notify students + parents of this class/section
try {
  await fetch(
    "https://qkclzrscyhzrbixajaiw.supabase.co/functions/v1/send-push-notification",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "homework_with_parents",
        payload: {
          school_id: schoolId,
          class_level: `Class ${selectedClass.trim()}`,
          section: selectedSection.trim().toUpperCase(),
          title: "Timetable Updated",
          body: `Your timetable for Class ${selectedClass} - Section ${selectedSection.trim().toUpperCase()} has been updated. Check your timetable now.`,
          homework_id: "",
        },
      }),
    }
  );
} catch (notifError) {
  console.error("Timetable notification failed:", notifError);
}


    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingClass(false);
    }
  };

  // ── Upload teacher timetable ───────────────────────────────────────────────
  const handleUploadTeacher = async () => {
    if (!teacherFile || !selectedTeacherId) {
      toast({ title: "Select a teacher and file", variant: "destructive" }); return;
    }
    if (!schoolId) return;
    setUploadingTeacher(true);
    try {
      const teacher = teachers.find(t => t.id === selectedTeacherId);
      const safeName = (teacher?.full_name ?? "teacher").replace(/\s+/g, "_").toLowerCase();
      const filePath = `${schoolId}/teacher_${safeName}_${selectedTeacherId.slice(0, 8)}.xlsx`;
      const { error: uploadError } = await supabase.storage.from("timetables").upload(filePath, teacherFile, { upsert: true });
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase.from("timetables").upsert({
        school_id: schoolId,
        class_grade: null,
        section: null,
        teacher_id: selectedTeacherId,
        timetable_type: "teacher",
        file_path: filePath,
        file_name: teacherFile.name,
        uploaded_by: user?.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "school_id,class_grade,section,teacher_id,timetable_type" });
      if (dbError) throw dbError;
      toast({ title: "Teacher timetable uploaded ✅", description: teacher?.full_name });
      setTeacherFile(null); setSelectedTeacherId("");
      if (teacherFileRef.current) teacherFileRef.current.value = "";
      fetchTimetables();

toast({ title: "Teacher timetable uploaded ✅", description: teacher?.full_name });
setTeacherFile(null); setSelectedTeacherId("");
if (teacherFileRef.current) teacherFileRef.current.value = "";
fetchTimetables();

// Notify the teacher directly
try {
  await fetch(
    "https://qkclzrscyhzrbixajaiw.supabase.co/functions/v1/send-push-notification",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "single_by_user_id",
        payload: {
          user_id: selectedTeacherId,
          title: "Your Timetable Updated",
          body: `Your weekly timetable has been updated by the principal. Check your timetable now.`,
          data: {
            type: "timetable_update",
          },
        },
      }),
    }
  );
} catch (notifError) {
  console.error("Teacher timetable notification failed:", notifError);
}

    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingTeacher(false);
    }
  };

  // ── Delete timetable ───────────────────────────────────────────────────────
  const handleDelete = async (tt: TimetableRow) => {
    const label = tt.timetable_type === "teacher"
      ? `timetable for ${tt.teacher_name}`
      : `timetable for Class ${tt.class_grade} - Section ${tt.section}`;
    if (!confirm(`Delete ${label}?`)) return;
    try {
      await supabase.storage.from("timetables").remove([tt.file_path]);
      await supabase.from("timetables").delete().eq("id", tt.id);
      toast({ title: "Timetable deleted" });
      if (viewingLabel.includes(tt.teacher_name ?? "") || viewingLabel.includes(`${tt.class_grade}`)) {
        setViewingTimetable(null); setViewingLabel("");
      }
      fetchTimetables();
    } catch (e: any) {
      toast({ title: "Error deleting", description: e.message, variant: "destructive" });
    }
  };

  // ── Render timetable table ─────────────────────────────────────────────────
  const renderTimetable = () => {
    if (!viewingTimetable) return null;
    const { headers, rows } = viewingTimetable;
    const dayColors = ["bg-blue-50 text-blue-800","bg-green-50 text-green-800","bg-purple-50 text-purple-800","bg-orange-50 text-orange-800","bg-pink-50 text-pink-800"];
    return (
      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-blue-600 to-blue-500 text-white">
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-3 text-left font-semibold whitespace-nowrap text-sm">{h || `Col ${i+1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                {row.map((cell, ci) => (
                  <td key={ci} className={`px-3 py-2.5 border-b border-slate-100 whitespace-nowrap
                    ${ci === 0 ? "font-semibold text-slate-700 bg-slate-50" : ""}
                    ${ci > 0 && cell && !cell.includes("BREAK") && !cell.includes("LUNCH") ? dayColors[(ci-1) % dayColors.length] + " font-medium" : ""}
                    ${cell.includes("BREAK") || cell.includes("LUNCH") ? "text-slate-400 italic text-center" : ""}
                  `}>
                    {cell || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Split timetables by type ───────────────────────────────────────────────
  const classTimetables = timetables.filter(t => t.timetable_type === "class");
  const teacherTimetables = timetables.filter(t => t.timetable_type === "teacher");

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <AppLayout>
      <div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div>
    </AppLayout>
  );

  // ── Student view ───────────────────────────────────────────────────────────
  if (isStudent) return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-500 p-8 text-white">
          <div className="absolute top-6 right-10 w-16 h-16 rounded-full border border-white/30" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
              <CalendarDays className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">My Timetable</h1>
              <p className="text-blue-100 mt-1">Class {profile?.class_grade ?? "—"} · Section {profile?.section ?? "—"}</p>
            </div>
          </div>
        </div>
        {viewingTimetable ? (
          <Card className="border-2 border-blue-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-700">
                <CalendarDays className="h-5 w-5" />{viewingLabel}
              </CardTitle>
              <CardDescription>Your weekly class schedule</CardDescription>
            </CardHeader>
            <CardContent>{renderTimetable()}</CardContent>
          </Card>
        ) : (
          <Card className="border-2 border-dashed border-slate-200">
            <CardContent className="py-16 text-center">
              <CalendarDays className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">No timetable uploaded yet</p>
              <p className="text-slate-400 text-sm mt-1">Your principal hasn't uploaded a timetable for your class yet.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );

  // ── Teacher view ───────────────────────────────────────────────────────────
  if (isTeacher) return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-green-600 via-green-500 to-teal-500 p-8 text-white">
          <div className="absolute top-6 right-10 w-16 h-16 rounded-full border border-white/30" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
              <CalendarDays className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">My Timetable</h1>
              <p className="text-green-100 mt-1">Your weekly teaching schedule</p>
            </div>
          </div>
        </div>
        {viewingTimetable ? (
          <Card className="border-2 border-green-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-700">
                <User className="h-5 w-5" />{viewingLabel}
              </CardTitle>
              <CardDescription>Your assigned weekly timetable</CardDescription>
            </CardHeader>
            <CardContent>{renderTimetable()}</CardContent>
          </Card>
        ) : (
          <Card className="border-2 border-dashed border-slate-200">
            <CardContent className="py-16 text-center">
              <CalendarDays className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">No timetable assigned yet</p>
              <p className="text-slate-400 text-sm mt-1">Your principal hasn't assigned a timetable to you yet.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );

  // ── HOD view (read-only) ───────────────────────────────────────────────────
  if (isHOD) return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-600 via-purple-500 to-indigo-500 p-8 text-white">
          <div className="absolute top-6 right-10 w-16 h-16 rounded-full border border-white/30" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
              <CalendarDays className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Timetable Overview</h1>
              <p className="text-purple-100 mt-1">View all class and teacher timetables</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left - list */}
          <div className="lg:col-span-1">
            <Card className="border-2 border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />All Timetables
                  <Badge className="bg-purple-100 text-purple-700 ml-1">{timetables.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {classTimetables.length > 0 && (
                  <>
                    <p className="px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50">CLASS TIMETABLES</p>
                    <div className="divide-y divide-slate-100">
                      {classTimetables.map(tt => (
                        <div key={tt.id}
                          className={`flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors
                            ${viewingLabel === `Class ${tt.class_grade} - Section ${tt.section}` ? "bg-blue-50 border-l-4 border-l-blue-500" : ""}`}
                          onClick={() => loadAndParseFile(tt.file_path, `Class ${tt.class_grade} - Section ${tt.section}`)}>
                          <div>
                            <p className="text-sm font-semibold text-slate-700">Class {tt.class_grade} · Section {tt.section}</p>
                            <p className="text-xs text-slate-400">{tt.file_name}</p>
                          </div>
                          <Eye className="h-4 w-4 text-blue-400" />
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {teacherTimetables.length > 0 && (
                  <>
                    <p className="px-4 py-2 text-xs font-semibold text-green-600 bg-green-50">TEACHER TIMETABLES</p>
                    <div className="divide-y divide-slate-100">
                      {teacherTimetables.map(tt => (
                        <div key={tt.id}
                          className={`flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors
                            ${viewingLabel.includes(tt.teacher_name ?? "") ? "bg-green-50 border-l-4 border-l-green-500" : ""}`}
                          onClick={() => loadAndParseFile(tt.file_path, `${tt.teacher_name ?? "Teacher"}'s Timetable`)}>
                          <div>
                            <p className="text-sm font-semibold text-slate-700">{tt.teacher_name ?? "Unknown"}</p>
                            <p className="text-xs text-slate-400">{tt.file_name}</p>
                          </div>
                          <Eye className="h-4 w-4 text-green-400" />
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {timetables.length === 0 && (
                  <p className="p-4 text-center text-sm text-slate-400">No timetables uploaded yet</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right - viewer */}
          <div className="lg:col-span-2">
            <Card className="border-2 border-slate-200 min-h-[500px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-purple-600" />
                  {viewingLabel || "Timetable Viewer"}
                </CardTitle>
                <CardDescription>
                  {viewingLabel ? "Read-only view" : "Select a timetable from the list to preview"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingView ? (
                  <div className="flex items-center justify-center py-20"><LoadingSpinner size="lg" /></div>
                ) : viewingTimetable ? renderTimetable() : (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <CalendarDays className="h-16 w-16 text-slate-200 mb-4" />
                    <p className="text-slate-400 font-medium">No timetable selected</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );

  // ── Principal / Admin view ─────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-500 p-8 text-white">
          <div className="absolute top-6 right-10 w-16 h-16 rounded-full border border-white/30" />
          <div className="absolute bottom-4 right-32 w-8 h-8 rounded-full border border-white/20" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
              <CalendarDays className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold">Timetable Manager</h1>
              <p className="text-blue-100 mt-1">Manage class and teacher timetables</p>
            </div>
            <Button
              variant="secondary"
              className="bg-white/20 hover:bg-white/30 text-white border-0"
              onClick={handleCheckClashes}
              disabled={checkingClashes}
            >
              {checkingClashes ? "Checking..." : "Check Clashes"}
            </Button>
          </div>
        </div>

        {/* Clash results panel */}
        {clashResults && (
          <Card className={clashResults.clashes.length > 0 ? "border-2 border-red-200" : "border-2 border-emerald-200"}>
            <CardHeader>
              <CardTitle className="text-base">
                {clashResults.clashes.length === 0
                  ? "No teacher clashes found ✅"
                  : `${clashResults.clashes.length} clash(es) found`}
              </CardTitle>
              <CardDescription>
                {clashResults.unmatched.length > 0 &&
                  `${clashResults.unmatched.length} subject entries couldn't be matched to a teacher — likely missing teacher assignments in Class Management.`}
              </CardDescription>
            </CardHeader>
            {clashResults.clashes.length > 0 && (
              <CardContent className="space-y-3">
                {clashResults.clashes.map((clash, i) => (
                  <div key={i} className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-1">
                    <p className="text-sm font-semibold text-red-800">
                      {clash.teacherName} — {clash.day}, {clash.period}
                    </p>
                    <p className="text-sm text-red-700">
                      Booked in: {clash.classesInvolved.map((c) => `${c.className}-${c.section} (${c.subject})`).join(" and ")}
                    </p>
                    {clash.suggestedSwap ? (
                      <p className="text-sm text-emerald-700 mt-1">💡 {clash.suggestedSwap}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-1">No automatic swap suggestion available — resolve manually.</p>
                    )}
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left panel */}
          <div className="lg:col-span-1 space-y-4">
            <Tabs defaultValue="class">
              <TabsList className="w-full">
                <TabsTrigger value="class" className="flex-1 gap-1.5">
                  <BookOpen className="h-4 w-4" />Class
                </TabsTrigger>
                <TabsTrigger value="teacher" className="flex-1 gap-1.5">
                  <Users className="h-4 w-4" />Teacher
                </TabsTrigger>
                <TabsTrigger value="whatif" className="flex-1 gap-1.5">
                  <Users className="h-4 w-4" />What-If
                </TabsTrigger>
              </TabsList>

              {/* Class upload tab */}
              <TabsContent value="class">
                <Card className="border-2 border-blue-100">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-blue-700 text-base">
                      <Upload className="h-4 w-4" />Upload Class Timetable
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Class</Label>
                      <Input placeholder="e.g. 1, 2, 3 ... 10" value={selectedClass} onChange={e => setSelectedClass(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Section</Label>
                      <Input placeholder="e.g. A, B, C" value={selectedSection} onChange={e => setSelectedSection(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Excel File (.xlsx)</Label>
                      <div className="border-2 border-dashed border-blue-200 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all" onClick={() => classFileRef.current?.click()}>
                        <FileSpreadsheet className="h-6 w-6 text-blue-400 mx-auto mb-1" />
                        {classFile ? (
                          <><p className="text-sm font-medium text-blue-700">{classFile.name}</p><p className="text-xs text-slate-400">{(classFile.size/1024).toFixed(1)} KB</p></>
                        ) : (
                          <p className="text-sm text-slate-400">Click to select .xlsx file</p>
                        )}
                      </div>
                      <input ref={classFileRef} type="file" accept=".xlsx" className="hidden" onChange={e => setClassFile(e.target.files?.[0] ?? null)} />
                    </div>
                    <Button className="w-full bg-blue-600" onClick={handleUploadClass} disabled={uploadingClass}>
                      {uploadingClass ? <LoadingSpinner size="sm" /> : <><Upload className="h-4 w-4 mr-2" />Upload</>}
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Teacher upload tab */}
              <TabsContent value="teacher">
                <Card className="border-2 border-green-100">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-700 text-base">
                      <Upload className="h-4 w-4" />Upload Teacher Timetable
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Select Teacher</Label>
                      <Select value={selectedTeacherId} onValueChange={setSelectedTeacherId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a teacher..." />
                        </SelectTrigger>
                        <SelectContent>
                          {teachers.length === 0 ? (
                            <SelectItem value="none" disabled>No teachers found</SelectItem>
                          ) : (
                            teachers.map(t => (
                              <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Excel File (.xlsx)</Label>
                      <div className="border-2 border-dashed border-green-200 rounded-xl p-4 text-center cursor-pointer hover:border-green-400 hover:bg-green-50 transition-all" onClick={() => teacherFileRef.current?.click()}>
                        <FileSpreadsheet className="h-6 w-6 text-green-400 mx-auto mb-1" />
                        {teacherFile ? (
                          <><p className="text-sm font-medium text-green-700">{teacherFile.name}</p><p className="text-xs text-slate-400">{(teacherFile.size/1024).toFixed(1)} KB</p></>
                        ) : (
                          <p className="text-sm text-slate-400">Click to select .xlsx file</p>
                        )}
                      </div>
                      <input ref={teacherFileRef} type="file" accept=".xlsx" className="hidden" onChange={e => setTeacherFile(e.target.files?.[0] ?? null)} />
                    </div>
                    <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleUploadTeacher} disabled={uploadingTeacher}>
                      {uploadingTeacher ? <LoadingSpinner size="sm" /> : <><Upload className="h-4 w-4 mr-2" />Upload</>}
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
              {/* What-If tab */}
              <TabsContent value="whatif">
                <Card className="border-2 border-amber-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-amber-700 flex items-center gap-2">
                      <Users className="h-4 w-4" />What-If: Teacher Absence
                    </CardTitle>
                    <CardDescription className="text-xs">See which classes are affected and who's free to substitute</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Teacher</Label>
                      <Select value={absenceTeacherId} onValueChange={setAbsenceTeacherId}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Choose a teacher..." />
                        </SelectTrigger>
                        <SelectContent>
                          {teachers.map(t => (
                            <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Day</Label>
                      <Select value={absenceDay} onValueChange={setAbsenceDay}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map(d => (
                            <SelectItem key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      className="w-full bg-amber-600 hover:bg-amber-700"
                      onClick={handleSimulateAbsence}
                      disabled={checkingAbsence || !absenceTeacherId}
                    >
                      {checkingAbsence ? "Checking..." : "Simulate Absence"}
                    </Button>
                    {absenceResults && (
                      <div className="space-y-2 pt-2 border-t">
                        {absenceResults.impact.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{absenceResults.teacherName} has no classes on {absenceResults.day}.</p>
                        ) : (
                          absenceResults.impact.map((imp, i) => (
                            <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-sm">
                              <p className="font-semibold text-amber-800">{imp.className}-{imp.section}, {imp.period} ({imp.subject})</p>
                              <p className="text-xs text-amber-700 mt-1">
                                Free to substitute: {imp.candidateSubstitutes.length > 0 ? imp.candidateSubstitutes.join(", ") : "No one free — reschedule needed"}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Timetables list */}
            <Card className="border-2 border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />All Timetables
                    <Badge className="bg-blue-100 text-blue-700 ml-1">{timetables.length}</Badge>
                  </CardTitle>
                  <Button variant="ghost" size="icon" onClick={fetchTimetables} className="h-7 w-7">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {/* Class timetables */}
                {classTimetables.length > 0 && (
                  <>
                    <p className="px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50">CLASS TIMETABLES</p>
                    <div className="divide-y divide-slate-100">
                      {classTimetables.map(tt => (
                        <div key={tt.id}
                          className={`flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors
                            ${viewingLabel === `Class ${tt.class_grade} - Section ${tt.section}` ? "bg-blue-50 border-l-4 border-l-blue-500" : ""}`}
                          onClick={() => loadAndParseFile(tt.file_path, `Class ${tt.class_grade} - Section ${tt.section}`)}>
                          <div>
                            <p className="text-sm font-semibold text-slate-700">Class {tt.class_grade} · Section {tt.section}</p>
                            <p className="text-xs text-slate-400">{tt.file_name}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); loadAndParseFile(tt.file_path, `Class ${tt.class_grade} - Section ${tt.section}`); }}>
                              <Eye className="h-3.5 w-3.5 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); handleDelete(tt); }}>
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Teacher timetables */}
                {teacherTimetables.length > 0 && (
                  <>
                    <p className="px-4 py-2 text-xs font-semibold text-green-600 bg-green-50">TEACHER TIMETABLES</p>
                    <div className="divide-y divide-slate-100">
                      {teacherTimetables.map(tt => (
                        <div key={tt.id}
                          className={`flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors
                            ${viewingLabel.includes(tt.teacher_name ?? "") ? "bg-green-50 border-l-4 border-l-green-500" : ""}`}
                          onClick={() => loadAndParseFile(tt.file_path, `${tt.teacher_name ?? "Teacher"}'s Timetable`)}>
                          <div>
                            <p className="text-sm font-semibold text-slate-700">{tt.teacher_name ?? "Unknown"}</p>
                            <p className="text-xs text-slate-400">{tt.file_name}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); loadAndParseFile(tt.file_path, `${tt.teacher_name ?? "Teacher"}'s Timetable`); }}>
                              <Eye className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); handleDelete(tt); }}>
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {timetables.length === 0 && (
                  <p className="p-4 text-center text-sm text-slate-400">No timetables uploaded yet</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Viewer */}
          <div className="lg:col-span-3">
            <Card className="border-2 border-slate-200 min-h-[500px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-blue-600" />
                  {viewingLabel || "Timetable Viewer"}
                </CardTitle>
                <CardDescription>
                  {viewingLabel ? "Timetable preview" : "Select a timetable from the list to preview"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingView ? (
                  <div className="flex items-center justify-center py-20"><LoadingSpinner size="lg" /></div>
                ) : viewingTimetable ? renderTimetable() : (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <CalendarDays className="h-16 w-16 text-slate-200 mb-4" />
                    <p className="text-slate-400 font-medium">No timetable selected</p>
                    <p className="text-slate-300 text-sm mt-1">Upload or click a timetable to preview</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default TimetablePage;