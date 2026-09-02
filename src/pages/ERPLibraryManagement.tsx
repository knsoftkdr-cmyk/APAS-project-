import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ERPLayout from "@/components/erp/ERPLayout";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { BookOpen, Search, Plus, Upload, RotateCcw, UserSearch, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface LibraryItem {
  id: string;
  item_type: "physical_book" | "ebook" | "research_paper" | "journal";
  title: string;
  author: string | null;
  isbn: string | null;
  subject: string | null;
  class_level: string | null;
  total_copies: number;
  available_copies: number;
  status: string;
}

interface CirculationRecord {
  id: string;
  item_id: string;
  member_id: string;
  issued_date: string;
  due_date: string;
  returned_date: string | null;
  fine_amount: number;
  status: string;
  renewal_count: number;
  library_items: { title: string } | null;
  library_members: { profile_id: string; member_type: string; profiles: { full_name: string } | null } | null;
}

interface StudentSearchResult {
  id: string;
  profile_id: string;
  full_name: string;
  admission_number: string | null;
  class: string | null;
  section: string | null;
}

interface TeacherSearchResult {
  id: string;
  full_name: string;
  employee_id: string | null;
  designation: string | null;
}

interface BookSearchResult {
  id: string;
  title: string;
  author: string | null;
  available_copies: number;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const ERPLibraryManagement = () => {
  const navigate = useNavigate();
  const [schoolId, setSchoolId] = useState<string>("");
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("catalog");
  const [searchTerm, setSearchTerm] = useState("");

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
      setLoading(false);
    };
    init();
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-500">
        Loading...
      </div>
    );
  }

  return (
    <ERPLayout orgName={orgName} activePath="/erp/library" tabLabel="Library">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            Library Management
          </h1>
          <p className="text-sm text-slate-500">
            Catalog, circulation, digital library, and research repository
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="circulation">Circulation</TabsTrigger>
          <TabsTrigger value="digital">Digital Library</TabsTrigger>
          <TabsTrigger value="research">Research Repository</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog">
          <CatalogTab schoolId={schoolId} searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
        </TabsContent>

        <TabsContent value="circulation">
          <CirculationTab schoolId={schoolId} />
        </TabsContent>

        <TabsContent value="digital">
          <DigitalLibraryTab schoolId={schoolId} />
        </TabsContent>

        <TabsContent value="research">
          <ResearchRepositoryTab schoolId={schoolId} />
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
};

export default ERPLibraryManagement;

// ---------------------------------------------------------------------------
// Catalog Tab — browse/search/add books, ebooks, journals
// ---------------------------------------------------------------------------
function CatalogTab({
  schoolId,
  searchTerm,
  setSearchTerm,
}: {
  schoolId: string;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
}) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [form, setForm] = useState({
    title: "",
    author: "",
    isbn: "",
    item_type: "physical_book",
    customType: "",
    subject: "",
    class_level: "",
    total_copies: 1,
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ["library-items", schoolId, searchTerm],
    queryFn: async () => {
      let query = supabase
        .from("library_items")
        .select("*")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false });

      if (searchTerm) {
        query = query.or(
          `title.ilike.%${searchTerm}%,author.ilike.%${searchTerm}%,subject.ilike.%${searchTerm}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as LibraryItem[];
    },
    enabled: !!schoolId,
  });

  const addItemMutation = useMutation({
    mutationFn: async () => {
      const finalType = form.item_type === "other" ? form.customType.trim() : form.item_type;
      if (!finalType) throw new Error("Please specify a type");
      const { error } = await supabase.from("library_items").insert({
        school_id: schoolId,
        item_type: finalType,
        title: form.title,
        author: form.author || null,
        isbn: form.isbn || null,
        subject: form.subject || null,
        class_level: form.class_level || null,
        total_copies: form.item_type === "physical_book" ? form.total_copies : 1,
        available_copies: form.item_type === "physical_book" ? form.total_copies : 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item added to catalog");
      queryClient.invalidateQueries({ queryKey: ["library-items", schoolId] });
      setAddOpen(false);
      setForm({ title: "", author: "", isbn: "", item_type: "physical_book", customType: "", subject: "", class_level: "", total_copies: 1 });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const CATALOG_PAGE_SIZE_OPTIONS = [10, 25, 50];
  const totalPages = Math.max(1, Math.ceil((items?.length ?? 0) / pageSize));
  const pagedItems = items?.slice((page - 1) * pageSize, page * pageSize) ?? [];
  const rangeStart = items && items.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = items ? Math.min(page * pageSize, items.length) : 0;
  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by title, author, subject..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
          />
        </div>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Catalog Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Type</Label>
                <Select value={form.item_type} onValueChange={(v) => setForm({ ...form, item_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="physical_book">Physical Book</SelectItem>
                    <SelectItem value="ebook">eBook</SelectItem>
                    <SelectItem value="research_paper">Research Paper</SelectItem>
                    <SelectItem value="journal">Journal</SelectItem>
                    <SelectItem value="other">Other (specify)</SelectItem>
                  </SelectContent>
                </Select>
              {form.item_type === "other" && (
                <div>
                  <Label>Specify Type</Label>
                  <Input
                    placeholder="e.g. Magazine, CD/DVD, Newspaper..."
                    value={form.customType}
                    onChange={(e) => setForm({ ...form, customType: e.target.value })}
                  />
                </div>
              )}
              </div>
              <div>
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <Label>Author</Label>
                <Input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
              </div>
              <div>
                <Label>ISBN (optional)</Label>
                <Input value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} />
              </div>
              <div>
                <Label>Subject / Genre (optional)</Label>
                <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Science, Fiction, Biography..." />
              </div>
              <div>
                <Label>Class Level (optional, e.g. Class 6)</Label>
                <Input value={form.class_level} onChange={(e) => setForm({ ...form, class_level: e.target.value })} />
              </div>
              {form.item_type === "physical_book" && (
                <div>
                  <Label>Total Copies</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.total_copies}
                    onChange={(e) => setForm({ ...form, total_copies: parseInt(e.target.value) || 1 })}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                onClick={() => addItemMutation.mutate()}
                disabled={!form.title || (form.item_type === "other" && !form.customType.trim()) || addItemMutation.isPending}
              >
                Add to Catalog
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-blue-600 hover:bg-blue-600">
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white py-3">Title</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Author</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Type</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Subject / Genre · Class</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Availability</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow className="border-0"><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            )}
            {!isLoading && items?.length === 0 && (
              <TableRow className="border-0"><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No items found</TableCell></TableRow>
            )}
            {pagedItems.map((item) => (
              <TableRow key={item.id} className="border-0 border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                <TableCell className="font-medium text-slate-900 py-3">{item.title}</TableCell>
                <TableCell className="text-slate-700">{item.author || "-"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{item.item_type.replace("_", " ")}</Badge>
                </TableCell>
                <TableCell className="text-slate-600">{[item.subject, item.class_level].filter(Boolean).join(" · ") || "-"}</TableCell>
                <TableCell className="text-slate-600">
                  {item.item_type === "physical_book"
                    ? `${item.available_copies} / ${item.total_copies}`
                    : "Digital"}
                </TableCell>
                <TableCell>
                  <Badge variant={item.status === "active" ? "default" : "secondary"}>
                    {item.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {items && items.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => { setPageSize(parseInt(v)); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-[70px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATALOG_PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-2">
                {rangeStart}–{rangeEnd} of {items.length}
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Circulation Tab — issue / return / renew / overdue tracking
// ---------------------------------------------------------------------------
const PAGE_SIZE_OPTIONS = [10, 25, 50];

function daysLate(dueDate: string, asOf: Date = new Date()): number {
  const due = new Date(dueDate + "T00:00:00");
  const today = new Date(asOf.toISOString().slice(0, 10) + "T00:00:00");
  const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function CirculationTab({ schoolId }: { schoolId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data: settings } = useQuery({
    queryKey: ["library-settings", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_settings")
        .select("default_loan_days, fine_per_day, max_renewals")
        .eq("school_id", schoolId)
        .maybeSingle();
      if (error) throw error;
      return data ?? { default_loan_days: 14, fine_per_day: 5, max_renewals: 1 };
    },
    enabled: !!schoolId,
  });

  const finePerDay = settings?.fine_per_day ?? 5;
  const loanDays = settings?.default_loan_days ?? 14;
  const maxRenewals = settings?.max_renewals ?? 1;

  const [returnTarget, setReturnTarget] = useState<CirculationRecord | null>(null);
  const [returnDate, setReturnDate] = useState("");

  const openReturnDialog = (record: CirculationRecord) => {
    setReturnTarget(record);
    setReturnDate(new Date().toISOString().slice(0, 10));
  };

  const { data: records, isLoading } = useQuery({
    queryKey: ["library-circulation", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_circulation")
        .select("*, library_items(title), library_members(profile_id, member_type, profiles(full_name))")
        .eq("school_id", schoolId)
        .order("issued_date", { ascending: false });
      if (error) throw error;
      return data as unknown as CirculationRecord[];
    },
    enabled: !!schoolId,
  });

  const returnMutation = useMutation({
    mutationFn: async ({ record, returnDate }: { record: CirculationRecord; returnDate: string }) => {
      const late = daysLate(record.due_date, new Date(returnDate + "T00:00:00"));
      const fine = late * finePerDay;
      const { error } = await supabase
        .from("library_circulation")
        .update({
          status: "returned",
          returned_date: returnDate,
          fine_amount: fine,
        })
        .eq("id", record.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Book marked as returned");
      queryClient.invalidateQueries({ queryKey: ["library-circulation", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["library-items", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["library-book-search", schoolId] });
      setReturnTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [renewTarget, setRenewTarget] = useState<CirculationRecord | null>(null);
  const [renewDueDate, setRenewDueDate] = useState("");

  const openRenewDialog = (record: CirculationRecord) => {
    const d = new Date();
    d.setDate(d.getDate() + loanDays);
    setRenewTarget(record);
    setRenewDueDate(d.toISOString().slice(0, 10));
  };

  const renewMutation = useMutation({
    mutationFn: async ({ record, newDueDate }: { record: CirculationRecord; newDueDate: string }) => {
      if (record.renewal_count >= maxRenewals) {
        throw new Error(`Maximum renewals (${maxRenewals}) already reached`);
      }
      const { error } = await supabase
        .from("library_circulation")
        .update({
          due_date: newDueDate,
          renewal_count: record.renewal_count + 1,
        })
        .eq("id", record.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Book renewed");
      queryClient.invalidateQueries({ queryKey: ["library-circulation", schoolId] });
      setRenewTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const totalPages = Math.max(1, Math.ceil((records?.length ?? 0) / pageSize));
  const pagedRecords = records?.slice((page - 1) * pageSize, page * pageSize) ?? [];
  const rangeStart = records && records.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = records ? Math.min(page * pageSize, records.length) : 0;

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          {records ? `${records.length} record${records.length === 1 ? "" : "s"}` : ""}
        </h2>
        <IssueBookDialog schoolId={schoolId} />
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-blue-600 hover:bg-blue-600">
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white py-3">Book</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Member</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Type</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Issued</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Due</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Status</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Fine</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white text-right pr-4">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow className="border-0"><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            )}
            {!isLoading && records?.length === 0 && (
              <TableRow className="border-0"><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No circulation records yet</TableCell></TableRow>
            )}
            {pagedRecords.map((r, idx) => {
              const late = r.status === "issued" ? daysLate(r.due_date) : 0;
              const isOverdue = r.status === "issued" && late > 0;
              const displayFine = r.status === "returned" ? r.fine_amount : late * finePerDay;
              const canRenew = r.status === "issued" && r.renewal_count < maxRenewals;

              return (
                <TableRow
                  key={r.id}
                  className="border-0 border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors"
                >
                  <TableCell className="font-medium text-slate-900 py-3">{r.library_items?.title}</TableCell>
                  <TableCell className="text-slate-700">{r.library_members?.profiles?.full_name || "-"}</TableCell>
                  <TableCell className="capitalize text-slate-600">{r.library_members?.member_type}</TableCell>
                  <TableCell className="text-slate-600">{r.issued_date}</TableCell>
                  <TableCell className={isOverdue ? "text-red-600 font-medium" : "text-slate-600"}>{r.due_date}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        isOverdue
                          ? "font-normal bg-red-600 text-white hover:bg-red-600 border-transparent"
                          : r.status === "issued"
                          ? "font-normal bg-blue-600 text-white hover:bg-blue-600 border-transparent"
                          : "font-normal bg-emerald-600 text-white hover:bg-emerald-600 border-transparent"
                      }
                    >
                      {isOverdue ? "overdue" : r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className={displayFine > 0 ? "text-red-600 font-medium" : "text-slate-400"}>
                    {displayFine > 0 ? `₹${displayFine}` : "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5 justify-end pr-2">
                      {r.status === "issued" && (
                        <Button size="sm" variant="outline" onClick={() => openReturnDialog(r)}>
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Return
                        </Button>
                      )}
                      {r.status === "issued" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canRenew}
                          title={!canRenew ? `Max renewals (${maxRenewals}) reached` : undefined}
                          onClick={() => openRenewDialog(r)}
                        >
                          Renew
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {records && records.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => { setPageSize(parseInt(v)); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-[70px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-2">
                {rangeStart}–{rangeEnd} of {records.length}
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!returnTarget} onOpenChange={(v) => { if (!v) setReturnTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Return Book</DialogTitle>
          </DialogHeader>
          {returnTarget && (
            <div className="space-y-3">
              <div className="text-sm">
                <div className="font-medium text-slate-900">{returnTarget.library_items?.title}</div>
                <div className="text-slate-500">{returnTarget.library_members?.profiles?.full_name}</div>
              </div>
              <div className="text-sm text-slate-600">
                Due date: <span className="font-medium">{returnTarget.due_date}</span>
              </div>
              <div>
                <Label>Return Date</Label>
                <Input
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                />
              </div>
              {returnDate && daysLate(returnTarget.due_date, new Date(returnDate + "T00:00:00")) > 0 && (
                <div className="text-sm text-red-600">
                  {daysLate(returnTarget.due_date, new Date(returnDate + "T00:00:00"))} day(s) late · Fine: ₹{daysLate(returnTarget.due_date, new Date(returnDate + "T00:00:00")) * finePerDay}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => returnTarget && returnMutation.mutate({ record: returnTarget, returnDate })}
              disabled={!returnDate || returnMutation.isPending}
            >
              Confirm Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!renewTarget} onOpenChange={(v) => { if (!v) setRenewTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renew Book</DialogTitle>
          </DialogHeader>
          {renewTarget && (
            <div className="space-y-3">
              <div className="text-sm">
                <div className="font-medium text-slate-900">{renewTarget.library_items?.title}</div>
                <div className="text-slate-500">{renewTarget.library_members?.profiles?.full_name}</div>
              </div>
              <div className="text-sm text-slate-600">
                Current due date: <span className="font-medium">{renewTarget.due_date}</span>
              </div>
              <div>
                <Label>New Due Date</Label>
                <Input
                  type="date"
                  value={renewDueDate}
                  onChange={(e) => setRenewDueDate(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => renewTarget && renewMutation.mutate({ record: renewTarget, newDueDate: renewDueDate })}
              disabled={!renewDueDate || renewMutation.isPending}
            >
              Confirm Renewal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue Book Dialog — search member (student/teacher) + search available
// physical book + set due date + create circulation record
// ---------------------------------------------------------------------------
function IssueBookDialog({ schoolId }: { schoolId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [memberType, setMemberType] = useState<"student" | "teacher">("student");
  const [classFilter, setClassFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<{ profileId: string; label: string; sub: string } | null>(null);

  const [bookSearch, setBookSearch] = useState("");
  const [selectedBook, setSelectedBook] = useState<{ id: string; title: string } | null>(null);

  const defaultDue = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  };
  const [dueDate, setDueDate] = useState<string>(defaultDue());

  const resetForm = () => {
    setSelectedMember(null);
    setSelectedBook(null);
    setMemberSearch("");
    setBookSearch("");
    setClassFilter("");
    setSectionFilter("");
    setDueDate(defaultDue());
  };

  // ---- class/section dropdown options ----
  const { data: classOptions } = useQuery({
    queryKey: ["library-class-options", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from("students").select("class").eq("school_id", schoolId);
      if (error) throw error;
      const unique = Array.from(new Set((data || []).map((d: any) => d.class).filter(Boolean))) as string[];
      return unique.sort();
    },
    enabled: open && memberType === "student",
  });

  const { data: sectionOptions } = useQuery({
    queryKey: ["library-section-options", schoolId, classFilter],
    queryFn: async () => {
      let q = supabase.from("students").select("section").eq("school_id", schoolId);
      if (classFilter) q = q.eq("class", classFilter);
      const { data, error } = await q;
      if (error) throw error;
      const unique = Array.from(new Set((data || []).map((d: any) => d.section).filter(Boolean))) as string[];
      return unique.sort();
    },
    enabled: open && memberType === "student",
  });

  // ---- member search ----
  const { data: studentResults } = useQuery({
    queryKey: ["library-member-search-student", schoolId, memberSearch, classFilter, sectionFilter],
    queryFn: async () => {
      let q = supabase
        .from("students")
        .select("id, profile_id, full_name, admission_number, class, section")
        .eq("school_id", schoolId);
      if (classFilter) q = q.eq("class", classFilter);
      if (sectionFilter) q = q.eq("section", sectionFilter);
      if (memberSearch) {
        q = q.or(`full_name.ilike.%${memberSearch}%,admission_number.ilike.%${memberSearch}%`);
      }
      const { data, error } = await q.order("full_name", { ascending: true }).limit(20);
      if (error) throw error;
      return data as StudentSearchResult[];
    },
    enabled: open && memberType === "student",
  });

  const { data: teacherResults } = useQuery({
    queryKey: ["library-member-search-teacher", schoolId, memberSearch],
    queryFn: async () => {
      let q = supabase
        .from("profiles")
        .select("id, full_name, employee_id, designation")
        .eq("school_id", schoolId)
        .eq("role", "teacher");
      if (memberSearch) {
        q = q.or(`full_name.ilike.%${memberSearch}%,employee_id.ilike.%${memberSearch}%`);
      }
      const { data, error } = await q.order("full_name", { ascending: true }).limit(20);
      if (error) throw error;
      return data as TeacherSearchResult[];
    },
    enabled: open && memberType === "teacher",
  });

  // ---- book search (physical books with at least 1 available copy) ----
  const { data: bookResults } = useQuery({
    queryKey: ["library-book-search", schoolId, bookSearch],
    queryFn: async () => {
      let q = supabase
        .from("library_items")
        .select("id, title, author, available_copies")
        .eq("school_id", schoolId)
        .eq("item_type", "physical_book")
        .gt("available_copies", 0);
      if (bookSearch) {
        q = q.ilike("title", `%${bookSearch}%`);
      }
      const { data, error } = await q.order("title", { ascending: true }).limit(20);
      if (error) throw error;
      return data as BookSearchResult[];
    },
    enabled: open,
  });

  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMember || !selectedBook) {
        throw new Error("Select both a member and a book");
      }

      const { data: existingMember } = await supabase
        .from("library_members")
        .select("id")
        .eq("school_id", schoolId)
        .eq("profile_id", selectedMember.profileId)
        .maybeSingle();

      let memberId = existingMember?.id as string | undefined;

      if (!memberId) {
        const { data: newMember, error: memberErr } = await supabase
          .from("library_members")
          .insert({ school_id: schoolId, profile_id: selectedMember.profileId, member_type: memberType })
          .select("id")
          .single();
        if (memberErr) throw memberErr;
        memberId = newMember.id;
      }

      const { error } = await supabase.from("library_circulation").insert({
        school_id: schoolId,
        item_id: selectedBook.id,
        member_id: memberId,
        due_date: dueDate,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Book issued");
      queryClient.invalidateQueries({ queryKey: ["library-circulation", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["library-items", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["library-book-search", schoolId] });
      setOpen(false);
      resetForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Issue Book
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue Book</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Member type toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={memberType === "student" ? "default" : "outline"}
              onClick={() => { setMemberType("student"); setSelectedMember(null); setMemberSearch(""); }}
            >
              Student
            </Button>
            <Button
              type="button"
              size="sm"
              variant={memberType === "teacher" ? "default" : "outline"}
              onClick={() => { setMemberType("teacher"); setSelectedMember(null); setMemberSearch(""); }}
            >
              Teacher
            </Button>
          </div>

          {/* Class/section filter for students */}
          {memberType === "student" && (
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={classFilter || "all"}
                onValueChange={(v) => { setClassFilter(v === "all" ? "" : v); setSectionFilter(""); }}
              >
                <SelectTrigger><SelectValue placeholder="Class" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {classOptions?.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={sectionFilter || "all"}
                onValueChange={(v) => setSectionFilter(v === "all" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="Section" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sections</SelectItem>
                  {sectionOptions?.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Member search */}
          {!selectedMember ? (
            <div className="space-y-2">
              <div className="relative">
                <UserSearch className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={memberType === "student" ? "Search by name or admission number..." : "Search by name or employee ID..."}
                  className="pl-8"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
              </div>
              <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
                {memberType === "student" &&
                  studentResults?.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                      onClick={() =>
                        setSelectedMember({
                          profileId: s.profile_id,
                          label: s.full_name,
                          sub: [s.admission_number, s.class, s.section].filter(Boolean).join(" · "),
                        })
                      }
                    >
                      <div className="font-medium">{s.full_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[s.admission_number, s.class, s.section].filter(Boolean).join(" · ")}
                      </div>
                    </button>
                  ))}
                {memberType === "teacher" &&
                  teacherResults?.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                      onClick={() =>
                        setSelectedMember({
                          profileId: t.id,
                          label: t.full_name,
                          sub: [t.employee_id, t.designation].filter(Boolean).join(" · "),
                        })
                      }
                    >
                      <div className="font-medium">{t.full_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[t.employee_id, t.designation].filter(Boolean).join(" · ")}
                      </div>
                    </button>
                  ))}
                {memberType === "student" && studentResults?.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No students found</div>
                )}
                {memberType === "teacher" && teacherResults?.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No teachers found</div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-slate-50">
              <div>
                <div className="text-sm font-medium flex items-center gap-1">
                  <Check className="h-3 w-3 text-emerald-600" />
                  {selectedMember.label}
                </div>
                <div className="text-xs text-muted-foreground">{selectedMember.sub}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedMember(null)}>
                Change
              </Button>
            </div>
          )}

          {/* Book search */}
          {!selectedBook ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search available books by title..."
                  className="pl-8"
                  value={bookSearch}
                  onChange={(e) => setBookSearch(e.target.value)}
                />
              </div>
              <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
                {bookResults?.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                    onClick={() => setSelectedBook({ id: b.id, title: b.title })}
                  >
                    <div className="font-medium">{b.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.author || "Unknown author"} · {b.available_copies} available
                    </div>
                  </button>
                ))}
                {bookResults?.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No available copies found</div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-slate-50">
              <div className="text-sm font-medium flex items-center gap-1">
                <Check className="h-3 w-3 text-emerald-600" />
                {selectedBook.title}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedBook(null)}>
                Change
              </Button>
            </div>
          )}

          {/* Due date */}
          <div>
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => issueMutation.mutate()}
            disabled={!selectedMember || !selectedBook || issueMutation.isPending}
          >
            Issue Book
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Digital Library Tab — ebook upload/browse (placeholder for storage wiring)
// ---------------------------------------------------------------------------
function DigitalLibraryTab({ schoolId }: { schoolId: string }) {
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    author: "",
    subject: "",
    class_level: "",
    isDownloadable: true,
  });
  const [file, setFile] = useState<File | null>(null);

  const { data: ebooks, isLoading } = useQuery({
    queryKey: ["library-ebooks", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_items")
        .select("*, library_item_files(file_url, file_type, is_downloadable)")
        .eq("school_id", schoolId)
        .eq("item_type", "ebook")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!schoolId,
  });

  const resetForm = () => {
    setForm({ title: "", author: "", subject: "", class_level: "", isDownloadable: true });
    setFile(null);
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please choose a file to upload");
      setUploading(true);

      const { data: userData } = await supabase.auth.getUser();
      const uploadedBy = userData.user?.id ?? null;

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${schoolId}/ebooks/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("library-files")
        .upload(storagePath, file);
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from("library-files")
        .getPublicUrl(storagePath);

      const { data: itemData, error: itemError } = await supabase
        .from("library_items")
        .insert({
          school_id: schoolId,
          item_type: "ebook",
          title: form.title,
          author: form.author || null,
          subject: form.subject || null,
          class_level: form.class_level || null,
          total_copies: 1,
          available_copies: 1,
        })
        .select("id")
        .single();
      if (itemError) throw itemError;

      const { error: fileError } = await supabase.from("library_item_files").insert({
        item_id: itemData.id,
        school_id: schoolId,
        file_url: publicUrlData.publicUrl,
        file_type: file.type || file.name.split(".").pop() || "unknown",
        file_size_kb: Math.round(file.size / 1024),
        is_downloadable: form.isDownloadable,
        uploaded_by: uploadedBy,
      });
      if (fileError) throw fileError;
    },
    onSuccess: () => {
      toast.success("eBook uploaded");
      queryClient.invalidateQueries({ queryKey: ["library-ebooks", schoolId] });
      setUploadOpen(false);
      resetForm();
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setUploading(false),
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Dialog open={uploadOpen} onOpenChange={(v) => { setUploadOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Upload className="h-4 w-4 mr-1" />
              Upload eBook
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload eBook</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <Label>Author</Label>
                <Input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
              </div>
              <div>
                <Label>Subject / Genre (optional)</Label>
                <Input
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="e.g. Science, Fiction, Biography..."
                />
              </div>
              <div>
                <Label>Class Level (optional, e.g. Class 6)</Label>
                <Input value={form.class_level} onChange={(e) => setForm({ ...form, class_level: e.target.value })} />
              </div>
              <div>
                <Label>File (PDF, EPUB, etc.)</Label>
                <Input
                  type="file"
                  accept=".pdf,.epub,.doc,.docx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDownloadable"
                  checked={form.isDownloadable}
                  onChange={(e) => setForm({ ...form, isDownloadable: e.target.checked })}
                />
                <Label htmlFor="isDownloadable">Allow download</Label>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={!form.title || !file || uploading}
              >
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-blue-600 hover:bg-blue-600">
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white py-3">Title</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Author</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">File Type</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Downloadable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow className="border-0"><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            )}
            {!isLoading && ebooks?.length === 0 && (
              <TableRow className="border-0"><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No eBooks yet</TableCell></TableRow>
            )}
            {ebooks?.map((e: any) => (
              <TableRow key={e.id} className="border-0 border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                <TableCell className="font-medium text-slate-900 py-3">
                  {e.library_item_files?.[0]?.file_url ? (
                    <a href={e.library_item_files[0].file_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                      {e.title}
                    </a>
                  ) : (
                    e.title
                  )}
                </TableCell>
                <TableCell className="text-slate-700">{e.author || "-"}</TableCell>
                <TableCell className="text-slate-600">{e.library_item_files?.[0]?.file_type || "-"}</TableCell>
                <TableCell className="text-slate-600">{e.library_item_files?.[0]?.is_downloadable ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Research Repository Tab — tagged research papers
// ---------------------------------------------------------------------------
function ResearchRepositoryTab({ schoolId }: { schoolId: string }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: "", author: "", subject: "", tags: "" });
  const [file, setFile] = useState<File | null>(null);

  const { data: papers, isLoading } = useQuery({
    queryKey: ["library-research", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_items")
        .select("*, library_item_tags(tag)")
        .eq("school_id", schoolId)
        .eq("item_type", "research_paper")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!schoolId,
  });

  const resetForm = () => {
    setForm({ title: "", author: "", subject: "", tags: "" });
    setFile(null);
  };

  const addPaperMutation = useMutation({
    mutationFn: async () => {
      setUploading(true);
      const { data: itemData, error: itemError } = await supabase
        .from("library_items")
        .insert({
          school_id: schoolId,
          item_type: "research_paper",
          title: form.title,
          author: form.author || null,
          subject: form.subject || null,
          total_copies: 1,
          available_copies: 1,
        })
        .select("id")
        .single();
      if (itemError) throw itemError;

      const tagList = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length > 0) {
        const { error: tagError } = await supabase.from("library_item_tags").insert(
          tagList.map((tag) => ({ item_id: itemData.id, school_id: schoolId, tag }))
        );
        if (tagError) throw tagError;
      }

      if (file) {
        const { data: userData } = await supabase.auth.getUser();
        const uploadedBy = userData.user?.id ?? null;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${schoolId}/research/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("library-files")
          .upload(storagePath, file);
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("library-files")
          .getPublicUrl(storagePath);

        const { error: fileError } = await supabase.from("library_item_files").insert({
          item_id: itemData.id,
          school_id: schoolId,
          file_url: publicUrlData.publicUrl,
          file_type: file.type || file.name.split(".").pop() || "unknown",
          file_size_kb: Math.round(file.size / 1024),
          is_downloadable: true,
          uploaded_by: uploadedBy,
        });
        if (fileError) throw fileError;
      }
    },
    onSuccess: () => {
      toast.success("Research paper added");
      queryClient.invalidateQueries({ queryKey: ["library-research", schoolId] });
      setAddOpen(false);
      resetForm();
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setUploading(false),
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Paper
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Research Paper</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <Label>Author</Label>
                <Input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
              </div>
              <div>
                <Label>Subject (optional)</Label>
                <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
              <div>
                <Label>Tags (comma separated)</Label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="e.g. AI, education, K-12"
                />
              </div>
              <div>
                <Label>File (optional, PDF)</Label>
                <Input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => addPaperMutation.mutate()}
                disabled={!form.title || uploading}
              >
                {uploading ? "Saving..." : "Add Paper"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-blue-600 hover:bg-blue-600">
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white py-3">Title</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Author</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Subject</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-white">Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow className="border-0"><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            )}
            {!isLoading && papers?.length === 0 && (
              <TableRow className="border-0"><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No research papers yet</TableCell></TableRow>
            )}
            {papers?.map((p: any) => (
              <TableRow key={p.id} className="border-0 border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                <TableCell className="font-medium text-slate-900 py-3">{p.title}</TableCell>
                <TableCell className="text-slate-700">{p.author || "-"}</TableCell>
                <TableCell className="text-slate-600">{p.subject || "-"}</TableCell>
                <TableCell className="space-x-1">
                  {p.library_item_tags?.map((t: any, i: number) => (
                    <Badge key={i} variant="outline">{t.tag}</Badge>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
