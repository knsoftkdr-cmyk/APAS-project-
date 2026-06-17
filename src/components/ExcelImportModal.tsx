import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Download, Users, Pencil, Plus, Edit2, Save } from "lucide-react";
import * as XLSX from "xlsx";

interface ExcelImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

interface ParsedRow {
  rowNum: number;
  student_name: string;
  class: string;
  section: string;
  date_of_birth: string;
  student_id: string;
  parent_phone: string;
  teacher_name: string;
}

interface ValidationResult {
  row: ParsedRow;
  errors: string[];
  warnings: string[];
}

interface CreatedClass {
  classKey: string;
  className: string;
  section: string;
  classId: string;
  studentCount: number;
  teacherId: string;
  teacherRole: string;
  teacherSubject: string;
  isEditing: boolean;
}

type Step = "upload" | "preview" | "importing" | "class-setup" | "done";

export function ExcelImportModal({ open, onOpenChange, onImportComplete }: ExcelImportModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const classStudentMapRef = useRef<Map<string, { studentIds: string[]; teacherName: string }>>(new Map());
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [validations, setValidations] = useState<ValidationResult[]>([]);
  const [availableTeachers, setAvailableTeachers] = useState<{ id: string; full_name: string | null }[]>([]);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [createdClasses, setCreatedClasses] = useState<CreatedClass[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [savingClasses, setSavingClasses] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const reset = () => {
    setStep("upload");
    setParsed([]);
    setValidations([]);
    setEditingRow(null);
    setCreatedClasses([]);
    setImportedCount(0);
    setImportErrors([]);
    classStudentMapRef.current = new Map();
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = (val: boolean) => {
    if (!val) reset();
    onOpenChange(val);
  };

  useEffect(() => {
    if (open) {
      supabase.from("profiles").select("id, full_name").eq("role", "teacher").then(({ data }) => {
        if (data) setAvailableTeachers(data);
      });
    }
  }, [open]);

  const revalidate = (rows: ParsedRow[]) => {
    const results: ValidationResult[] = rows.map((row) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!row.student_name) errors.push("Student name is required");
      if (!row.class) errors.push("Class is required");
      if (!row.section) errors.push("Section is required");
      if (!row.student_id) warnings.push("Student ID missing");
      if (!row.date_of_birth) warnings.push("Date of birth missing");
      if (row.parent_phone && !/^\+?[\d\s-]{7,15}$/.test(row.parent_phone))
        errors.push("Invalid phone format");
      return { row, errors, warnings };
    });

    const idMap = new Map<string, number[]>();
    rows.forEach((r) => {
      if (r.student_id) {
        const key = `${r.class}-${r.section}-${r.student_id}`;
        idMap.set(key, [...(idMap.get(key) || []), r.rowNum]);
      }
    });
    idMap.forEach((rowNums) => {
      if (rowNums.length > 1) {
        rowNums.forEach((rn) => {
          const v = results.find((vr) => vr.row.rowNum === rn);
          if (v) v.errors.push("Duplicate Student ID in file");
        });
      }
    });

    setValidations(results);
  };

  const parseDOB = (val: any): string => {
    if (val === null || val === undefined || val === "") return "";
    // Excel date serial number (cellDates:false default) -> JS Date via XLSX helper
    if (typeof val === "number") {
      const d = XLSX.SSF.parse_date_code(val);
      if (d) {
        const yyyy = String(d.y).padStart(4, "0");
        const mm = String(d.m).padStart(2, "0");
        const dd = String(d.d).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
    }
    if (val instanceof Date) {
      const yyyy = String(val.getFullYear()).padStart(4, "0");
      const mm = String(val.getMonth() + 1).padStart(2, "0");
      const dd = String(val.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
    const s = String(val).trim();
    const normalized = s.replace(/\./g, "/");
    // Prefer DD/MM/YYYY or DD-MM-YYYY for manual / Excel text entries
    const m = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = (parseInt(y) > 50 ? "19" : "20") + y;
      return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    // Try YYYY-MM-DD passthrough
    if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) return normalized.slice(0, 10);
    // ISO parse fallback
    const dt = new Date(normalized);
    if (!isNaN(dt.getTime())) {
      const yyyy = String(dt.getFullYear()).padStart(4, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
    return normalized;
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "", raw: true });

      const rows: ParsedRow[] = json.map((r, i) => ({
        rowNum: i + 2,
        student_name: String(r["Student Name"] || r["student_name"] || r["name"] || "").trim(),
        class: String(r["Class"] || r["class"] || r["grade"] || "").trim(),
        section: String(r["section"] || r["Section"] || "A").trim().toUpperCase(),
        date_of_birth: parseDOB(r["Date OF birth"] ?? r["Date Of Birth"] ?? r["date_of_birth"] ?? r["DOB"] ?? ""),
        student_id: String(r["Student ID"] || r["student_id"] || r["roll_number"] || r["Roll Number"] || "").trim(),
        parent_phone: String(r["Parent Phone Number"] || r["parent_phone"] || r["Parent Phone"] || r["phone"] || "").trim(),
        teacher_name: String(r["Teacher Name"] || r["teacher_name"] || r["Teacher"] || "").trim(),
      }));

      setParsed(rows);
      revalidate(rows);
      setStep("preview");
    };
    reader.readAsArrayBuffer(file);
  };

  const updateRow = (rowNum: number, field: keyof ParsedRow, value: string) => {
    const normalizedValue = field === "section" ? value.toUpperCase() : value;
    const updated = parsed.map((r) => r.rowNum === rowNum ? { ...r, [field]: normalizedValue } : r);
    setParsed(updated);
    revalidate(updated);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Student Name", "Class", "section", "Date OF birth", "Student ID", "Parent Phone Number", "Teacher Name"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "student_import_template_v2.xlsx");
  };

  // Step 3: Import students via edge function (bypasses RLS), then move to class setup
  const handleImport = async () => {
    setStep("importing");
    const errors: string[] = [];
    let imported = 0;

    const validRows = validations.filter((v) => v.errors.length === 0);

    // Track which students belong to which class-section
    const classStudentMap = new Map<string, { studentIds: string[]; teacherName: string }>();

    const importRows = validRows.map((v) => ({
      rowNum: v.row.rowNum,
      student_name: v.row.student_name,
      class: v.row.class,
      section: v.row.section,
      roll_number: v.row.student_id,
      parent_phone: v.row.parent_phone,
      parent_email: "",
      teacher_name: v.row.teacher_name,
      date_of_birth: v.row.date_of_birth,
    }));

    // Import every valid row so existing students also get their DOB/login credentials synced
    if (importRows.length > 0) {
      const { data, error } = await supabase.functions.invoke("create-students-batch", {
        body: { students: importRows, mode: "import" },
      });

      if (error) {
        errors.push(`Batch import error: ${error.message}`);
      } else if (data?.results) {
        for (const r of data.results) {
          if (r.success) {
            imported++;
            const row = importRows.find((s) => s.rowNum === r.rowNum);
            if (row) {
              const classKey = `${row.class} - ${row.section}`;
              if (!classStudentMap.has(classKey)) {
                classStudentMap.set(classKey, { studentIds: [], teacherName: row.teacher_name });
              }
              classStudentMap.get(classKey)!.studentIds.push(r.studentId);
            }
          } else {
            errors.push(`Row ${r.rowNum}: ${r.error}`);
          }
        }
      }
    }

    // Build class setup list
    const classSetup: CreatedClass[] = [];
    for (const [classKey, info] of classStudentMap) {
      const [className, section] = classKey.split(" - ");
      const matchedTeacher = availableTeachers.find(
        (t) => t.full_name?.toLowerCase() === info.teacherName?.toLowerCase()
      );
      classSetup.push({
        classKey,
        className: className.trim(),
        section: section.trim(),
        classId: "",
        studentCount: info.studentIds.length,
        teacherId: matchedTeacher?.id || "",
        teacherRole: "subject",
        teacherSubject: "",
        isEditing: false,
      });
    }

    setImportedCount(imported);
    setImportErrors(errors);
    setCreatedClasses(classSetup);

    classStudentMapRef.current = classStudentMap;

    setStep("class-setup");
  };

  const updateClassSetup = (idx: number, field: keyof CreatedClass, value: string | boolean) => {
    setCreatedClasses((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const handleCreateClasses = async () => {
    setSavingClasses(true);
    const classStudentMap = classStudentMapRef.current;
    const classErrors: string[] = [];

    // Get existing classes
    const { data: existingClasses, error: existingClassesError } = await supabase.from("classes").select("id, name, section");
    if (existingClassesError) {
      setImportErrors((prev) => [...prev, existingClassesError.message]);
      toast({ title: "Unable to load classes", description: existingClassesError.message, variant: "destructive" });
      setSavingClasses(false);
      return;
    }

    const existingMap = new Map<string, string>();
    existingClasses?.forEach((c) => existingMap.set(`${c.name} - ${c.section}`, c.id));

    const { data: existingClassStudents, error: existingClassStudentsError } = await supabase.from("class_students").select("student_id, class_id");
    if (existingClassStudentsError) {
      setImportErrors((prev) => [...prev, existingClassStudentsError.message]);
      toast({ title: "Unable to load class members", description: existingClassStudentsError.message, variant: "destructive" });
      setSavingClasses(false);
      return;
    }

    for (const cls of createdClasses) {
      const key = `${cls.className} - ${cls.section}`;
      let classId = existingMap.get(key);
      let classFailed = false;

      if (cls.teacherRole === "subject" && !cls.teacherSubject) {
        classErrors.push(`Class "${key}": subject is required for subject teachers`);
        classFailed = true;
      }

      // Create class if not exists
      if (!classId && !classFailed) {
        const { data, error } = await supabase
          .from("classes")
          .insert({ name: cls.className, section: cls.section, created_by: user?.id })
          .select("id").single();
        if (error) {
          classErrors.push(`Class "${key}": ${error.message}`);
          continue;
        }
        classId = data.id;
        existingMap.set(key, classId);
      }

      // Assign students to class
      if (!classId || classFailed) continue;

      const studentIds = classStudentMap.get(cls.classKey)?.studentIds || [];
      for (const sid of studentIds) {
        const alreadyAssigned = existingClassStudents?.some(
          (cs) => cs.student_id === sid && cs.class_id === classId
        );
        if (alreadyAssigned) continue;
        const { error } = await supabase.from("class_students").insert({
          class_id: classId, student_id: sid, assigned_by: user?.id,
        });
        if (error) {
          classErrors.push(`Class "${key}": ${error.message}`);
          classFailed = true;
          break;
        }
      }

      // Assign teacher if selected
      if (cls.teacherId && !classFailed) {
        const { data: existingCT } = await supabase
          .from("class_teachers")
          .select("id, teacher_id, teacher_role")
          .eq("class_id", classId);

        const sameTeacherAssigned = existingCT?.some((ct) => ct.teacher_id === cls.teacherId);
        const primaryAlreadyExists = existingCT?.some((ct) => ct.teacher_role === "primary");

        if (!sameTeacherAssigned) {
          // If a primary teacher already exists and we're trying to add another primary, switch to subject role
          const effectiveRole =
            cls.teacherRole === "primary" && primaryAlreadyExists ? "subject" : cls.teacherRole;

          if (effectiveRole === "subject" && !cls.teacherSubject) {
            classErrors.push(
              `Class "${key}": a primary teacher already exists. Set role to "Subject" and provide a subject to add this teacher.`
            );
          } else {
            const { error } = await supabase.from("class_teachers").insert({
              class_id: classId,
              teacher_id: cls.teacherId,
              teacher_role: effectiveRole,
              subject: effectiveRole === "subject" ? cls.teacherSubject : null,
              assigned_by: user?.id,
            });
            if (error) {
              classErrors.push(`Class "${key}": ${error.message}`);
            }
          }
        }
      }
    }

    setSavingClasses(false);
    setImportErrors((prev) => [...prev, ...classErrors]);

    if (classErrors.length > 0) {
      toast({
        title: "Some classes need attention",
        description: "The import stayed open so you can review the class setup errors.",
        variant: "destructive",
      });
      return;
    }

    classStudentMapRef.current = new Map();
    setStep("done");
    onImportComplete();
  };

  const errorCount = validations.filter((v) => v.errors.length > 0).length;
  const validCount = validations.filter((v) => v.errors.length === 0).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-5xl max-h-[85vh] flex flex-col"
        onInteractOutside={(event) => {
          if (step !== "done") event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (step !== "done") event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import Students from Excel
          </DialogTitle>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          {[
            { key: "upload", label: "1. Upload" },
            { key: "preview", label: "2. Preview" },
            { key: "importing", label: "3. Import" },
            { key: "class-setup", label: "4. Create Classes" },
            { key: "done", label: "5. Done" },
          ].map((s, i) => (
            <span key={s.key} className={`flex items-center gap-1 ${step === s.key ? "text-primary font-semibold" : ""}`}>
              {i > 0 && <span className="text-border">→</span>}
              {s.label}
            </span>
          ))}
        </div>

        {/* STEP 1: Upload */}
        {step === "upload" && (
          <div className="space-y-6 py-4">
            <div className="border-2 border-dashed border-border rounded-xl p-10 text-center space-y-4">
              <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <p className="text-foreground font-medium">Upload Excel File (.xlsx, .xls)</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Columns: Student Name, Class, section, Date OF birth, Student ID, Parent Phone Number, Teacher Name
                </p>
              </div>
              <div className="flex gap-3 justify-center">
                <Button onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" /> Choose File
                </Button>
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 mr-2" /> Download Template
                </Button>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            </div>

            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <h4 className="text-sm font-semibold text-foreground">How It Works</h4>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li><strong>Download the template</strong> and fill in student details</li>
                <li>Upload the filled file — preview &amp; <strong>edit any field</strong> before importing</li>
                <li>After importing students, you'll be asked to <strong>create classes</strong> and assign teachers</li>
                <li>Class names and teacher assignments are <strong>fully editable</strong></li>
              </ul>
            </div>
          </div>
        )}

        {/* STEP 2: Preview */}
        {step === "preview" && (
          <div className="flex-1 flex flex-col space-y-4 min-h-0">
            <div className="flex gap-3 flex-wrap items-center">
              <Badge variant="secondary" className="gap-1">Total: {parsed.length} rows</Badge>
              <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Valid: {validCount}
              </Badge>
              {errorCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" /> Errors: {errorCount}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                <Pencil className="h-3 w-3" /> Click any row to edit
              </span>
            </div>

            <ScrollArea className="flex-1 border rounded-lg max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Student Name</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead>Student ID</TableHead>
                    <TableHead>DOB</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Teacher</TableHead>
                    <TableHead className="w-16">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validations.map((v) => {
                    const isEditing = editingRow === v.row.rowNum;
                    return (
                      <TableRow
                        key={v.row.rowNum}
                        className={`cursor-pointer ${v.errors.length > 0 ? "bg-destructive/5" : ""} ${isEditing ? "bg-accent/50" : "hover:bg-muted/50"}`}
                        onClick={() => setEditingRow(isEditing ? null : v.row.rowNum)}
                      >
                        <TableCell className="text-muted-foreground text-xs">{v.row.rowNum}</TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input value={v.row.student_name} onClick={(e) => e.stopPropagation()} onChange={(e) => updateRow(v.row.rowNum, "student_name", e.target.value)} className="h-7 text-xs" />
                          ) : (
                            <span className="font-medium text-sm">{v.row.student_name || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input value={v.row.class} onClick={(e) => e.stopPropagation()} onChange={(e) => updateRow(v.row.rowNum, "class", e.target.value)} className="h-7 text-xs w-24" />
                          ) : (
                            <span className="text-sm">{v.row.class || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input value={v.row.section} onClick={(e) => e.stopPropagation()} onChange={(e) => updateRow(v.row.rowNum, "section", e.target.value)} className="h-7 text-xs w-16" />
                          ) : (
                            <span className="text-sm">{v.row.section || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input value={v.row.student_id} onClick={(e) => e.stopPropagation()} onChange={(e) => updateRow(v.row.rowNum, "student_id", e.target.value)} className="h-7 text-xs w-20" />
                          ) : (
                            <span className="text-sm">{v.row.student_id || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input value={v.row.date_of_birth} onClick={(e) => e.stopPropagation()} onChange={(e) => updateRow(v.row.rowNum, "date_of_birth", e.target.value)} className="h-7 text-xs w-28" placeholder="YYYY-MM-DD" />
                          ) : (
                            <span className="text-xs text-muted-foreground">{v.row.date_of_birth || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input value={v.row.parent_phone} onClick={(e) => e.stopPropagation()} onChange={(e) => updateRow(v.row.rowNum, "parent_phone", e.target.value)} className="h-7 text-xs w-32" />
                          ) : (
                            <span className="text-xs text-muted-foreground">{v.row.parent_phone || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Select
                              value={v.row.teacher_name || "__none__"}
                              onValueChange={(val) => updateRow(v.row.rowNum, "teacher_name", val === "__none__" ? "" : val)}
                            >
                              <SelectTrigger className="h-7 text-xs w-32" onClick={(e) => e.stopPropagation()}>
                                <SelectValue placeholder="Select teacher" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">No teacher</SelectItem>
                                {availableTeachers.map((t) => (
                                  <SelectItem key={t.id} value={t.full_name || t.id}>{t.full_name || "Unnamed"}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs">{v.row.teacher_name || <span className="text-muted-foreground italic">—</span>}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {v.errors.length > 0 ? (
                            <XCircle className="h-4 w-4 text-destructive" />
                          ) : v.warnings.length > 0 ? (
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={handleImport} disabled={validCount === 0}>
                Import {validCount} Students
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Importing */}
        {step === "importing" && (
          <div className="py-12 text-center space-y-4">
            <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full mx-auto" />
            <p className="text-foreground font-medium">Importing students...</p>
            <p className="text-sm text-muted-foreground">Creating student profiles and records</p>
          </div>
        )}

        {/* STEP 4: Class Setup */}
        {step === "class-setup" && (
          <div className="flex-1 flex flex-col space-y-4 min-h-0">
            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
              <p className="text-sm text-emerald-800 dark:text-emerald-200 font-medium flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {importedCount} student(s) imported successfully!
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                Now create classes and assign teachers. You can edit class names, sections, and teacher assignments below.
              </p>
            </div>

            {importErrors.length > 0 && (
              <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                <p className="text-xs text-destructive font-medium mb-1">Import Warnings:</p>
                {importErrors.slice(0, 5).map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{e}</p>
                ))}
                {importErrors.length > 5 && (
                  <p className="text-xs text-muted-foreground">...and {importErrors.length - 5} more</p>
                )}
              </div>
            )}

            <ScrollArea className="flex-1 max-h-[400px]">
              <div className="space-y-3">
                {createdClasses.map((cls, idx) => (
                  <div key={idx} className="border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="gap-1">
                          <Users className="h-3 w-3" /> {cls.studentCount} students
                        </Badge>
                        {!cls.isEditing && (
                          <span className="font-semibold text-sm text-foreground">
                            {cls.className} - {cls.section}
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateClassSetup(idx, "isEditing", !cls.isEditing)}
                      >
                        {cls.isEditing ? <Save className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
                        <span className="ml-1 text-xs">{cls.isEditing ? "Save" : "Edit"}</span>
                      </Button>
                    </div>

                    {cls.isEditing && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Class Name</Label>
                          <Input
                            value={cls.className}
                            onChange={(e) => updateClassSetup(idx, "className", e.target.value)}
                            className="h-8 text-sm"
                            placeholder="e.g. Class 3"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Section</Label>
                          <Input
                            value={cls.section}
                            onChange={(e) => updateClassSetup(idx, "section", e.target.value)}
                            className="h-8 text-sm"
                            placeholder="e.g. A"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Assign Teacher</Label>
                        <Select value={cls.teacherId || "__none__"} onValueChange={(v) => updateClassSetup(idx, "teacherId", v === "__none__" ? "" : v)}>
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Select teacher" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No teacher</SelectItem>
                            {availableTeachers.map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.full_name || "Unnamed"}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Teacher Role</Label>
                        <Select value={cls.teacherRole} onValueChange={(v) => updateClassSetup(idx, "teacherRole", v)}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="subject">Subject</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {cls.teacherRole === "subject" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Subject</Label>
                          <Select value={cls.teacherSubject} onValueChange={(v) => updateClassSetup(idx, "teacherSubject", v)}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select subject" /></SelectTrigger>
                            <SelectContent>
                              {["Mathematics", "Science", "English", "Hindi", "Social Studies", "Computer Science"].map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => { handleClose(false); onImportComplete(); }}>
                Skip (Create Later)
              </Button>
              <Button onClick={handleCreateClasses} disabled={savingClasses || createdClasses.length === 0}>
                {savingClasses ? "Saving..." : `Save ${createdClasses.length} Class(es) & Assign`}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 5: Done */}
        {step === "done" && (
          <div className="py-10 text-center space-y-4">
            <CheckCircle2 className="h-14 w-14 mx-auto text-emerald-500" />
            <div>
              <p className="text-foreground font-semibold text-lg">Import Complete!</p>
              <p className="text-sm text-muted-foreground mt-1">
                {importedCount} students imported and {createdClasses.length} class(es) created successfully.
              </p>
            </div>
            <Button onClick={() => handleClose(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
