/**
 * TeacherRepeatableList.tsx
 * One generic list editor used for every repeatable Professional
 * Development section (Qualifications, Certifications, Experience,
 * Subject Expertise, Training History, Digital Skills, Career Goals,
 * Publications, Awards, Languages). Each section just supplies its own
 * table name, field config, and a row-summary renderer.
 */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Plus, Pencil, Trash2, Paperclip, ChevronDown } from "lucide-react";

export type FieldDef =
  | { key: string; label: string; type: "text" | "date" | "number"; placeholder?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "checkbox" }
  | { key: string; label: string; type: "file"; bucket: string };

interface Props {
  title: string;
  emptyText: string;
  tableName: string;
  fields: FieldDef[];
  renderRow: (row: Record<string, any>) => { primary: string; secondary?: string; meta?: string; fileUrl?: string | null };
}

export function TeacherRepeatableList({ title, emptyText, tableName, fields, renderRow, icon: Icon }: Props & { icon?: React.ElementType }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: [tableName, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(tableName as any)
        .select("*")
        .eq("teacher_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Record<string, any>[];
    },
    enabled: !!user?.id,
  });

  // Auto-expand once, the first time we learn this section actually has data.
  if (!isLoading && !hasAutoExpanded) {
    if (rows.length > 0 && !expanded) setExpanded(true);
    setHasAutoExpanded(true);
  }

  const defaultsFor = (): Record<string, any> => {
    const d: Record<string, any> = {};
    fields.forEach((f) => { d[f.key] = f.type === "checkbox" ? true : ""; });
    return d;
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(defaultsFor());
    setDialogOpen(true);
  };

  const openEdit = (row: Record<string, any>) => {
    setEditingId(row.id);
    setForm({ ...row });
    setDialogOpen(true);
  };

  const handleFileChange = async (field: Extract<FieldDef, { type: "file" }>, file: File | null) => {
    if (!file || !user?.id) return;
    setUploadingKey(field.key);
    try {
      const path = `${user.id}/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from(field.bucket).upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from(field.bucket).getPublicUrl(path);
      setForm((f) => ({ ...f, [field.key]: data.publicUrl }));
      toast({ title: "File uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingKey(null);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    const firstField = fields[0];
    const firstEmpty = firstField.type !== "checkbox" && firstField.type !== "file" && !String(form[firstField.key] ?? "").trim();
    if (firstEmpty) {
      toast({ title: `${firstField.label} is required`, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = { teacher_id: user.id };
      fields.forEach((f) => { payload[f.key] = form[f.key] ?? (f.type === "checkbox" ? true : null); });

      if (editingId) {
        const { error } = await supabase.from(tableName as any).update(payload).eq("id", editingId);
        if (error) throw error;
        toast({ title: "Updated" });
      } else {
        const { error } = await supabase.from(tableName as any).insert(payload);
        if (error) throw error;
        toast({ title: "Added" });
      }
      setDialogOpen(false);
      refetch();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from(tableName as any).delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Deleted" });
    refetch();
  };

return (
    <Card className="overflow-hidden border-blue-100 shadow-sm scroll-mt-24">
      <div className="h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-4 md:p-5 hover:bg-blue-50/30 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            {Icon ? <Icon className="h-4 w-4 text-blue-600" /> : <Plus className="h-4 w-4 text-blue-600" />}
          </div>
          <h3 className="text-sm font-semibold text-slate-800 truncate">{title}</h3>
          {!isLoading && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
              rows.length > 0 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400"
            }`}>
              {rows.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); setExpanded(true); openAdd(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setExpanded(true); openAdd(); } }}
            className="inline-flex items-center gap-1 text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-2.5 py-1.5 rounded-lg"
          >
            <Plus className="h-3 w-3" /> Add
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded && (
      <CardContent className="p-4 md:p-5 pt-0 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-6"><LoadingSpinner /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-2">
              <Plus className="h-5 w-5 text-blue-300" />
            </div>
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
  const { primary, secondary, meta, fileUrl } = renderRow(row);
  return (
    <div
      key={row.id}
      className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-l-blue-400 border border-slate-200 bg-blue-50/20 p-3 group"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium truncate text-slate-800">{primary}</p>
        {secondary && <p className="text-xs text-muted-foreground truncate">{secondary}</p>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
          {fileUrl && (
            <a href={fileUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 font-medium">
              <Paperclip className="h-3 w-3" /> View file
            </a>
          )}
        </div>
      </div>
      <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg hover:bg-blue-100">
          <Pencil className="h-3.5 w-3.5 text-blue-600" />
        </button>
        <button onClick={() => handleDelete(row.id)} className="p-1.5 rounded-lg hover:bg-red-50">
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </button>
      </div>
    </div>
  );
})}
          </div>
        )}
      </CardContent>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
  <DialogContent className="max-w-md w-[calc(100%-2rem)] sm:w-full rounded-xl p-0 overflow-hidden max-h-[85vh] flex flex-col">
    <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4 shrink-0">
      <DialogHeader>
        <DialogTitle className="text-white text-base">{editingId ? `Edit ${title}` : `Add ${title}`}</DialogTitle>
      </DialogHeader>
    </div>

    <div className="space-y-3 px-5 py-4 overflow-y-auto">
            {fields.map((f) => (
              <div key={f.key}>
                {f.type === "checkbox" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={!!form[f.key]}
                      onCheckedChange={(v) => setForm((s) => ({ ...s, [f.key]: !!v }))}
                    />
                    {f.label}
                  </label>
                ) : f.type === "select" ? (
                  <>
                    <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                    <Select value={form[f.key] || ""} onValueChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder={`Select ${f.label.toLowerCase()}`} /></SelectTrigger>
                      <SelectContent>
                        {f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </>
                ) : f.type === "file" ? (
                  <>
                    <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                    <Input
                      type="file"
                      accept="application/pdf,image/*"
                      className="mt-1"
                      onChange={(e) => handleFileChange(f, e.target.files?.[0] || null)}
                    />
                    {uploadingKey === f.key && <p className="text-xs text-muted-foreground mt-1">Uploading...</p>}
                    {form[f.key] && uploadingKey !== f.key && (
                      <p className="text-xs text-green-600 mt-1">File attached ✓</p>
                    )}
                  </>
                ) : (
                  <>
                    <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                    <Input
                      type={f.type}
                      placeholder={f.placeholder}
                      value={form[f.key] || ""}
                      onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                      className="mt-1 border-slate-200 focus-visible:ring-blue-400"
                    />
                  </>
                )}
              </div>
        ))}
      </div>

      <DialogFooter className="px-5 py-4 border-t border-slate-100 shrink-0">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setDialogOpen(false)}>Cancel</Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 sm:flex-none bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</Card>
  );
}