/**
 * TimetablePage.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Timetable feature for APAS Learning
 * 
 * Principal/Admin view:
 *  - Upload Excel timetable per class + section
 *  - View all uploaded timetables
 *  - Delete/replace timetables
 * 
 * Student view:
 *  - Auto-loads their class + section timetable
 *  - Read-only display
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * SETUP INSTRUCTIONS:
 * 1. Add to your router in App.tsx:
 *    import TimetablePage from "@/pages/TimetablePage";
 *    <Route path="/timetable" element={<TimetablePage />} />
 * 
 * 2. Add to sidebar for Principal/Admin dashboard:
 *    { label: "Timetable", icon: CalendarDays, path: "/timetable" }
 * 
 * 3. Add to sidebar for Student dashboard:
 *    { label: "Timetable", icon: CalendarDays, path: "/timetable" }
 * 
 * 4. Install SheetJS if not already:
 *    npm install xlsx
 */

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import * as XLSX from "xlsx";
import {
  CalendarDays, Upload, Trash2, Eye, FileSpreadsheet,
  BookOpen, GraduationCap, RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimetableRow {
  id: number;
  school_id: string;
  class_grade: string;
  section: string;
  file_path: string;
  file_name: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

interface ParsedTimetable {
  headers: string[];
  rows: string[][];
}

// ─── Component ───────────────────────────────────────────────────────────────

const TimetablePage = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const isPrincipal = profile?.role === "principal" || profile?.role === "admin" || profile?.role === "school_admin";
  const isStudent = profile?.role === "student";

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [timetables, setTimetables] = useState<TimetableRow[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [viewingTimetable, setViewingTimetable] = useState<ParsedTimetable | null>(null);
  const [viewingLabel, setViewingLabel] = useState("");
  const [loadingView, setLoadingView] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const schoolId = profile?.school_id;

  // ── Fetch timetables ───────────────────────────────────────────────────────
  const fetchTimetables = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("timetables")
        .select("*")
        .eq("school_id", schoolId)
        .order("class_grade", { ascending: true });
      if (error) throw error;
      setTimetables(data ?? []);
    } catch (e: any) {
      toast({ title: "Error loading timetables", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ── Auto-load student timetable ────────────────────────────────────────────
  const fetchStudentTimetable = async () => {
    if (!profile?.class_grade || !schoolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("timetables")
        .select("*")
        .eq("school_id", schoolId)
        .eq("class_grade", profile.class_grade)
        .eq("section", profile.section ?? "")
        .single();

      if (error || !data) {
        setLoading(false);
        return;
      }

      await loadAndParseFile(data.file_path, `Class ${data.class_grade} - Section ${data.section}`);
    } catch (e: any) {
      toast({ title: "Error loading timetable", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isPrincipal) fetchTimetables();
    else if (isStudent) fetchStudentTimetable();
    else setLoading(false);
  }, [profile]);

  // ── Parse Excel from storage ───────────────────────────────────────────────
  const loadAndParseFile = async (filePath: string, label: string) => {
    setLoadingView(true);
    try {
      const { data, error } = await supabase.storage
        .from("timetables")
        .download(filePath);
      if (error) throw error;

      const arrayBuffer = await data.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      if (json.length === 0) {
        toast({ title: "Empty timetable", description: "The Excel file has no data.", variant: "destructive" });
        return;
      }

      const headers = (json[0] ?? []).map(String);
      const rows = json.slice(1).map(r => r.map(String));

      setViewingTimetable({ headers, rows });
      setViewingLabel(label);
    } catch (e: any) {
      toast({ title: "Error reading file", description: e.message, variant: "destructive" });
    } finally {
      setLoadingView(false);
    }
  };

  // ── Upload timetable ───────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!file || !selectedClass.trim() || !selectedSection.trim()) {
      toast({ title: "All fields required", description: "Please select class, section and file.", variant: "destructive" });
      return;
    }
    if (!schoolId) {
      toast({ title: "No school linked", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const filePath = `${schoolId}/class_${selectedClass}_section_${selectedSection}.xlsx`;

      // Upload to storage (upsert)
      const { error: uploadError } = await supabase.storage
        .from("timetables")
        .upload(filePath, file, { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      if (uploadError) throw uploadError;

      // Upsert DB record
      const { error: dbError } = await supabase
        .from("timetables")
        .upsert({
          school_id: schoolId,
          class_grade: selectedClass.trim(),
          section: selectedSection.trim().toUpperCase(),
          file_path: filePath,
          file_name: file.name,
          uploaded_by: user?.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "school_id,class_grade,section" });
      if (dbError) throw dbError;

      toast({ title: "Timetable uploaded ✅", description: `Class ${selectedClass} - Section ${selectedSection}` });
      setFile(null);
      setSelectedClass("");
      setSelectedSection("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchTimetables();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // ── Delete timetable ───────────────────────────────────────────────────────
  const handleDelete = async (tt: TimetableRow) => {
    if (!confirm(`Delete timetable for Class ${tt.class_grade} - Section ${tt.section}?`)) return;
    try {
      await supabase.storage.from("timetables").remove([tt.file_path]);
      await supabase.from("timetables").delete().eq("id", tt.id);
      toast({ title: "Timetable deleted" });
      if (viewingLabel === `Class ${tt.class_grade} - Section ${tt.section}`) {
        setViewingTimetable(null);
        setViewingLabel("");
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

    // Day colors for Mon-Fri columns
    const dayColors = [
      "bg-blue-50 text-blue-800",
      "bg-green-50 text-green-800",
      "bg-purple-50 text-purple-800",
      "bg-orange-50 text-orange-800",
      "bg-pink-50 text-pink-800",
    ];

    return (
      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-blue-600 to-blue-500 text-white">
              {headers.map((h, i) => (
                <th key={i} className="px-4 py-3 text-left font-semibold whitespace-nowrap">
                  {h || `Column ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`px-4 py-3 border-b border-slate-100 whitespace-nowrap
                      ${ci === 0 ? "font-semibold text-slate-700 bg-slate-50" : ""}
                      ${ci > 0 && cell ? dayColors[(ci - 1) % dayColors.length] + " font-medium" : ""}
                    `}
                  >
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

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  // ── Student view ───────────────────────────────────────────────────────────
  if (isStudent) {
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
              <div>
                <h1 className="text-3xl font-bold">My Timetable</h1>
                <p className="text-blue-100 mt-1">
                  Class {profile?.class_grade ?? "—"} · Section {profile?.section ?? "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Timetable display */}
          {viewingTimetable ? (
            <Card className="border-2 border-blue-100">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-700">
                  <CalendarDays className="h-5 w-5" />
                  {viewingLabel}
                </CardTitle>
                <CardDescription>Your weekly class schedule</CardDescription>
              </CardHeader>
              <CardContent>
                {renderTimetable()}
              </CardContent>
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
  }

  // ── Principal / Admin view ─────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-500 p-8 text-white">
          <div className="absolute top-6 right-10 w-16 h-16 rounded-full border border-white/30" />
          <div className="absolute bottom-4 right-32 w-8 h-8 rounded-full border border-white/20" />
          <div className="absolute top-8 left-1/2 text-white/40 text-xl">✦</div>
          <div className="relative z-10 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
              <CalendarDays className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Timetable Manager</h1>
              <p className="text-blue-100 mt-1">Upload and manage class timetables for all sections</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload Panel */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="border-2 border-blue-100 hover:border-blue-300 transition-all">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-700">
                  <Upload className="h-5 w-5" />
                  Upload Timetable
                </CardTitle>
                <CardDescription>Upload an Excel file (.xlsx) for a class and section</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Class</Label>
                  <Input
                    placeholder="e.g. 1, 2, 3 ... 10"
                    value={selectedClass}
                    onChange={(e) => setSelectedClass(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Section</Label>
                  <Input
                    placeholder="e.g. A, B, C"
                    value={selectedSection}
                    onChange={(e) => setSelectedSection(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Excel File (.xlsx)</Label>
                  <div
                    className="border-2 border-dashed border-blue-200 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileSpreadsheet className="h-8 w-8 text-blue-400 mx-auto mb-2" />
                    {file ? (
                      <div>
                        <p className="text-sm font-medium text-blue-700">{file.name}</p>
                        <p className="text-xs text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-slate-500">Click to select Excel file</p>
                        <p className="text-xs text-slate-400 mt-1">Only .xlsx files supported</p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  onClick={handleUpload}
                  disabled={uploading}
                >
                  {uploading ? <LoadingSpinner size="sm" /> : (
                    <><Upload className="h-4 w-4 mr-2" />Upload Timetable</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Uploaded timetables list */}
            <Card className="border-2 border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <BookOpen className="h-4 w-4" />
                    Uploaded Timetables
                    <Badge className="bg-blue-100 text-blue-700 ml-1">{timetables.length}</Badge>
                  </CardTitle>
                  <Button variant="ghost" size="icon" onClick={fetchTimetables} className="h-7 w-7">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {timetables.length === 0 ? (
                  <p className="p-4 text-center text-sm text-slate-400">No timetables uploaded yet</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {timetables.map((tt) => (
                      <div
                        key={tt.id}
                        className={`flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer
                          ${viewingLabel === `Class ${tt.class_grade} - Section ${tt.section}` ? "bg-blue-50 border-l-4 border-l-blue-500" : ""}
                        `}
                        onClick={() => loadAndParseFile(tt.file_path, `Class ${tt.class_grade} - Section ${tt.section}`)}
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-700">
                            Class {tt.class_grade} · Section {tt.section}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">{tt.file_name}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-blue-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadAndParseFile(tt.file_path, `Class ${tt.class_grade} - Section ${tt.section}`);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5 text-blue-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-red-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(tt);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Timetable viewer */}
          <div className="lg:col-span-2">
            <Card className="border-2 border-slate-200 min-h-[500px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-blue-600" />
                  {viewingLabel || "Timetable Viewer"}
                </CardTitle>
                <CardDescription>
                  {viewingLabel
                    ? "Click any row to view details"
                    : "Select a timetable from the list to preview it here"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingView ? (
                  <div className="flex items-center justify-center py-20">
                    <LoadingSpinner size="lg" />
                  </div>
                ) : viewingTimetable ? (
                  renderTimetable()
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <CalendarDays className="h-16 w-16 text-slate-200 mb-4" />
                    <p className="text-slate-400 font-medium">No timetable selected</p>
                    <p className="text-slate-300 text-sm mt-1">
                      Upload a timetable or click one from the list to preview
                    </p>
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
