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
import { Plus, Pencil, Trash2, Paperclip } from "lucide-react";

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

export function TeacherRepeatableList({ title, emptyText, tableName, fields, renderRow }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

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
    <Card className="border border-border/60">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Button size="sm" variant="outline" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6"><LoadingSpinner /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{emptyText}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const { primary, secondary, meta, fileUrl } = renderRow(row);
              return (
                <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 group">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{primary}</p>
                    {secondary && <p className="text-xs text-muted-foreground truncate">{secondary}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
                      {fileUrl && (
                        <a href={fileUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                          <Paperclip className="h-3 w-3" /> View file
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={() => openEdit(row)} className="p-1.5 rounded hover:bg-muted">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDelete(row.id)} className="p-1.5 rounded hover:bg-muted">
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? `Edit ${title}` : `Add ${title}`}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
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
                      className="mt-1"
                    />
                  </>
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}