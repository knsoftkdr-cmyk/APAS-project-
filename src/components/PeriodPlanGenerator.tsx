import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, Loader2, Calendar, Clock, Lock, Unlock,
  RefreshCw, Plus, ChevronDown, ChevronUp, CalendarDays, Target,
  BookOpen, ClipboardCheck, Package, Pencil, X, Check, FileText,
  Eye, Download, GraduationCap, Users, CheckCircle
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";

// ─── Custom Markdown Components (same as Lesson Plan tab) ─────────────
const LessonMarkdownComponents = {
  h1: ({ node, ...props }: any) => (
    <h1 className="text-xl font-bold mt-6 mb-4 text-foreground border-b-2 border-primary/30 pb-2 flex items-center gap-2" {...props}>
      <span className="inline-block w-1 h-6 bg-gradient-to-b from-primary to-primary/60 rounded-sm"></span>
      {props.children}
    </h1>
  ),
  h2: ({ node, ...props }: any) => (
    <h2 className="text-lg font-bold mt-5 mb-3 text-foreground flex items-center gap-2" {...props}>
      <span className="inline-block w-1 h-5 bg-primary/70 rounded-sm"></span>
      {props.children}
    </h2>
  ),
  h3: ({ node, ...props }: any) => (
    <h3 className="text-base font-semibold mt-4 mb-2 text-foreground/95" {...props}>• {props.children}</h3>
  ),
  h4: ({ node, ...props }: any) => (
    <h4 className="text-sm font-semibold mt-3 mb-2 text-foreground/90" {...props}>{props.children}</h4>
  ),
  p: ({ node, ...props }: any) => (
    <p className="text-sm leading-relaxed mb-3 text-foreground/85" {...props}>{props.children}</p>
  ),
  ul: ({ node, ...props }: any) => (
    <ul className="space-y-2 mb-3 ml-4 list-none" {...props}>{props.children}</ul>
  ),
  ol: ({ node, ...props }: any) => (
    <ol className="space-y-2 mb-3 ml-4 list-decimal list-inside" {...props}>{props.children}</ol>
  ),
  li: ({ node, ...props }: any) => (
    <li className="text-sm text-foreground/85 flex gap-2 items-start">
      <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
      <span>{props.children}</span>
    </li>
  ),
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="border-l-4 border-primary/50 pl-4 py-2 my-4 bg-primary/5 italic text-foreground/80 text-sm" {...props}>{props.children}</blockquote>
  ),
  code: ({ node, inline, ...props }: any) =>
    inline ? (
      <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-xs font-mono" {...props} />
    ) : (
      <code className="block bg-foreground/5 border border-border rounded p-3 text-xs overflow-x-auto my-3 text-foreground/80 font-mono" {...props} />
    ),
  table: ({ node, ...props }: any) => (
    <table className="w-full border-collapse text-sm my-4" {...props}>{props.children}</table>
  ),
  thead: ({ node, ...props }: any) => (
    <thead className="bg-primary/10 border-b-2 border-primary/30" {...props}>{props.children}</thead>
  ),
  th: ({ node, ...props }: any) => (
    <th className="text-left px-3 py-2 font-semibold text-foreground/90" {...props}>{props.children}</th>
  ),
  td: ({ node, ...props }: any) => (
    <td className="px-3 py-2 border-b border-border text-foreground/85" {...props}>{props.children}</td>
  ),
  strong: ({ node, ...props }: any) => (
    <strong className="font-bold text-foreground" {...props}>{props.children}</strong>
  ),
  em: ({ node, ...props }: any) => (
    <em className="italic text-foreground/80" {...props}>{props.children}</em>
  ),
  hr: ({ node, ...props }: any) => (
    <hr className="my-4 border-border" {...props} />
  ),
};

interface PeriodPlan {
  day: number;
  period: number;
  topic: string;
  objective: string;
  activity: string;
  materials: string;
  assessment: string;
  duration_minutes: number;
}

interface LessonOption {
  id: string;
  title: string;
  subject: string | null;
  topic: string | null;
  lesson_content: string | null;
  class_level: string | null;
  section: string | null;
}

interface PeriodPlanGeneratorProps {
  // no longer requires parent class/section
}

const CLASS_OPTIONS = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `Class ${i + 1}` })),
];

const DEFAULT_SECTIONS = ["A", "B", "C", "D", "E", "F"];

const getClassLabel = (val: string): string => {
  const found = CLASS_OPTIONS.find((c) => c.value === val);
  return found ? found.label : val;
};

const PeriodPlanGenerator = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");

  const [periodsPerWeek, setPeriodsPerWeek] = useState("5");
  const [periodDuration, setPeriodDuration] = useState("40");
  const [totalTeachingDays, setTotalTeachingDays] = useState("20");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<PeriodPlan | null>(null);
  const [periodPlans, setPeriodPlans] = useState<PeriodPlan[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [currentLessonId, setCurrentLessonId] = useState<string | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [selectedLessonId, setSelectedLessonId] = useState<string>("");
  const [showLessonPreview, setShowLessonPreview] = useState(false);
  const [isMarkingCompleted, setIsMarkingCompleted] = useState(false);
  const [manualForm, setManualForm] = useState<PeriodPlan>({
    day: 1, period: 1, topic: "", objective: "", activity: "",
    materials: "", assessment: "", duration_minutes: 40,
  });

  // Fetch all lessons for the selected class
  const { data: classLessons = [] } = useQuery<LessonOption[]>({
    queryKey: ["class-lessons", selectedClass],
    queryFn: async () => {
      if (!selectedClass) return [];
      const { data } = await supabase
        .from("lessons")
        .select("id, title, subject, lesson_content, class_level, section")
        .eq("class_level", getClassLabel(selectedClass))
        .order("created_at", { ascending: false });
      // topic column exists in DB but not in generated types yet, so cast
      return (data || []).map((d: any) => ({ ...d, topic: d.topic || null }));
    },
    enabled: !!selectedClass,
  });

  // Fetch unique subjects for the selected class from chapters table
  const { data: subjectsList = [] } = useQuery({
    queryKey: ["subjects-by-class", selectedClass],
    queryFn: async () => {
      if (!selectedClass) return [];
      const { data } = await supabase
        .from("chapters")
        .select("subject")
        .eq("class_level", getClassLabel(selectedClass))
        .order("subject", { ascending: true });
      // Get unique subjects
      const uniqueSubjects = Array.from(new Set((data || []).map(d => d.subject).filter(Boolean)));
      return uniqueSubjects as string[];
    },
    enabled: !!selectedClass,
  });

  // Fetch chapters for the selected class and subject
  const { data: chaptersList = [] } = useQuery({
    queryKey: ["chapters-by-class-subject", selectedClass, selectedSubject],
    queryFn: async () => {
      if (!selectedClass || !selectedSubject) return [];
      const { data } = await supabase
        .from("chapters")
        .select("id, unit_number, unit_name, subject, class_level")
        .eq("class_level", getClassLabel(selectedClass))
        .eq("subject", selectedSubject)
        .order("unit_number", { ascending: true });
      return data || [];
    },
    enabled: !!selectedClass && !!selectedSubject,
  });

  // Check if homework already assigned for selected lesson
  const { data: existingHomework } = useQuery({
    queryKey: ["homework-exists", selectedLessonId],
    queryFn: async () => {
      if (!selectedLessonId) return null;
      const { data } = await supabase
        .from("homework_assignments")
        .select("id")
        .eq("lesson_id", selectedLessonId)
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedLessonId,
  });

  const homeworkAlreadyAssigned = !!existingHomework;

  // Selected lesson object
  const selectedLesson = classLessons.find((l) => l.id === selectedLessonId) || null;

  // Fetch saved period plan for selected lesson
  const { data: savedPlan } = useQuery({
    queryKey: ["saved-period-plan", selectedLessonId],
    queryFn: async () => {
      if (!selectedLessonId) return null;
      const { data } = await supabase
        .from("period_plans")
        .select("*")
        .eq("lesson_id", selectedLessonId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedLessonId,
  });

  // When class changes, reset lesson selection and dependent fields
  useEffect(() => {
    setSelectedLessonId("");
    setSelectedSubject("");
    setSelectedChapter("");
    setPeriodPlans([]);
    setSavedPlanId(null);
    setIsLocked(false);
  }, [selectedClass]);

  // Load saved plan data
  useEffect(() => {
    if (savedPlan) {
      const planData = savedPlan.plan_data as unknown;
      setPeriodPlans(Array.isArray(planData) ? planData as PeriodPlan[] : []);
      setIsLocked(savedPlan.is_locked);
      setSavedPlanId(savedPlan.id);
      setPeriodsPerWeek(String(savedPlan.periods_per_week));
      setPeriodDuration(String(savedPlan.period_duration));
      setTotalTeachingDays(String(savedPlan.total_teaching_days));
    } else if (selectedLessonId) {
      // Reset when switching to a lesson with no saved plan
      setPeriodPlans([]);
      setSavedPlanId(null);
      setIsLocked(false);
    }
  }, [savedPlan, selectedLessonId]);

  useEffect(() => {
    if (selectedLessonId) setCurrentLessonId(selectedLessonId);
  }, [selectedLessonId]);

  const handleGenerate = async () => {
    if (!selectedLesson?.lesson_content) {
      toast.error("Selected lesson plan has no content.");
      return;
    }
    setIsGenerating(true);
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-period-plans`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            lessonContent: selectedLesson.lesson_content,
            classLevel: selectedClass,
            section: selectedSection,
            subject: selectedLesson?.subject,
            periodsPerWeek: parseInt(periodsPerWeek),
            periodDuration: parseInt(periodDuration),
            totalTeachingDays: parseInt(totalTeachingDays),
          }),
        }
      );
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Generation failed");
      }
      const data = await resp.json();
      const plans = Array.isArray(data.plan) ? data.plan : [data.plan];
      setPeriodPlans(plans);
      setIsLocked(false);
      await savePlan(plans, false);
      toast.success("Period plan generated successfully!");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate period plan");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async (index: number) => {
    if (!selectedLesson?.lesson_content) return;
    setIsRegenerating(index);
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-period-plans`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            lessonContent: selectedLesson.lesson_content,
            classLevel: selectedClass,
            section: selectedSection,
            subject: selectedLesson?.subject,
            periodsPerWeek: parseInt(periodsPerWeek),
            periodDuration: parseInt(periodDuration),
            totalTeachingDays: parseInt(totalTeachingDays),
            regeneratePeriod: index,
          }),
        }
      );
      if (!resp.ok) throw new Error("Regeneration failed");
      const data = await resp.json();
      const updated = [...periodPlans];
      updated[index] = data.plan;
      setPeriodPlans(updated);
      await savePlan(updated, isLocked);
      toast.success(`Period ${index + 1} regenerated!`);
    } catch (e: any) {
      toast.error(e.message || "Failed to regenerate");
    } finally {
      setIsRegenerating(null);
    }
  };

  const savePlan = async (plans: PeriodPlan[], locked: boolean) => {
    if (!currentLessonId || !user?.id) return;
    const payload = {
      lesson_id: currentLessonId,
      teacher_id: user.id,
      class_level: getClassLabel(selectedClass),
      section: selectedSection,
      subject: selectedLesson?.subject || null,
      periods_per_week: parseInt(periodsPerWeek),
      period_duration: parseInt(periodDuration),
      total_teaching_days: parseInt(totalTeachingDays),
      plan_data: plans as any,
      is_locked: locked,
      updated_at: new Date().toISOString(),
    };

    if (savedPlanId) {
      await supabase.from("period_plans").update(payload).eq("id", savedPlanId);
    } else {
      const { data } = await supabase.from("period_plans").insert(payload).select("id").single();
      if (data) setSavedPlanId(data.id);
    }
    queryClient.invalidateQueries({ queryKey: ["saved-period-plan"] });
  };

  const handleSaveEdit = async (index: number) => {
    if (!editForm) return;
    const updated = [...periodPlans];
    updated[index] = editForm;
    setPeriodPlans(updated);
    setEditingIndex(null);
    setEditForm(null);
    await savePlan(updated, isLocked);
    toast.success("Period updated!");
  };

  const handleToggleLock = async () => {
    const newLocked = !isLocked;
    setIsLocked(newLocked);
    await savePlan(periodPlans, newLocked);
    toast.success(newLocked ? "Plan locked" : "Plan unlocked");
  };

  const handleAddManual = async () => {
    if (!manualForm.topic.trim()) {
      toast.error("Topic is required");
      return;
    }
    const updated = [...periodPlans, { ...manualForm, duration_minutes: parseInt(periodDuration) }];
    setPeriodPlans(updated);
    setShowManualAdd(false);
    setManualForm({
      day: 1, period: 1, topic: "", objective: "", activity: "",
      materials: "", assessment: "", duration_minutes: 40,
    });
    await savePlan(updated, isLocked);
    toast.success("Period added!");
  };

  // Extract exit ticket questions from lesson content markdown
  const extractExitTicketQuestions = (content: string): string[] => {
    const questions: string[] = [];
    // Find the exit ticket section
    const exitTicketMatch = content.match(/(?:exit\s*ticket|assessment.*exit)/i);
    if (!exitTicketMatch) return questions;
    const startIdx = content.indexOf(exitTicketMatch[0]);
    const section = content.substring(startIdx);
    
    // Find next major heading (## or #) to limit scope
    const nextHeading = section.substring(exitTicketMatch[0].length).match(/^#{1,3}\s+\d+\./m);
    const endIdx = nextHeading ? section.indexOf(nextHeading[0], exitTicketMatch[0].length) : section.length;
    const exitSection = section.substring(0, endIdx);
    
    // Look for "Questions:" label and extract everything after it
    const questionsLabelMatch = exitSection.match(/questions\s*:/i);
    const questionsBlock = questionsLabelMatch 
      ? exitSection.substring(exitSection.indexOf(questionsLabelMatch[0]) + questionsLabelMatch[0].length)
      : exitSection;
    
    // Stop at known non-question labels
    const stopLabels = /^(collection\s*method|success\s*criteria|follow[\s-]*up|format|🎯)/im;
    const lines = questionsBlock.split('\n');
    
    let currentQuestion = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentQuestion) {
          questions.push(currentQuestion);
          currentQuestion = '';
        }
        continue;
      }
      // Stop if we hit a non-question section
      if (stopLabels.test(trimmed)) {
        if (currentQuestion) {
          questions.push(currentQuestion);
          currentQuestion = '';
        }
        break;
      }
      // Clean line of markdown bullets, numbers, bold markers
      const cleaned = trimmed
        .replace(/^[\s*\->#]+/, '')
        .replace(/^\d+[.)]\s*/, '')
        .replace(/\*\*/g, '')
        .trim();
      
      if (cleaned.length < 5) continue;
      // Skip meta-labels
      if (/^(format|method|criteria|follow|exit|assessment|quick|slip)/i.test(cleaned)) continue;
      
      // If line starts with a bullet/number, it's a new question
      if (/^[\d\-*]/.test(trimmed) || /^[A-Z]/.test(cleaned)) {
        if (currentQuestion) questions.push(currentQuestion);
        currentQuestion = cleaned;
      } else {
        // Continuation of previous question
        currentQuestion = currentQuestion ? currentQuestion + ' ' + cleaned : cleaned;
      }
    }
    if (currentQuestion) questions.push(currentQuestion);
    
    return questions.filter(q => q.length >= 10);
  };

  const handleMarkCompleted = async () => {
    if (!selectedLesson?.lesson_content || !user?.id) return;

    const questions = extractExitTicketQuestions(selectedLesson.lesson_content);
    if (questions.length === 0) {
      toast.error("No exit ticket questions found in this lesson plan. Please ensure the lesson has an Exit Ticket section.");
      return;
    }

    // Extract the full exit ticket markdown content
    const exitTicketContent = selectedLesson.lesson_content.includes("## 📝 Assessment") || selectedLesson.lesson_content.includes("### Assessment")
      ? selectedLesson.lesson_content.split(/##\s*📝\s*Assessment|###\s*Assessment/i)[1]?.split(/^##|^###/m)[0] || ""
      : "";

    setIsMarkingCompleted(true);
    try {
      const { error } = await supabase.from("homework_assignments").insert({
        lesson_id: selectedLessonId,
        teacher_id: user.id,
        class_level: getClassLabel(selectedClass),
        section: selectedSection.toUpperCase(),
        subject: selectedLesson.subject || null,
        topic: selectedLesson.topic || null,
        exit_ticket_content: exitTicketContent || selectedLesson.lesson_content,
        assignment_type: "auto-assigned",
        assigned_at: new Date().toISOString(),
      }) as any;
      if (error) throw error;
      toast.success(`Teaching marked complete! ${questions.length} exit ticket question(s) assigned as homework to ${getClassLabel(selectedClass)} Section ${selectedSection}.`);
      queryClient.invalidateQueries({ queryKey: ["homework-exists", selectedLessonId] });
    } catch (e: any) {
      if (e.message?.includes("duplicate")) {
        toast.error("Homework for this lesson has already been assigned.");
      } else {
        toast.error(e.message || "Failed to assign homework");
      }
    } finally {
      setIsMarkingCompleted(false);
    }
  };

  const groupedByDay = periodPlans.reduce<Record<number, PeriodPlan[]>>((acc, plan) => {
    const d = plan.day || 1;
    if (!acc[d]) acc[d] = [];
    acc[d].push(plan);
    return acc;
  }, {});

  const days = Object.keys(groupedByDay).map(Number).sort((a, b) => a - b);

  // Build dropdown label: "Class 2-A English Fun with friends"
  const getLessonLabel = (l: LessonOption) => {
    // Use stored title if it already has the correct format (e.g. "Class 2-A English Topic")
    if (l.title && /class\s*\d+-[a-z]/i.test(l.title)) {
      return l.title;
    }
    const cls = l.class_level ? getClassLabel(l.class_level) : getClassLabel(selectedClass);
    const sec = l.section || selectedSection || "";
    const sub = l.subject || "General";
    const topic = l.topic ? ` ${l.topic}` : "";
    return `${cls}-${sec} ${sub}${topic}`.replace(/\s+/g, ' ').trim();
  };

  const handleDownloadLesson = async () => {
    if (!selectedLesson?.lesson_content) return;
    const label = getLessonLabel(selectedLesson);
    const timestamp = new Date().toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).replace(/[/:]/g, '-');
    const filename = `APAS-LessonPlan-${label.replace(/[^a-zA-Z0-9 –-]/g, '')}-${timestamp}.pdf`;

    let html = selectedLesson.lesson_content;
    // Tables
    html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (_match: string, header: string, _sep: string, body: string) => {
      const headerCells = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
    });
    html = html.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^- (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.*?)$/gm, '<li>$1. $2</li>');
    html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.split('\n\n').map(para => {
      const trimmed = para.trim();
      if (!trimmed || trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<ol') || trimmed.startsWith('<table') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<hr')) return trimmed;
      return '<p>' + trimmed.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = `
      <div class="report">
        <div class="header">
          <div class="header-left">
            <div class="brand">APAS <span>Lesson Plan</span></div>
            <div class="report-label">Differentiated Lesson Plan</div>
          </div>
          <div class="header-right">
            <div class="report-date">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            <div class="status-badge">AI Generated</div>
          </div>
        </div>
        <div class="learner-card">
          <div class="lc-field"><label>Class</label><value>${getClassLabel(selectedClass)}</value><small>Section ${selectedSection}</small></div>
          <div class="lc-field"><label>Subject</label><value>${selectedLesson.subject || 'General'}</value><small>${selectedLesson.topic || ''}</small></div>
          <div class="lc-field"><label>Report Type</label><value>Lesson Plan</value><small>Differentiated</small></div>
        </div>
        <div class="content">${html}</div>
        <div class="footer">
          <div class="footer-note">This report is auto-generated by the APAS AI engine. For academic use only.</div>
          <div class="footer-apas">APAS · ${new Date().getFullYear()}</div>
        </div>
      </div>`;

    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .report { max-width: 780px; margin: 0 auto; padding: 28px 24px; font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; color: #1a1a2e; line-height: 1.6; font-size: 12px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 2px solid #1a1a2e; }
      .brand { font-family: 'DM Serif Display', Georgia, serif; font-size: 24px; color: #1a1a2e; letter-spacing: -0.5px; }
      .brand span { color: #0e9a7b; font-style: italic; }
      .report-label { font-size: 10px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #6b6b8a; margin-top: 4px; }
      .header-right { text-align: right; }
      .report-date { font-size: 12px; font-weight: 500; color: #3a3a5c; }
      .status-badge { display: inline-block; background: #0e9a7b; color: white; font-size: 9px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; padding: 3px 10px; border-radius: 20px; margin-top: 4px; }
      .learner-card { background: #1a1a2e; color: white; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
      .lc-field label { font-size: 9px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(255,255,255,0.45); display: block; margin-bottom: 3px; }
      .lc-field value { font-family: 'DM Serif Display', Georgia, serif; font-size: 16px; color: white; display: block; }
      .lc-field small { font-size: 11px; color: rgba(255,255,255,0.55); }
      .content h1 { font-family: 'DM Serif Display', Georgia, serif; font-size: 18px; color: #1a1a2e; margin: 24px 0 10px 0; padding-bottom: 6px; border-bottom: 2px solid #0e9a7b; }
      .content h2 { font-family: 'DM Serif Display', Georgia, serif; font-size: 15px; color: #1a1a2e; margin: 20px 0 8px 0; padding-left: 12px; border-left: 4px solid #0e9a7b; }
      .content h3 { font-size: 13px; font-weight: 600; color: #3a3a5c; margin: 16px 0 6px 0; }
      .content h4 { font-size: 12px; font-weight: 600; color: #6b6b8a; margin: 12px 0 4px 0; }
      .content p { margin: 6px 0; text-align: justify; color: #3a3a5c; }
      .content strong { color: #1a1a2e; font-weight: 600; }
      .content em { font-style: italic; color: #6b6b8a; }
      .content ul { list-style: none; margin: 6px 0 6px 0; padding: 0; }
      .content ul li { position: relative; padding: 3px 0 3px 18px; color: #3a3a5c; }
      .content ul li::before { content: '→'; position: absolute; left: 0; color: #0e9a7b; font-weight: 600; }
      .content table { width: 100%; border-collapse: collapse; margin: 10px 0 14px 0; font-size: 11px; }
      .content table th { text-align: left; font-size: 9px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #6b6b8a; padding: 8px 10px; border-bottom: 2px solid #e2e0d8; background: #f7f5f0; }
      .content table td { padding: 7px 10px; border-bottom: 1px solid #e2e0d8; color: #3a3a5c; vertical-align: top; }
      .content table tr:last-child td { border-bottom: none; }
      .content blockquote { background: linear-gradient(135deg, #fff1ee 0%, #fffbeb 100%); border-left: 4px solid #e55a3c; border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 12px 0; font-size: 12px; color: #3a3a5c; }
      .content hr { border: none; border-top: 1px solid #e2e0d8; margin: 16px 0; }
      .footer { border-top: 1px solid #e2e0d8; padding-top: 12px; margin-top: 20px; display: flex; justify-content: space-between; align-items: center; }
      .footer-note { font-size: 10px; color: #6b6b8a; }
      .footer-apas { font-family: 'DM Serif Display', Georgia, serif; font-size: 13px; color: #3a3a5c; font-style: italic; }
    `;
    tempDiv.appendChild(style);

    const opt = {
      margin: [10, 10, 10, 10] as [number, number, number, number],
      filename,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#f7f5f0' },
      jsPDF: { orientation: 'portrait' as const, unit: 'mm' as const, format: 'a4' as const, compress: true },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };

    const html2pdf = (await import("html2pdf.js")).default;
    html2pdf().set(opt).from(tempDiv).save();
    toast.success("PDF downloaded successfully!");
  };

  return (
    <Card className="border-2 border-primary/10 shadow-lg animate-fade-in">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2 text-primary">
            <CalendarDays className="h-5 w-5" />
            Period-wise Lesson Plan
          </CardTitle>
          {periodPlans.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleLock}
                className="gap-1.5 text-xs"
              >
                {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                {isLocked ? "Locked" : "Unlocked"}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-5 space-y-5">
        {/* Class & Section & Subject & Chapter Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="group">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">Select Class</label>
            <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setSelectedSection(""); setSelectedLessonId(""); }}>
              <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
                <SelectValue placeholder="Choose a class..." />
              </SelectTrigger>
              <SelectContent>
                {CLASS_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="flex items-center gap-2"><GraduationCap className="h-3.5 w-3.5" />{c.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="group">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">Select Section</label>
            <Select value={selectedSection} onValueChange={setSelectedSection} disabled={!selectedClass}>
              <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
                <SelectValue placeholder={!selectedClass ? "Select a class first..." : "Choose a section..."} />
              </SelectTrigger>
              <SelectContent>
                {DEFAULT_SECTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="flex items-center gap-2"><Users className="h-3.5 w-3.5" />Section {s}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="group">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">Select Subject</label>
            <Select value={selectedSubject} onValueChange={(v) => { setSelectedSubject(v); setSelectedChapter(""); }} disabled={!selectedClass}>
              <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
                <SelectValue placeholder={!selectedClass ? "Select a class first..." : subjectsList.length === 0 ? "No subjects found" : "Choose a subject..."} />
              </SelectTrigger>
              <SelectContent>
                {subjectsList.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="flex items-center gap-2"><BookOpen className="h-3.5 w-3.5" />{s}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="group">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">Select Chapter</label>
            <Select value={selectedChapter} onValueChange={setSelectedChapter} disabled={!selectedSubject}>
              <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
                <SelectValue placeholder={!selectedSubject ? "Select a subject first..." : chaptersList.length === 0 ? "No chapters found" : "Choose a chapter..."} />
              </SelectTrigger>
              <SelectContent>
                {chaptersList.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2"><BookOpen className="h-3.5 w-3.5" />Unit {c.unit_number} - {c.unit_name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {selectedClass && selectedSection && (
          <>
        {/* Lesson Plan Dropdown */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
            Select Lesson Plan
          </label>
          <Select value={selectedLessonId} onValueChange={setSelectedLessonId}>
            <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
              <SelectValue placeholder={classLessons.length === 0 ? "No lesson plans found for this class" : "Choose a lesson plan..."} />
            </SelectTrigger>
            <SelectContent>
              {classLessons.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  <span className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    {getLessonLabel(l)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {classLessons.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1.5">
              Generate a lesson plan above first, then it will appear here.
            </p>
          )}
          {/* View & Download buttons */}
          {selectedLesson && (
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setShowLessonPreview(true)}
                disabled={!selectedLesson.lesson_content}
              >
                <Eye className="h-3.5 w-3.5" /> View Lesson Plan
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={handleDownloadLesson}
                disabled={!selectedLesson.lesson_content}
              >
                <Download className="h-3.5 w-3.5" /> Download PDF
              </Button>
            </div>
          )}
        </div>

        {/* Lesson Plan Preview Dialog */}
        <Dialog open={showLessonPreview} onOpenChange={setShowLessonPreview}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                {selectedLesson ? getLessonLabel(selectedLesson) : "Lesson Plan"}
              </DialogTitle>
            </DialogHeader>
            <div className="prose prose-sm max-w-none dark:prose-invert mt-2">
              <ReactMarkdown components={LessonMarkdownComponents}>
                {selectedLesson?.lesson_content || "No content available."}
              </ReactMarkdown>
            </div>
            <div className="flex justify-end pt-3 border-t border-border">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadLesson}>
                <Download className="h-3.5 w-3.5" /> Download PDF
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Show config & actions only when a lesson is selected */}
        {selectedLessonId && (
          <>
            {/* Timetable Config */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                  Periods / Week
                </label>
                <Select value={periodsPerWeek} onValueChange={setPeriodsPerWeek} disabled={isLocked}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} periods</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                  Period Duration
                </label>
                <Select value={periodDuration} onValueChange={setPeriodDuration} disabled={isLocked}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[25, 30, 35, 40, 45, 50, 55, 60].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} minutes</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                  Teaching Days
                </label>
                <Select value={totalTeachingDays} onValueChange={setTotalTeachingDays} disabled={isLocked}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[5, 10, 15, 20, 25, 30].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} days</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || isLocked || !selectedLesson?.lesson_content}
                className="gap-2 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary shadow-lg"
              >
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Generate Period Plan (AI)</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowManualAdd(!showManualAdd)}
                disabled={isLocked}
                className="gap-2"
              >
                <Plus className="h-4 w-4" /> Create / Edit Manually
              </Button>
              <Button
                variant="outline"
                onClick={handleMarkCompleted}
                disabled={isMarkingCompleted || !selectedLesson?.lesson_content || homeworkAlreadyAssigned}
                className={`gap-2 ${homeworkAlreadyAssigned ? 'border-muted text-muted-foreground cursor-not-allowed' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`}
              >
                {homeworkAlreadyAssigned ? (
                  <><CheckCircle className="h-4 w-4" /> Teaching Completed ✓</>
                ) : isMarkingCompleted ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Assigning...</>
                ) : (
                  <><CheckCircle className="h-4 w-4" /> Mark Teaching Completed</>
                )}
              </Button>
            </div>

            {!selectedLesson?.lesson_content && (
              <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4 border border-dashed border-border">
                ⚠️ The selected lesson plan has no content. Please regenerate the lesson plan first.
              </div>
            )}
          </>
        )}

        {/* Manual Add Form */}
        {showManualAdd && !isLocked && selectedLessonId && (
          <Card className="border-dashed border-2 border-primary/20 bg-primary/5">
            <CardContent className="p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Pencil className="h-4 w-4 text-primary" /> Add New Period
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Day</label>
                  <Input
                    type="number"
                    min={1}
                    value={manualForm.day}
                    onChange={(e) => setManualForm({ ...manualForm, day: parseInt(e.target.value) || 1 })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Period</label>
                  <Input
                    type="number"
                    min={1}
                    value={manualForm.period}
                    onChange={(e) => setManualForm({ ...manualForm, period: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Topic *</label>
                <Input
                  value={manualForm.topic}
                  onChange={(e) => setManualForm({ ...manualForm, topic: e.target.value })}
                  placeholder="e.g. Introduction to Fractions"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Objective</label>
                <Input
                  value={manualForm.objective}
                  onChange={(e) => setManualForm({ ...manualForm, objective: e.target.value })}
                  placeholder="Students will be able to..."
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Activity</label>
                <Textarea
                  value={manualForm.activity}
                  onChange={(e) => setManualForm({ ...manualForm, activity: e.target.value })}
                  placeholder="Teaching activity description..."
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Materials</label>
                  <Input
                    value={manualForm.materials}
                    onChange={(e) => setManualForm({ ...manualForm, materials: e.target.value })}
                    placeholder="Textbook, whiteboard..."
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Assessment</label>
                  <Input
                    value={manualForm.assessment}
                    onChange={(e) => setManualForm({ ...manualForm, assessment: e.target.value })}
                    placeholder="Quick quiz..."
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddManual} className="gap-1.5">
                  <Check className="h-3.5 w-3.5" /> Add Period
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowManualAdd(false)}>
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Period Plans Display */}
        {periodPlans.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                {periodPlans.length} Periods across {days.length} Day{days.length !== 1 ? "s" : ""}
              </h3>
              <Badge variant="outline" className="text-xs gap-1">
                <Clock className="h-3 w-3" /> {periodDuration} min/period
              </Badge>
            </div>

            {days.map((day) => (
              <Card key={day} className="border border-border/60 overflow-hidden">
                <button
                  onClick={() => setExpandedDay(expandedDay === day ? null : day)}
                  className="w-full flex items-center justify-between p-3.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                      {day}
                    </div>
                    <span className="text-sm font-medium">Day {day}</span>
                    <Badge variant="secondary" className="text-xs">
                      {groupedByDay[day].length} period{groupedByDay[day].length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  {expandedDay === day ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>

                {expandedDay === day && (
                  <div className="border-t border-border/50">
                    {groupedByDay[day].map((plan, localIdx) => {
                      const globalIdx = periodPlans.findIndex(
                        (p) => p.day === plan.day && p.period === plan.period && p.topic === plan.topic
                      );
                      const isEditing = editingIndex === globalIdx;

                      return (
                        <div key={localIdx} className="p-4 border-b border-border/30 last:border-0">
                          {isEditing && editForm ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-xs text-muted-foreground">Topic</label>
                                  <Input value={editForm.topic} onChange={(e) => setEditForm({ ...editForm, topic: e.target.value })} />
                                </div>
                                <div>
                                  <label className="text-xs text-muted-foreground">Objective</label>
                                  <Input value={editForm.objective} onChange={(e) => setEditForm({ ...editForm, objective: e.target.value })} />
                                </div>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground">Activity</label>
                                <Textarea value={editForm.activity} onChange={(e) => setEditForm({ ...editForm, activity: e.target.value })} rows={2} />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-xs text-muted-foreground">Materials</label>
                                  <Input value={editForm.materials} onChange={(e) => setEditForm({ ...editForm, materials: e.target.value })} />
                                </div>
                                <div>
                                  <label className="text-xs text-muted-foreground">Assessment</label>
                                  <Input value={editForm.assessment} onChange={(e) => setEditForm({ ...editForm, assessment: e.target.value })} />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => handleSaveEdit(globalIdx)} className="gap-1.5">
                                  <Check className="h-3.5 w-3.5" /> Save
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setEditingIndex(null); setEditForm(null); }}>
                                  <X className="h-3.5 w-3.5" /> Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                                    Period {plan.period}
                                  </Badge>
                                  <h4 className="font-medium text-sm text-foreground">{plan.topic}</h4>
                                </div>
                                {!isLocked && (
                                  <div className="flex gap-1.5">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => { setEditingIndex(globalIdx); setEditForm({ ...plan }); }}
                                      className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleRegenerate(globalIdx)}
                                      disabled={isRegenerating === globalIdx}
                                      className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                                    >
                                      {isRegenerating === globalIdx ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <RefreshCw className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                                <div className="flex gap-2">
                                  <Target className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                                  <div>
                                    <span className="font-medium text-muted-foreground">Objective:</span>
                                    <p className="text-foreground/80">{plan.objective}</p>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <BookOpen className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                                  <div>
                                    <span className="font-medium text-muted-foreground">Activity:</span>
                                    <p className="text-foreground/80">{plan.activity}</p>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Package className="h-3.5 w-3.5 text-orange-500 mt-0.5 shrink-0" />
                                  <div>
                                    <span className="font-medium text-muted-foreground">Materials:</span>
                                    <p className="text-foreground/80">{plan.materials}</p>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <ClipboardCheck className="h-3.5 w-3.5 text-purple-500 mt-0.5 shrink-0" />
                                  <div>
                                    <span className="font-medium text-muted-foreground">Assessment:</span>
                                    <p className="text-foreground/80">{plan.assessment}</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
        </>
        )}
      </CardContent>
    </Card>
  );
};

export default PeriodPlanGenerator;
