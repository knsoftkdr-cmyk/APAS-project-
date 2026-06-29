import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Upload, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO, isWithinInterval } from "date-fns";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type EventType = "holiday" | "exam" | "class_period" | "event";

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  event_type: EventType;
  start_date: string;
  end_date: string;
  school_id: string;
}

const EVENT_COLORS: Record<EventType, { bg: string; text: string; badge: string; dot: string }> = {
  holiday:      { bg: "bg-red-50",    text: "text-red-700",    badge: "bg-red-100 text-red-700 border-red-200",    dot: "bg-red-500" },
  exam:         { bg: "bg-blue-50",   text: "text-blue-700",   badge: "bg-blue-100 text-blue-700 border-blue-200",   dot: "bg-blue-500" },
  class_period: { bg: "bg-green-50",  text: "text-green-700",  badge: "bg-green-100 text-green-700 border-green-200",  dot: "bg-green-500" },
  event:        { bg: "bg-yellow-50", text: "text-yellow-700", badge: "bg-yellow-100 text-yellow-700 border-yellow-200", dot: "bg-yellow-500" },
};

const EVENT_LABELS: Record<EventType, string> = {
  holiday: "Holiday",
  exam: "Exam",
  class_period: "Class Period",
  event: "Event",
};

const EMPTY_FORM = { title: "", description: "", event_type: "event" as EventType, start_date: "", end_date: "" };

export default function AcademicCalendar() {
  const { profile } = useAuth();
  const isAdmin = ["admin", "principal", "school_admin"].includes(profile?.role ?? "");

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadText, setUploadText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [extractedEvents, setExtractedEvents] = useState<Omit<CalendarEvent, "id" | "school_id">[]>([]);

  const fetchEvents = async () => {
    if (!profile?.school_id) return;
    setLoading(true);
    const { data } = await supabase
      .from("academic_calendar_events")
      .select("*")
      .eq("school_id", profile.school_id)
      .order("start_date");
    setEvents((data as CalendarEvent[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchEvents(); }, [profile?.school_id]);

  const daysInMonth = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startDayOfWeek = startOfMonth(currentMonth).getDay();

  const getDayEvents = (day: Date) =>
    events.filter(e =>
      isWithinInterval(day, { start: parseISO(e.start_date), end: parseISO(e.end_date) })
    );

  const openAdd = () => {
    setEditingEvent(null);
    setForm({
      ...EMPTY_FORM,
      start_date: selectedDay ? format(selectedDay, "yyyy-MM-dd") : "",
      end_date: selectedDay ? format(selectedDay, "yyyy-MM-dd") : "",
    });
    setShowForm(true);
  };

  const openEdit = (e: CalendarEvent) => {
    setEditingEvent(e);
    setForm({ title: e.title, description: e.description || "", event_type: e.event_type, start_date: e.start_date, end_date: e.end_date });
    setShowForm(true);
  };

  const saveEvent = async () => {
    if (!form.title || !form.start_date || !form.end_date) { toast.error("Title and dates are required"); return; }
    setSaving(true);
    const payload = { ...form, school_id: profile!.school_id, created_by: profile!.id };
    const { error } = editingEvent
      ? await supabase.from("academic_calendar_events").update(payload).eq("id", editingEvent.id)
      : await supabase.from("academic_calendar_events").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editingEvent ? "Event updated" : "Event added");
    setShowForm(false);
    fetchEvents();
  };

  const deleteEvent = async (id: string) => {
    const { error } = await supabase.from("academic_calendar_events").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Event deleted");
    fetchEvents();
  };

  const handleFileUpload = async (file: File) => {
    const name = file.name.toLowerCase();
    setReadingFile(true);
    try {
      if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
        const allRows: string[] = [];
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd" });
          rows.forEach((row: any[]) => {
            if (!row || row.length === 0) return;
            const cells = row.map((c: any) => (c === null || c === undefined ? "" : String(c).trim()));
            if (cells.some(c => c)) allRows.push(cells.join("\t"));
          });
        });
        const text = allRows.join("\n");
        setUploadText(text);
        toast.success(`Excel file read (${workbook.SheetNames.length} sheet${workbook.SheetNames.length > 1 ? "s" : ""}) — click Extract Events`);

      } else if (name.endsWith(".docx")) {
        const buffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
        setUploadText(result.value);
        toast.success("Word document read — click Extract Events");

      } else if (name.endsWith(".doc")) {
        toast.error(".doc (old Word format) isn't supported — please save as .docx and re-upload, or paste the text manually.");

      } else if (name.endsWith(".pdf")) {
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        const pageTexts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map((item: any) => item.str || "").join(" ");
          pageTexts.push(pageText);
        }
        const text = pageTexts.join("\n");
        setUploadText(text);
        if (!text.trim()) {
          toast.error("No selectable text found — this PDF may be a scanned image. Please paste the content manually.");
        } else {
          toast.success(`PDF read (${pdf.numPages} page${pdf.numPages > 1 ? "s" : ""}) — click Extract Events`);
        }

      } else {
        const text = await file.text();
        setUploadText(text);
        toast.success("File loaded — click Extract Events");
      }
    } catch (err) {
      toast.error("Could not read this file. Please paste the content manually.");
    }
    setReadingFile(false);
  };

  const MONTH_MAP: Record<string, string> = {
    jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
    jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    january:"01",february:"02",march:"03",april:"04",june:"06",
    july:"07",august:"08",september:"09",october:"10",november:"11",december:"12"
  };

  const toYMD = (day: string, month: string, year?: string): string => {
    const y = year || String(new Date().getFullYear());
    const m = MONTH_MAP[month.toLowerCase()] || month.padStart(2,"0");
    return `${y}-${m}-${day.padStart(2,"0")}`;
  };

  const guessEventType = (title: string): EventType => {
    const t = title.toLowerCase();
    if (/holiday|vacation|break|diwali|christmas|eid|pongal|holi|independence|republic|gandhi|onam|ugadi|dasara|navratri/.test(t)) return "holiday";
    if (/exam|test|assessment|quiz|evaluation|board|unit test|mid term|final|annual exam/.test(t)) return "exam";
    if (/term|semester|class begin|school open|school reopen|school start|working day/.test(t)) return "class_period";
    return "event";
  };

  const parseTextToEvents = (text: string): Omit<CalendarEvent, "id" | "school_id">[] => {
    const results: Omit<CalendarEvent, "id" | "school_id">[] = [];
    const year = String(new Date().getFullYear());
    const lines = text.split(/\n|\r\n|\r/).map((l: string) => l.trim()).filter(Boolean);

    // Detect current section type for Excel files with section headers
    let currentSection: EventType = "event";

    for (const line of lines) {
      // Skip header-like lines and detect section
      if (/^(s\.?no|sr\.?no|#|description|month|day|from|to)$/i.test(line)) continue;

      // Detect section headers like "Date	Holiday" or "Exam	Start Date"
      if (/^date\s*(\t|,)\s*holiday$/i.test(line)) { currentSection = "holiday"; continue; }
      if (/^exam\s*(\t|,)\s*start\s*date$/i.test(line)) { currentSection = "exam"; continue; }
      if (/^event\s*(\t|,)/i.test(line)) { currentSection = "event"; continue; }
      if (/^class\s*(\t|,)/i.test(line)) { currentSection = "class_period"; continue; }

      // Handle tab-separated Excel rows: "2026-08-15	Independence Day" or "FA-1	2026-09-07"
      const tabParts = line.split("\t").map((p: string) => p.trim()).filter(Boolean);
      if (tabParts.length >= 2) {
        // Pattern: YYYY-MM-DD 	 Title (holiday/event style)
        const isoDate1 = tabParts[0].match(/^(\d{4}-\d{2}-\d{2})$/);
        if (isoDate1) {
          const title = tabParts[1];
          const endDate = tabParts[2]?.match(/^(\d{4}-\d{2}-\d{2})$/) ? tabParts[2] : tabParts[0];
          results.push({ title, event_type: currentSection || guessEventType(title), start_date: tabParts[0], end_date: endDate, description: "" });
          continue;
        }
        // Pattern: Title 	 YYYY-MM-DD (exam style: "FA-1	2026-09-07")
        const isoDate2 = tabParts[1].match(/^(\d{4}-\d{2}-\d{2})$/);
        if (isoDate2) {
          const title = tabParts[0];
          const endDate = tabParts[2]?.match(/^(\d{4}-\d{2}-\d{2})$/) ? tabParts[2] : tabParts[1];
          results.push({ title, event_type: currentSection || guessEventType(title), start_date: tabParts[1], end_date: endDate, description: "" });
          continue;
        }
      }

      // Pattern 1: "Title: Jan 5 - Jan 10" or "Title: Jan 5 to Jan 10"
      const p1 = line.match(/^(.+?)[\s:–-]+(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|-|–)\s*(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i);
      if (p1) {
        const [,title,,m1,d1,m2,d2,yr] = p1;
        const t = title.trim();
        if (MONTH_MAP[m1.toLowerCase()] && MONTH_MAP[m2.toLowerCase()]) {
          results.push({ title: t, event_type: guessEventType(t), start_date: toYMD(d1,m1,yr||year), end_date: toYMD(d2,m2,yr||year), description: "" });
          continue;
        }
      }

      // Pattern 2: "Title: Jan 5" or "Title - Jan 5, 2026"
      const p2 = line.match(/^(.+?)[\s:–-]+(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/i);
      if (p2) {
        const [,title,,m,d,yr] = p2;
        const t = title.trim();
        if (MONTH_MAP[m.toLowerCase()]) {
          const date = toYMD(d,m,yr||year);
          results.push({ title: t, event_type: guessEventType(t), start_date: date, end_date: date, description: "" });
          continue;
        }
      }

      // Pattern 3: "DD/MM/YYYY - DD/MM/YYYY Title" or "DD-MM-YYYY Title"
      const p3 = line.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*(?:to|-|–)?\s*(?:(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4}))?\s+(.+)$/);
      if (p3) {
        const [,d1,m1,y1,d2,m2,y2,title] = p3;
        const t = title.trim();
        const start = `${y1}-${m1.padStart(2,"0")}-${d1.padStart(2,"0")}`;
        const end = d2 ? `${y2}-${m2.padStart(2,"0")}-${d2.padStart(2,"0")}` : start;
        results.push({ title: t, event_type: guessEventType(t), start_date: start, end_date: end, description: "" });
        continue;
      }

      // Pattern 4: Excel-style "Title	DD/MM/YYYY	DD/MM/YYYY" (tab separated)
      const p4 = line.split(/	/);
      if (p4.length >= 2) {
        const dateMatch = p4[1]?.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (dateMatch) {
          const [,d,m,y] = dateMatch;
          const start = `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
          const endMatch = p4[2]?.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
          const end = endMatch ? `${endMatch[3]}-${endMatch[2].padStart(2,"0")}-${endMatch[1].padStart(2,"0")}` : start;
          const t = p4[0].trim();
          if (t) results.push({ title: t, event_type: guessEventType(t), start_date: start, end_date: end, description: "" });
          continue;
        }
      }
    }
    return results;
  };

  const extractEvents = async () => {
    if (!uploadText.trim()) { toast.error("Please paste or upload document content"); return; }
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-calendar-events", {
        body: { document_text: uploadText },
      });

      if (error) {
        toast.error("AI extraction failed: " + error.message + " — falling back to manual parsing");
        const fallback = parseTextToEvents(uploadText);
        setExtractedEvents(fallback);
        setExtracting(false);
        return;
      }

      if (data?.error) {
        toast.error("AI extraction failed: " + data.error + " — falling back to manual parsing");
        const fallback = parseTextToEvents(uploadText);
        setExtractedEvents(fallback);
        setExtracting(false);
        return;
      }

      const events = data?.events || [];
      if (events.length === 0) {
        toast.error("No events detected in this document.");
      } else {
        setExtractedEvents(events);
        toast.success(`AI found ${events.length} events — review and confirm`);
      }
    } catch (err) {
      toast.error("Extraction failed. Please add events manually.");
    }
    setExtracting(false);
  };

  const saveExtractedEvents = async () => {
    if (!extractedEvents.length) return;
    setSaving(true);
    const payload = extractedEvents.map(e => ({ ...e, school_id: profile!.school_id, created_by: profile!.id }));
    const { error } = await supabase.from("academic_calendar_events").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${extractedEvents.length} events saved to calendar`);
    setShowUpload(false);
    setExtractedEvents([]);
    setUploadText("");
    fetchEvents();
  };

  const selectedDayEvents = selectedDay ? getDayEvents(selectedDay) : [];
  const upcomingEvents = events.filter(e => parseISO(e.end_date) >= new Date()).slice(0, 8);

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Academic Calendar</h1>
            <p className="text-muted-foreground text-sm mt-1">School events, holidays, exams and term dates</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowUpload(true)}>
                <Upload className="h-4 w-4 mr-2" /> Upload Document
              </Button>
              <Button onClick={openAdd}>
                <Plus className="h-4 w-4 mr-2" /> Add Event
              </Button>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex gap-4 flex-wrap">
          {(Object.entries(EVENT_LABELS) as [EventType, string][]).map(([type, label]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-full ${EVENT_COLORS[type].dot}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Grid */}
          <div className="lg:col-span-2 bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-center justify-between mb-5">
              <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="text-lg font-semibold">{format(currentMonth, "MMMM yyyy")}</h2>
              <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 mb-2">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: startDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
              {daysInMonth.map(day => {
                const dayEvents = getDayEvents(day);
                const isToday = isSameDay(day, new Date());
                const isSelected = selectedDay && isSameDay(day, selectedDay);
                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setSelectedDay(selectedDay && isSameDay(day, selectedDay) ? null : day)}
                    className={`relative min-h-[64px] p-1.5 rounded-lg text-left transition-all border ${
                      isSelected ? "border-primary bg-primary/5" :
                      isToday ? "border-primary/40 bg-primary/5" :
                      "border-transparent hover:border-border hover:bg-muted/50"
                    }`}
                  >
                    <span className={`text-xs font-medium block mb-1 ${isToday ? "text-primary font-bold" : "text-foreground"}`}>
                      {format(day, "d")}
                    </span>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 2).map(e => (
                        <div key={e.id} className={`text-[10px] truncate px-1 py-0.5 rounded ${EVENT_COLORS[e.event_type].bg} ${EVENT_COLORS[e.event_type].text} font-medium`}>
                          {e.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 2} more</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side Panel */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">
                {selectedDay ? format(selectedDay, "EEEE, MMM d") : "Upcoming Events"}
              </h3>
              {selectedDay && (
                <button onClick={() => setSelectedDay(null)} className="text-xs text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-2">
                {(selectedDay ? selectedDayEvents : upcomingEvents).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    {selectedDay ? "No events on this day" : "No upcoming events"}
                  </p>
                ) : (
                  (selectedDay ? selectedDayEvents : upcomingEvents).map(e => (
                    <div key={e.id} className={`p-2.5 rounded-lg border ${EVENT_COLORS[e.event_type].badge}`}>
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{e.title}</p>
                          <p className="text-[10px] opacity-70 mt-0.5">
                            {e.start_date === e.end_date
                              ? format(parseISO(e.start_date), "MMM d, yyyy")
                              : `${format(parseISO(e.start_date), "MMM d")} – ${format(parseISO(e.end_date), "MMM d, yyyy")}`}
                          </p>
                          <Badge variant="outline" className="mt-1 text-[9px] py-0 px-1 h-4">
                            {EVENT_LABELS[e.event_type]}
                          </Badge>
                          {e.description && <p className="text-[10px] opacity-60 mt-1 line-clamp-2">{e.description}</p>}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1 shrink-0 ml-1">
                            <button onClick={() => openEdit(e)} className="p-1 rounded hover:bg-black/10 transition-colors">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button onClick={() => deleteEvent(e.id)} className="p-1 rounded hover:bg-black/10 transition-colors text-red-500">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {isAdmin && (
              <Button size="sm" variant="outline" className="w-full mt-4" onClick={openAdd}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {selectedDay ? `Add event for ${format(selectedDay, "MMM d")}` : "Add Event"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingEvent ? "Edit Event" : "Add Event"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Title *</Label>
              <Input className="mt-1" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Diwali Holiday" />
            </div>
            <div>
              <Label>Event Type *</Label>
              <Select value={form.event_type} onValueChange={v => setForm(f => ({ ...f, event_type: v as EventType }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="holiday">🔴 Holiday</SelectItem>
                  <SelectItem value="exam">🔵 Exam</SelectItem>
                  <SelectItem value="class_period">🟢 Class Period</SelectItem>
                  <SelectItem value="event">🟡 Event</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date *</Label>
                <Input className="mt-1" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div>
                <Label>End Date *</Label>
                <Input className="mt-1" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea className="mt-1" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional details..." rows={2} />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={saveEvent} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingEvent ? "Update Event" : "Save Event"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={v => { setShowUpload(v); if (!v) { setExtractedEvents([]); setUploadText(""); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Academic Calendar Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); }}
              onClick={() => document.getElementById("cal-file-input")?.click()}
            >
              {readingFile ? (
                <Loader2 className="h-8 w-8 mx-auto text-muted-foreground mb-2 animate-spin" />
              ) : (
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              )}
              <p className="text-sm font-medium">{readingFile ? "Reading document..." : "Drop your document here"}</p>
              <p className="text-xs text-muted-foreground mt-1">Supports PDF, Word (.docx), Excel, CSV, TXT</p>
              <input id="cal-file-input" type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
            </div>

            <div>
              <Label>Or paste document content directly</Label>
              <Textarea
                className="mt-1"
                value={uploadText}
                onChange={e => setUploadText(e.target.value)}
                placeholder={`Paste your academic calendar here, e.g.:
Diwali Holiday: Oct 20-21
Unit Test 1: Aug 5-10
Annual Day: Dec 15
Term 1: June 1 - October 31`}
                rows={7}
              />
            </div>

            <Button className="w-full" onClick={extractEvents} disabled={extracting || !uploadText.trim()}>
              {extracting
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Extracting with AI...</>
                : "✨ Extract Events with AI"}
            </Button>

            {extractedEvents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{extractedEvents.length} events extracted — review before saving</Label>
                </div>
                <div className="max-h-52 overflow-y-auto space-y-1.5 border border-border rounded-lg p-2 bg-muted/20">
                  {extractedEvents.map((e, i) => (
                    <div key={i} className={`p-2 rounded-lg text-xs border flex items-start justify-between gap-2 ${EVENT_COLORS[e.event_type as EventType]?.badge || "bg-muted border-border"}`}>
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold">{e.title}</span>
                        <span className="ml-2 opacity-70">
                          {e.start_date === e.end_date ? e.start_date : `${e.start_date} → ${e.end_date}`}
                        </span>
                        <Badge variant="outline" className="ml-2 text-[9px] py-0">{EVENT_LABELS[e.event_type as EventType] || e.event_type}</Badge>
                      </div>
                      <button onClick={() => setExtractedEvents(ev => ev.filter((_, j) => j !== i))}>
                        <X className="h-3 w-3 shrink-0" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button className="w-full" onClick={saveExtractedEvents} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save {extractedEvents.length} Events to Calendar
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
