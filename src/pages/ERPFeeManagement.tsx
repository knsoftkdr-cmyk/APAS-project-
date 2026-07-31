import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, MoreHorizontal, Plus, Wallet, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  student_name: string;
  class_grade: string | null;
  amount_due: number;
  amount_paid: number;
  due_date: string | null;
  status: string;
};

const emptyForm = { student_name: "", class_grade: "", amount_due: "", amount_paid: "", due_date: "" };

const ERPFeeManagement = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [schoolId, setSchoolId] = useState<string>("");
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [fees, setFees] = useState<FeeRecord[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

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

      await loadFees(sid);
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
    if (!form.student_name.trim() || !form.amount_due.trim()) {
      toast({ title: "Student name and amount due are required", variant: "destructive" });
      return;
    }

    const amountDue = parseFloat(form.amount_due);
    const amountPaid = parseFloat(form.amount_paid) || 0;

    if (isNaN(amountDue)) {
      toast({ title: "Amount due must be a number", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { data: sessionData } = await supabase.auth.getSession();

    const { error } = await supabase.from("fee_payments" as any).insert({
      school_id: schoolId,
      student_name: form.student_name.trim(),
      class_grade: form.class_grade.trim() || null,
      amount_due: amountDue,
      amount_paid: amountPaid,
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
    setForm(emptyForm);
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
                <TableHead>Amount Due</TableHead>
                <TableHead>Amount Paid</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fees.map((fee) => (
                <TableRow key={fee.id}>
                  <TableCell className="font-medium text-slate-900">{fee.student_name}</TableCell>
                  <TableCell className="text-slate-600">{fee.class_grade || "—"}</TableCell>
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
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Fee Record</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="student_name">Student name</Label>
              <Input
                id="student_name"
                value={form.student_name}
                onChange={(e) => setForm({ ...form, student_name: e.target.value })}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="class_grade">Class</Label>
              <Input
                id="class_grade"
                value={form.class_grade}
                onChange={(e) => setForm({ ...form, class_grade: e.target.value })}
                placeholder="e.g. 10"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="amount_due">Amount due</Label>
                <Input
                  id="amount_due"
                  type="number"
                  value={form.amount_due}
                  onChange={(e) => setForm({ ...form, amount_due: e.target.value })}
                  placeholder="5000"
                />
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
    </ERPLayout>
  );
};

export default ERPFeeManagement;