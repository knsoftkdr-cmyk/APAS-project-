import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, MoreHorizontal, Plus, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import ERPLayout from "@/components/erp/ERPLayout";

type FeeRecord = {
  id: string;
  student_id: string | null;
  student_name: string;
  class_grade: string | null;
  section: string | null;
  amount_due: number;
  amount_paid: number;
  course_amount: number;
  transport_amount: number;
  other_amount: number;
  uniform_amount: number;
  material_amount: number;
  exam_amount: number;
  due_date: string | null;
  status: string;
  created_at?: string;
};

type Student = {
  id: string;
  full_name: string;
  class: string | null;
  section: string | null;
  roll_number: string | null;
  parent_phone: string | null;
};

const emptyForm = {
  amount_paid: "",
  due_date: "",
  course_amount: "0",
  transport_amount: "0",
  other_amount: "0",
  uniform_amount: "0",
  material_amount: "0",
  exam_amount: "0",
};

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

const num = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

const ERPFeeManagement = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [schoolId, setSchoolId] = useState<string>("");
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  // Cascading Class -> Section -> Student pickers (Add dialog)
  const [pickedClass, setPickedClass] = useState("");
  const [pickedSection, setPickedSection] = useState("");
  const [pickedStudentId, setPickedStudentId] = useState("");

  // Student details modal (opened by clicking a row)
  const [detailsStudentId, setDetailsStudentId] = useState<string | null>(null);

  const loadFees = async (sid: string) => {
    const { data, error } = await supabase
      .from("fee_payments" as any)
      .select("*")
      .eq("school_id", sid)
      .order("due_date", { ascending: true });

    if (!error && data) {
      setFees(data as unknown as FeeRecord[]);
    }
  };

  const loadStudents = async (sid: string) => {
    const { data, error } = await supabase
      .from("students" as any)
      .select("id, full_name, class, section, roll_number, parent_phone")
      .eq("school_id", sid)
      .order("full_name", { ascending: true });

    if (!error && data) {
      setStudents(data as unknown as Student[]);
    }
  };

  const classOptions = useMemo(() => {
    return Array.from(new Set(students.map((s) => s.class).filter(Boolean) as string[])).sort();
  }, [students]);

  const sectionOptions = useMemo(() => {
    if (!pickedClass) return [];
    return Array.from(
      new Set(
        students
          .filter((s) => s.class === pickedClass)
          .map((s) => s.section)
          .filter(Boolean) as string[]
      )
    ).sort();
  }, [students, pickedClass]);

  const studentOptions = useMemo(() => {
    if (!pickedClass || !pickedSection) return [];
    return students
      .filter((s) => s.class === pickedClass && s.section === pickedSection)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [students, pickedClass, pickedSection]);

  const pickedStudentObj = useMemo(
    () => students.find((s) => s.id === pickedStudentId) || null,
    [students, pickedStudentId]
  );

  const selectedStudentDues = useMemo(() => {
    if (!pickedStudentId) return null;
    return fees.find((f) => f.student_id === pickedStudentId) || null;
  }, [fees, pickedStudentId]);

  // Everything for the student shown in the details modal
  const detailsStudent = useMemo(
    () => students.find((s) => s.id === detailsStudentId) || null,
    [students, detailsStudentId]
  );

  const detailsFees = useMemo(() => {
    if (!detailsStudentId) return [];
    return fees
      .filter((f) => f.student_id === detailsStudentId)
      .sort((a, b) => {
        const ad = a.due_date ? new Date(a.due_date).getTime() : 0;
        const bd = b.due_date ? new Date(b.due_date).getTime() : 0;
        return bd - ad;
      });
  }, [fees, detailsStudentId]);

  const detailsTotals = useMemo(() => {
    return detailsFees.reduce(
      (acc, f) => {
        acc.due += f.amount_due;
        acc.paid += f.amount_paid;
        return acc;
      },
      { due: 0, paid: 0 }
    );
  }, [detailsFees]);

  // Sum of the breakdown fields, kept in sync with amount due as the admin types
  const breakdownTotal = useMemo(() => {
    return (
      num(form.course_amount) +
      num(form.transport_amount) +
      num(form.other_amount) +
      num(form.uniform_amount) +
      num(form.material_amount) +
      num(form.exam_amount)
    );
  }, [form]);

  const resetAddModal = () => {
    setForm(emptyForm);
    setPickedClass("");
    setPickedSection("");
    setPickedStudentId("");
  };

  useEffect(() => {
    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate("/login");
        return;
      }

      const { data: profileData, error } = await supabase
        .from("profiles")
        .select("erp_access, school_id, schools(name)")
        .eq("id", sessionData.session.user.id)
        .single();

      if (error || !profileData || profileData.erp_access !== true) {
        navigate("/dashboard");
        return;
      }

      const sid = (profileData as any).school_id as string;
      const school = (profileData as any).schools;
      setSchoolId(sid);
      setOrgName(school?.name ?? "Your Organization");

      await Promise.all([loadFees(sid), loadStudents(sid)]);
      setLoading(false);
    };

    init();
  }, [navigate]);

  const deriveStatus = (due: number, paid: number, dueDate: string | null) => {
    if (paid >= due) return "paid";
    if (dueDate && new Date(dueDate) < new Date()) return "overdue";
    return "pending";
  };

  const handleAddFee = async () => {
    if (!pickedStudentObj) {
      toast({ title: "Please select a student", variant: "destructive" });
      return;
    }

    const courseAmount = num(form.course_amount);
    const transportAmount = num(form.transport_amount);
    const otherAmount = num(form.other_amount);
    const uniformAmount = num(form.uniform_amount);
    const materialAmount = num(form.material_amount);
    const examAmount = num(form.exam_amount);
    const amountDue =
      courseAmount + transportAmount + otherAmount + uniformAmount + materialAmount + examAmount;
    const amountPaid = num(form.amount_paid);

    if (amountDue <= 0) {
      toast({ title: "Enter at least one fee particular amount", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { data: sessionData } = await supabase.auth.getSession();

    const { error } = await supabase.from("fee_payments" as any).insert({
      school_id: schoolId,
      student_id: pickedStudentObj.id,
      student_name: pickedStudentObj.full_name,
      class_grade: pickedStudentObj.class,
      section: pickedStudentObj.section,
      amount_due: amountDue,
      amount_paid: amountPaid,
      course_amount: courseAmount,
      transport_amount: transportAmount,
      other_amount: otherAmount,
      uniform_amount: uniformAmount,
      material_amount: materialAmount,
      exam_amount: examAmount,
      due_date: form.due_date || null,
      status: deriveStatus(amountDue, amountPaid, form.due_date || null),
      created_by: sessionData.session?.user.id,
    });

    setSaving(false);

    if (error) {
      toast({ title: "Couldn't add fee record", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Fee record added" });
    resetAddModal();
    setAddOpen(false);
    await loadFees(schoolId);
  };

  const statusBadgeClasses = (status: string) => {
    if (status === "paid") return "bg-emerald-50 text-emerald-700";
    if (status === "overdue") return "bg-red-50 text-red-700";
    return "bg-amber-50 text-amber-700";
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Loading your workspace...</p>
      </div>
    );
  }

  return (
    <ERPLayout orgName={orgName} activePath="/erp/fees" tabLabel="Fee Records">
      {/* Section header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1 text-lg font-bold text-slate-900">
          Fee Records
          <ChevronDown className="h-5 w-5 text-slate-400" />
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setAddOpen(true)}
            className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white rounded-full px-5"
          >
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
          <Button variant="outline" size="icon" className="rounded-lg">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {fees.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="max-w-md text-center">
            <div className="h-40 w-40 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-50 to-emerald-50 flex items-center justify-center">
              <Wallet className="h-16 w-16 text-blue-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Set up fee tracking</h2>
            <p className="text-slate-500 text-sm mb-6">
              Record student fee amounts, due dates and payments so you can track collections
              for your school in one place.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button
                onClick={() => setAddOpen(true)}
                className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white rounded-full px-6"
              >
                Add Fee Record
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Amount Due</TableHead>
                <TableHead>Amount Paid</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fees.map((fee) => (
                <TableRow
                  key={fee.id}
                  onClick={() => fee.student_id && setDetailsStudentId(fee.student_id)}
                  className={fee.student_id ? "cursor-pointer hover:bg-slate-50" : ""}
                >
                  <TableCell className="font-medium text-slate-900">{fee.student_name}</TableCell>
                  <TableCell className="text-slate-600">{fee.class_grade || "—"}</TableCell>
                  <TableCell className="text-slate-600">{fee.section || "—"}</TableCell>
                  <TableCell className="text-slate-600">₹{fee.amount_due.toLocaleString()}</TableCell>
                  <TableCell className="text-slate-600">₹{fee.amount_paid.toLocaleString()}</TableCell>
                  <TableCell className="text-slate-600">
                    {fee.due_date ? new Date(fee.due_date).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClasses(fee.status)}`}
                    >
                      {fee.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Fee dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAddModal();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Fee Record</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select
                value={pickedClass}
                onValueChange={(val) => {
                  setPickedClass(val);
                  setPickedSection("");
                  setPickedStudentId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-slate-400">No classes yet</div>
                  ) : (
                    classOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Section</Label>
              <Select
                value={pickedSection}
                onValueChange={(val) => {
                  setPickedSection(val);
                  setPickedStudentId("");
                }}
                disabled={!pickedClass}
              >
                <SelectTrigger>
                  <SelectValue placeholder={pickedClass ? "Select section" : "Select a class first"} />
                </SelectTrigger>
                <SelectContent>
                  {sectionOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-slate-400">No sections yet</div>
                  ) : (
                    sectionOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Student</Label>
              <Select value={pickedStudentId} onValueChange={setPickedStudentId} disabled={!pickedSection}>
                <SelectTrigger>
                  <SelectValue placeholder={pickedSection ? "Select student" : "Select a section first"} />
                </SelectTrigger>
                <SelectContent>
                  {studentOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-slate-400">No students yet</div>
                  ) : (
                    studentOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {selectedStudentDues && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
                <p className="font-medium text-slate-900">
                  Existing dues for {selectedStudentDues.student_name}
                </p>
                <p className="text-slate-600">
                  Due ₹{selectedStudentDues.amount_due.toLocaleString()} · Paid ₹
                  {selectedStudentDues.amount_paid.toLocaleString()} · Balance ₹
                  {(selectedStudentDues.amount_due - selectedStudentDues.amount_paid).toLocaleString()}
                </p>
                <p className="capitalize text-slate-500">Status: {selectedStudentDues.status}</p>
              </div>
            )}

            <div>
              <Label className="mb-2 block">Fee Particulars</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="course_amount" className="text-xs text-slate-500 font-normal">
                    Course Amount
                  </Label>
                  <Input
                    id="course_amount"
                    type="number"
                    value={form.course_amount}
                    onChange={(e) => setForm({ ...form, course_amount: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="transport_amount" className="text-xs text-slate-500 font-normal">
                    Transport Amount
                  </Label>
                  <Input
                    id="transport_amount"
                    type="number"
                    value={form.transport_amount}
                    onChange={(e) => setForm({ ...form, transport_amount: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="uniform_amount" className="text-xs text-slate-500 font-normal">
                    Uniform Amount
                  </Label>
                  <Input
                    id="uniform_amount"
                    type="number"
                    value={form.uniform_amount}
                    onChange={(e) => setForm({ ...form, uniform_amount: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="material_amount" className="text-xs text-slate-500 font-normal">
                    Material Amount
                  </Label>
                  <Input
                    id="material_amount"
                    type="number"
                    value={form.material_amount}
                    onChange={(e) => setForm({ ...form, material_amount: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exam_amount" className="text-xs text-slate-500 font-normal">
                    Exam Amount
                  </Label>
                  <Input
                    id="exam_amount"
                    type="number"
                    value={form.exam_amount}
                    onChange={(e) => setForm({ ...form, exam_amount: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="other_amount" className="text-xs text-slate-500 font-normal">
                    Other Amount
                  </Label>
                  <Input
                    id="other_amount"
                    type="number"
                    value={form.other_amount}
                    onChange={(e) => setForm({ ...form, other_amount: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Amount due (total)</Label>
                <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                  ₹{breakdownTotal.toLocaleString()}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount_paid">Amount paid</Label>
                <Input
                  id="amount_paid"
                  type="number"
                  value={form.amount_paid}
                  onChange={(e) => setForm({ ...form, amount_paid: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due_date">Due date</Label>
              <Input
                id="due_date"
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddFee}
              disabled={saving}
              className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white"
            >
              {saving ? "Saving..." : "Add Fee Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Student details dialog — opened by clicking a row */}
      <Dialog open={!!detailsStudentId} onOpenChange={(open) => !open && setDetailsStudentId(null)}>
        <DialogContent className="sm:max-w-lg">
          {detailsStudent && (
            <>
              <DialogHeader>
                <DialogTitle className="sr-only">{detailsStudent.full_name} — fee details</DialogTitle>
              </DialogHeader>

              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-gradient-to-br from-blue-600 to-emerald-500 text-white font-semibold">
                    {initials(detailsStudent.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-lg font-bold text-slate-900">{detailsStudent.full_name}</p>
                  <p className="text-sm text-slate-500">
                    {detailsStudent.class ? `Class ${detailsStudent.class}` : "—"}
                    {detailsStudent.section ? ` · Section ${detailsStudent.section}` : ""}
                    {detailsStudent.roll_number ? ` · Roll No. ${detailsStudent.roll_number}` : ""}
                  </p>
                  {detailsStudent.parent_phone && (
                    <p className="text-xs text-slate-400 mt-0.5">Parent contact: {detailsStudent.parent_phone}</p>
                  )}
                </div>
              </div>

              <Separator className="my-4" />

              {/* Totals summary */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-lg bg-slate-50 p-3 text-center">
                  <p className="text-xs text-slate-500">Total Due</p>
                  <p className="text-base font-bold text-slate-900">₹{detailsTotals.due.toLocaleString()}</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 text-center">
                  <p className="text-xs text-emerald-600">Total Paid</p>
                  <p className="text-base font-bold text-emerald-700">₹{detailsTotals.paid.toLocaleString()}</p>
                </div>
                <div className="rounded-lg bg-red-50 p-3 text-center">
                  <p className="text-xs text-red-600">Balance</p>
                  <p className="text-base font-bold text-red-700">
                    ₹{Math.max(detailsTotals.due - detailsTotals.paid, 0).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Per-record breakdown */}
              <p className="text-sm font-semibold text-slate-700 mb-2">Fee Records</p>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {detailsFees.length === 0 ? (
                  <p className="text-sm text-slate-400">No fee records yet.</p>
                ) : (
                  detailsFees.map((f) => (
                    <div
                      key={f.id}
                      className="rounded-lg border border-slate-200 p-3 text-sm space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-slate-900 font-medium">
                            Due {f.due_date ? new Date(f.due_date).toLocaleDateString() : "—"}
                          </p>
                          <p className="text-slate-500 text-xs">
                            ₹{f.amount_due.toLocaleString()} due · ₹{f.amount_paid.toLocaleString()} paid
                          </p>
                        </div>
                        <Badge variant="secondary" className={`capitalize ${statusBadgeClasses(f.status)}`}>
                          {f.status}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-2">
                        <span>Course ₹{(f.course_amount ?? 0).toLocaleString()}</span>
                        <span>Transport ₹{(f.transport_amount ?? 0).toLocaleString()}</span>
                        <span>Uniform ₹{(f.uniform_amount ?? 0).toLocaleString()}</span>
                        <span>Material ₹{(f.material_amount ?? 0).toLocaleString()}</span>
                        <span>Exam ₹{(f.exam_amount ?? 0).toLocaleString()}</span>
                        <span>Other ₹{(f.other_amount ?? 0).toLocaleString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setDetailsStudentId(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
};

export default ERPFeeManagement;
