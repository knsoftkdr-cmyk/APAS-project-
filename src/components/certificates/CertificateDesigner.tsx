// Visual certificate designer: drag text and the QR code on the page, style them, set the release conditions.
//
// The frame and background come from the real renderer, so the preview can't drift from the PDF. Text and the QR are
// HTML on top so they can be dragged; their sizes use container-height units, the same scale the renderer uses.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, ImagePlus, Loader2, Plus, QrCode, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  FONT_STACK, PAGE, PLACEHOLDERS, sampleValues, defaultDesign, fillPlaceholders, renderCertificate,
  type CertificateDesign, type CertificateElement, type CertificateFrame, type ElementAlign, type ElementFont, type TextElement,
} from "@/lib/certificates";
import { prepareImage } from "@/lib/tutorAttachments";
import { localizeServerMessage } from "@/lib/serverMessages";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

export interface CertificateTemplate {
  id: string;
  school_id: string;
  name: string;
  certificate_title: string;
  design: CertificateDesign;
  background_image: string | null;
  criteria_type: "manual" | "course_completion" | "course_score";
  criteria_course_id: string | null;
  min_score: number | null;
  auto_issue: boolean;
  is_archived: boolean;
}

const MAX_BACKGROUND_CHARS = 2_000_000; // the column allows 2 MiB

const clamp = (v: number) => Math.min(100, Math.max(0, v));

export function CertificateDesigner({ template, onClose, onSaved }: { template: CertificateTemplate | null; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [name, setName] = useState(template?.name ?? "");
  const [title, setTitle] = useState(template?.certificate_title ?? sampleValues().certificate_title);
  const [design, setDesign] = useState<CertificateDesign>(template?.design ?? defaultDesign());
  const [background, setBackground] = useState<string | null>(template?.background_image ?? null);
  const [criteria, setCriteria] = useState<CertificateTemplate["criteria_type"]>(template?.criteria_type ?? "manual");
  const [courseId, setCourseId] = useState(template?.criteria_course_id ?? "");
  const [minScore, setMinScore] = useState(String(template?.min_score ?? 60));
  const [autoIssue, setAutoIssue] = useState(template?.auto_issue ?? false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baseLayer, setBaseLayer] = useState<string | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; elX: number; elY: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const defaults = sampleValues();
  const sample = { ...defaults, certificate_title: title || defaults.certificate_title };
  const selected = design.elements.find((e) => e.id === selectedId) ?? null;

  const { data: courses = [] } = useQuery({
    queryKey: ["certificate-courses", profile?.school_id],
    enabled: !!profile?.school_id,
    queryFn: async () => {
      const { data, error } = await db.from("courses").select("id, title").eq("school_id", profile!.school_id).order("title");
      if (error) throw error;
      return data as { id: string; title: string }[];
    },
  });

  // Frame + colours + background image, from the renderer itself.
  useEffect(() => {
    let cancelled = false;
    renderCertificate({ ...design, elements: [] }, sample, background)
      .then((canvas) => { if (!cancelled) setBaseLayer(canvas.toDataURL("image/jpeg", 0.8)); })
      .catch((e) => toast.error(localizeServerMessage(e.message)));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only these affect the base layer
  }, [design.frame, design.accent, design.background, background]);

  useEffect(() => {
    import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL("https://example.com/verify", { width: 240, margin: 1 })).then(setQrPreview);
  }, []);

  const patchElement = (id: string, patch: Partial<TextElement>) =>
    setDesign((d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as CertificateElement) : e)) }));

  const removeElement = (id: string) => {
    setDesign((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== id) }));
    setSelectedId(null);
  };

  const addText = () => {
    const id = crypto.randomUUID();
    setDesign((d) => ({ ...d, elements: [...d.elements, { id, kind: "text", text: "New text", x: 50, y: 50, size: 3, color: "#1f2937", bold: false, font: "serif", align: "center" }] }));
    setSelectedId(id);
  };

  const addQr = () => {
    const id = crypto.randomUUID();
    setDesign((d) => ({ ...d, elements: [...d.elements, { id, kind: "qr", x: 78, y: 72, size: 17 }] }));
    setSelectedId(id);
  };

  const onPointerDown = (e: ReactPointerEvent, el: CertificateElement) => {
    e.preventDefault();
    setSelectedId(el.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: el.id, startX: e.clientX, startY: e.clientY, elX: el.x, elY: el.y };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const rect = pageRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    patchElement(d.id, {
      x: Math.round(clamp(d.elX + ((e.clientX - d.startX) / rect.width) * 100) * 10) / 10,
      y: Math.round(clamp(d.elY + ((e.clientY - d.startY) / rect.height) * 100) * 10) / 10,
    });
  };
  const onPointerUp = () => { drag.current = null; };

  const onBackgroundFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const attachment = await prepareImage(file);
      const dataUrl = `data:image/jpeg;base64,${attachment.data}`;
      if (dataUrl.length > MAX_BACKGROUND_CHARS) { toast.error("That image is too detailed. Please use a smaller one."); return; }
      setBackground(dataUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That image couldn't be used.");
    }
  };

  const previewPdf = async () => {
    try {
      const canvas = await renderCertificate(design, sample, background);
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
      pdf.save("certificate-preview.pdf");
    } catch (e) {
      toast.error(e instanceof Error ? localizeServerMessage(e.message) : "Couldn't create the preview.");
    }
  };

  const save = async () => {
    if (!name.trim() || !title.trim()) { toast.error("Please give the template a name and a certificate title."); return; }
    if (criteria !== "manual" && !courseId) { toast.error("Please choose the course this certificate depends on."); return; }
    const score = Number(minScore);
    if (criteria === "course_score" && !(score >= 0 && score <= 100)) { toast.error("The minimum score must be between 0 and 100."); return; }
    if (!profile?.school_id) { toast.error("Your profile has no school."); return; }

    const row = {
      name: name.trim(),
      certificate_title: title.trim(),
      design,
      background_image: background,
      criteria_type: criteria,
      criteria_course_id: criteria === "manual" ? null : courseId,
      min_score: criteria === "course_score" ? score : null,
      auto_issue: criteria !== "manual" && autoIssue,
      updated_at: new Date().toISOString(),
    };
    setSaving(true);
    const { error } = template
      ? await db.from("certificate_templates").update(row).eq("id", template.id)
      : await db.from("certificate_templates").insert({ ...row, school_id: profile.school_id, created_by: profile.id });
    setSaving(false);
    if (error) { toast.error(`Couldn't save: ${error.message}`); return; }
    toast.success("Template saved");
    onSaved();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold">{template ? "Edit template" : "New template"}</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={previewPdf}><FileDown className="h-4 w-4 me-1.5" />Preview PDF</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Save className="h-4 w-4 me-1.5" />}Save</Button>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4 me-1.5" />Close</Button>
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <div className="min-w-0 space-y-2">
          <div
            ref={pageRef}
            className="relative w-full rounded-lg border shadow-sm overflow-hidden select-none bg-white"
            style={{ aspectRatio: `${PAGE.width} / ${PAGE.height}`, containerType: "size" }}
            onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.base) setSelectedId(null); }}
          >
            {baseLayer && <img src={baseLayer} alt="" data-base="true" draggable={false} className="absolute inset-0 w-full h-full" />}
            {design.elements.map((el) => el.kind === "qr" ? (
              <img
                key={el.id} src={qrPreview ?? undefined} alt="QR code" draggable={false}
                onPointerDown={(e) => onPointerDown(e, el)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                className={`absolute cursor-move touch-none ${selectedId === el.id ? "outline outline-2 outline-indigo-500" : ""}`}
                style={{ left: `${el.x}%`, top: `${el.y}%`, height: `${el.size}cqh`, width: `${el.size}cqh` }}
              />
            ) : (
              <div
                key={el.id}
                onPointerDown={(e) => onPointerDown(e, el)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                className={`absolute whitespace-nowrap cursor-move touch-none ${selectedId === el.id ? "outline outline-2 outline-indigo-500" : "hover:outline hover:outline-1 hover:outline-indigo-300"}`}
                style={{
                  left: `${el.x}%`, top: `${el.y}%`, color: el.color, fontSize: `${el.size}cqh`, fontWeight: el.bold ? 700 : 400, fontFamily: FONT_STACK[el.font],
                  transform: `translate(${el.align === "center" ? "-50%" : el.align === "end" ? "-100%" : "0"}, -50%)`,
                }}
                dir="auto"
              >
                {fillPlaceholders(el.text, sample)}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Drag anything on the page to move it. Click an item to edit it.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={addText}><Plus className="h-4 w-4 me-1.5" />Add text</Button>
            {!design.elements.some((e) => e.kind === "qr") && <Button size="sm" variant="outline" onClick={addQr}><QrCode className="h-4 w-4 me-1.5" />Add QR code</Button>}
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          <Card><CardContent className="p-3 space-y-3">
            <div className="space-y-1"><Label htmlFor="ct-name" className="text-xs">Template name</Label><Input id="ct-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Course completion 2026" /></div>
            <div className="space-y-1"><Label htmlFor="ct-title" className="text-xs">Certificate title</Label><Input id="ct-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1 col-span-3">
                <Label className="text-xs">Border</Label>
                <Select value={design.frame} onValueChange={(v) => setDesign((d) => ({ ...d, frame: v as CertificateFrame }))}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="classic">Classic</SelectItem>
                    <SelectItem value="double">Double line</SelectItem>
                    <SelectItem value="modern">Modern band</SelectItem>
                    <SelectItem value="none">No border</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label htmlFor="ct-accent" className="text-xs">Border colour</Label><Input id="ct-accent" type="color" className="h-8 p-1" value={design.accent} onChange={(e) => setDesign((d) => ({ ...d, accent: e.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="ct-bg" className="text-xs">Page colour</Label><Input id="ct-bg" type="color" className="h-8 p-1" value={design.background} onChange={(e) => setDesign((d) => ({ ...d, background: e.target.value }))} /></div>
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { void onBackgroundFile(e.target.files?.[0]); e.target.value = ""; }} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4 me-1.5" />{background ? "Change background" : "Add background image"}</Button>
              {background && <Button size="sm" variant="ghost" onClick={() => setBackground(null)}>Remove</Button>}
            </div>
          </CardContent></Card>

          {selected && (
            <Card><CardContent className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{selected.kind === "qr" ? "QR code" : "Selected text"}</p>
                <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => removeElement(selected.id)}><Trash2 className="h-4 w-4 me-1" />Delete</Button>
              </div>
              {selected.kind === "text" && (
                <>
                  <Textarea rows={2} aria-label="Text" value={selected.text} onChange={(e) => patchElement(selected.id, { text: e.target.value })} />
                  <Select value="" onValueChange={(key) => patchElement(selected.id, { text: `${selected.text} {{${key}}}`.trim() })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Insert student or course details" /></SelectTrigger>
                    <SelectContent>{PLACEHOLDERS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Font</Label>
                      <Select value={selected.font} onValueChange={(v) => patchElement(selected.id, { font: v as ElementFont })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="serif">Serif</SelectItem><SelectItem value="sans">Sans</SelectItem><SelectItem value="script">Script</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Align</Label>
                      <Select value={selected.align} onValueChange={(v) => patchElement(selected.id, { align: v as ElementAlign })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="start">Left</SelectItem><SelectItem value="center">Centre</SelectItem><SelectItem value="end">Right</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label htmlFor="el-color" className="text-xs">Colour</Label><Input id="el-color" type="color" className="h-8 p-1" value={selected.color} onChange={(e) => patchElement(selected.id, { color: e.target.value })} /></div>
                    <label className="flex items-center gap-2 text-xs self-end h-8 cursor-pointer"><Checkbox checked={selected.bold} onCheckedChange={(v) => patchElement(selected.id, { bold: v === true })} />Bold</label>
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label htmlFor="el-size" className="text-xs">Size</Label>
                <input id="el-size" type="range" className="w-full" min={selected.kind === "qr" ? 8 : 1} max={selected.kind === "qr" ? 30 : 14} step={0.2} value={selected.size}
                  onChange={(e) => patchElement(selected.id, { size: Number(e.target.value) })} />
              </div>
            </CardContent></Card>
          )}

          <Card><CardContent className="p-3 space-y-3">
            <p className="text-xs font-semibold">Who can receive this certificate</p>
            <Select value={criteria} onValueChange={(v) => setCriteria(v as CertificateTemplate["criteria_type"])}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Anyone staff select (no condition)</SelectItem>
                <SelectItem value="course_completion">Students who completed a course</SelectItem>
                <SelectItem value="course_score">Students who completed a course with a minimum score</SelectItem>
              </SelectContent>
            </Select>
            {criteria !== "manual" && (
              <>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Choose a course" /></SelectTrigger>
                  <SelectContent>
                    {courses.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No courses found</div>}
                    {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
                {criteria === "course_score" && (
                  <div className="space-y-1"><Label htmlFor="ct-score" className="text-xs">Minimum score (%)</Label><Input id="ct-score" type="number" min={0} max={100} className="h-8" value={minScore} onChange={(e) => setMinScore(e.target.value)} /></div>
                )}
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <Checkbox className="mt-0.5" checked={autoIssue} onCheckedChange={(v) => setAutoIssue(v === true)} />
                  Issue automatically as soon as a student meets this condition
                </label>
              </>
            )}
          </CardContent></Card>
        </div>
      </div>
    </div>
  );
}
