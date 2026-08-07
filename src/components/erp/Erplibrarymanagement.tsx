import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
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
import { BookOpen, Search, Plus, Upload, RotateCcw } from "lucide-react";

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
  library_items: { title: string } | null;
  library_members: { profile_id: string; member_type: string } | null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ERPLibraryManagement() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id;
  const [activeTab, setActiveTab] = useState("catalog");
  const [searchTerm, setSearchTerm] = useState("");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            Library Management
          </h1>
          <p className="text-sm text-muted-foreground">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalog Tab — browse/search/add books, ebooks, journals
// ---------------------------------------------------------------------------
function CatalogTab({
  schoolId,
  searchTerm,
  setSearchTerm,
}: {
  schoolId: string | undefined;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
}) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    author: "",
    isbn: "",
    item_type: "physical_book",
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
      const { error } = await supabase.from("library_items").insert({
        school_id: schoolId,
        item_type: form.item_type,
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
      setForm({ title: "", author: "", isbn: "", item_type: "physical_book", subject: "", class_level: "", total_copies: 1 });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by title, author, subject..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
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
                  </SelectContent>
                </Select>
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
                <Label>Subject</Label>
                <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
              <div>
                <Label>Class Level (e.g. Class 6)</Label>
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
                disabled={!form.title || addItemMutation.isPending}
              >
                Add to Catalog
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Author</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Subject / Class</TableHead>
            <TableHead>Availability</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
          )}
          {!isLoading && items?.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No items found</TableCell></TableRow>
          )}
          {items?.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.title}</TableCell>
              <TableCell>{item.author || "-"}</TableCell>
              <TableCell>
                <Badge variant="outline">{item.item_type.replace("_", " ")}</Badge>
              </TableCell>
              <TableCell>{[item.subject, item.class_level].filter(Boolean).join(" · ") || "-"}</TableCell>
              <TableCell>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Circulation Tab — issue / return / overdue tracking
// ---------------------------------------------------------------------------
function CirculationTab({ schoolId }: { schoolId: string | undefined }) {
  const queryClient = useQueryClient();

  const { data: records, isLoading } = useQuery({
    queryKey: ["library-circulation", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_circulation")
        .select("*, library_items(title), library_members(profile_id, member_type)")
        .eq("school_id", schoolId)
        .order("issued_date", { ascending: false });
      if (error) throw error;
      return data as unknown as CirculationRecord[];
    },
    enabled: !!schoolId,
  });

  const returnMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const { error } = await supabase
        .from("library_circulation")
        .update({ status: "returned", returned_date: new Date().toISOString().slice(0, 10) })
        .eq("id", recordId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Book marked as returned");
      queryClient.invalidateQueries({ queryKey: ["library-circulation", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["library-items", schoolId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4 mt-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Book</TableHead>
            <TableHead>Member Type</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Fine</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
          )}
          {records?.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.library_items?.title}</TableCell>
              <TableCell className="capitalize">{r.library_members?.member_type}</TableCell>
              <TableCell>{r.issued_date}</TableCell>
              <TableCell>{r.due_date}</TableCell>
              <TableCell>
                <Badge variant={r.status === "issued" ? "default" : r.status === "overdue" ? "destructive" : "secondary"}>
                  {r.status}
                </Badge>
              </TableCell>
              <TableCell>{r.fine_amount > 0 ? `₹${r.fine_amount}` : "-"}</TableCell>
              <TableCell>
                {r.status === "issued" && (
                  <Button size="sm" variant="outline" onClick={() => returnMutation.mutate(r.id)}>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Return
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* NOTE: "Issue Book" flow (member search + due-date picker) is intentionally
          left as the next increment — wire it to an `issue-book` edge function
          once member lookup UX is decided. */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Digital Library Tab — ebook upload/browse (placeholder for storage wiring)
// ---------------------------------------------------------------------------
function DigitalLibraryTab({ schoolId }: { schoolId: string | undefined }) {
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

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled title="Wire to Supabase Storage upload">
          <Upload className="h-4 w-4 mr-1" />
          Upload eBook
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Author</TableHead>
            <TableHead>File Type</TableHead>
            <TableHead>Downloadable</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
          )}
          {ebooks?.map((e: any) => (
            <TableRow key={e.id}>
              <TableCell className="font-medium">{e.title}</TableCell>
              <TableCell>{e.author || "-"}</TableCell>
              <TableCell>{e.library_item_files?.[0]?.file_type || "-"}</TableCell>
              <TableCell>{e.library_item_files?.[0]?.is_downloadable ? "Yes" : "No"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Research Repository Tab — tagged research papers
// ---------------------------------------------------------------------------
function ResearchRepositoryTab({ schoolId }: { schoolId: string | undefined }) {
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

  return (
    <div className="space-y-4 mt-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Author</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Tags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
          )}
          {papers?.map((p: any) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.title}</TableCell>
              <TableCell>{p.author || "-"}</TableCell>
              <TableCell>{p.subject || "-"}</TableCell>
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
  );
}