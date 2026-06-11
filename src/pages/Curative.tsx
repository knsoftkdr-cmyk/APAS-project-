import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useGamification } from "@/hooks/useGamification";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { TopicSelector } from "@/components/TopicSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, Loader2, Send, GraduationCap, MessageSquare, Bot, User, Trash2, Users, BookOpen, Lock, Download, Globe, Check, Clock, BookMarked, Wand2, CalendarDays, FileText, Briefcase, Eye, Home, CheckCircle, Plus, X, History } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import teacherAiAvatar from "@/assets/teacher-ai-avatar.png";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

const CLASS_OPTIONS = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `Class ${i + 1}` })),
];

// ─── Custom Markdown Components ───────────────────────────────────────
const MarkdownComponents = {
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
    <h3 className="text-base font-semibold mt-4 mb-2 text-foreground/95" {...props}>
      • {props.children}
    </h3>
  ),
  h4: ({ node, ...props }: any) => (
    <h4 className="text-sm font-semibold mt-3 mb-2 text-foreground/90" {...props}>
      {props.children}
    </h4>
  ),
  p: ({ node, ...props }: any) => (
    <p className="text-sm leading-relaxed mb-3 text-foreground/85" {...props}>
      {props.children}
    </p>
  ),
  ul: ({ node, ...props }: any) => (
    <ul className="space-y-2 mb-3 ml-4 list-none" {...props}>
      {props.children}
    </ul>
  ),
  ol: ({ node, ...props }: any) => (
    <ol className="space-y-2 mb-3 ml-4 list-decimal list-inside" {...props}>
      {props.children}
    </ol>
  ),
  li: ({ node, ...props }: any) => (
    <li className="text-sm text-foreground/85 flex gap-2 items-start">
      <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
      <span>{props.children}</span>
    </li>
  ),
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="border-l-4 border-primary/50 pl-4 py-2 my-4 bg-primary/5 italic text-foreground/80 text-sm" {...props}>
      {props.children}
    </blockquote>
  ),
  code: ({ node, inline, ...props }: any) => 
    inline ? (
      <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-xs font-mono" {...props} />
    ) : (
      <code className="block bg-foreground/5 border border-border rounded p-3 text-xs overflow-x-auto my-3 text-foreground/80 font-mono" {...props} />
    ),
  pre: ({ node, ...props }: any) => (
    <pre className="block bg-foreground/5 border border-border rounded p-4 overflow-x-auto my-3 text-xs" {...props}>
      {props.children}
    </pre>
  ),
  table: ({ node, ...props }: any) => (
    <table className="w-full border-collapse text-sm my-4" {...props}>
      {props.children}
    </table>
  ),
  thead: ({ node, ...props }: any) => (
    <thead className="bg-primary/10 border-b-2 border-primary/30" {...props}>
      {props.children}
    </thead>
  ),
  th: ({ node, ...props }: any) => (
    <th className="text-left px-3 py-2 font-semibold text-foreground/90" {...props}>
      {props.children}
    </th>
  ),
  td: ({ node, ...props }: any) => (
    <td className="px-3 py-2 border-b border-border text-foreground/85" {...props}>
      {props.children}
    </td>
  ),
  strong: ({ node, ...props }: any) => (
    <strong className="font-bold text-foreground" {...props}>
      {props.children}
    </strong>
  ),
  em: ({ node, ...props }: any) => (
    <em className="italic text-foreground/80" {...props}>
      {props.children}
    </em>
  ),
  a: ({ node, href, children, ...props }: any) => {
    const url: string = href || "";
    const isYT = /youtube\.com|youtu\.be/i.test(url);
    let label: React.ReactNode = children;
    if (isYT) {
      let topic = "";
      try {
        const u = new URL(url);
        const q = u.searchParams.get("search_query") || u.searchParams.get("q") || "";
        topic = decodeURIComponent(q.replace(/\+/g, " ")).trim();
      } catch { /* ignore */ }
      label = topic ? `▶ Watch on YouTube: ${topic}` : "▶ Watch on YouTube";
    }
    return (
      <a
        href={url}
        className="text-primary hover:text-primary/80 underline font-medium"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {label}
      </a>
    );
  },
  hr: ({ node, ...props }: any) => (
    <hr className="my-4 border-border" {...props} />
  ),
};

const DEFAULT_SECTIONS = ["A", "B", "C", "D", "E", "F"];

const CURRICULUM_OPTIONS = [
  { value: "ib", label: "Inquiry-Based (IB)" },
  { value: "cbse", label: "CBSE" },
  { value: "cambridge", label: "Project-Based Learning (Cambridge)" },
  { value: "ai", label: "AI (Auto-detect)" },
];

// Converts CLASS_OPTIONS value ("1", "2") to chapter_subtopics format ("Class1", "Class2")
const toSubtopicClass = (val: string): string => {
  if (!val || isNaN(Number(val))) return val; // nursery, lkg, ukg pass through as-is
  return `Class${val}`;
};

// AFTER
const getClassFolder = (classValue: string): string => {
  const folderMap: Record<string, string> = { nursery: "nursery", lkg: "lkg", ukg: "ukg" };
  for (let i = 1; i <= 10; i++) folderMap[`${i}`] = `class ${i}`;
  return folderMap[classValue] || classValue;
};

const extractSubjectName = (filename: string): string => {
  const name = filename.replace(/\.pdf$/i, "").toLowerCase();
  const cleaned = name.replace(/^class\s*\d+\s*/i, "").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

// ─── Utility to extract and detect period count ──────────────────────
const extractPeriodsCount = (selectedPeriodsValue: string, lessonContent: string): number => {
  // First, try to use the selected periods value
  const selectedCount = parseInt(selectedPeriodsValue) || 1;
  
  // Then, verify by parsing the content to auto-detect periods
  const periodMatches = lessonContent.match(/## 📅 PERIOD (\d+)/g);
  if (periodMatches && periodMatches.length > 0) {
    // Extract the highest period number found
    const periodNumbers = periodMatches.map((match) => {
      const num = match.match(/PERIOD (\d+)/)?.[1];
      return num ? parseInt(num) : 0;
    });
    const maxPeriodFound = Math.max(...periodNumbers);
    // Use the maximum found, but fallback to selected if content parsing fails
    return maxPeriodFound > 0 ? maxPeriodFound : selectedCount;
  }
  
  // Fallback: return selected periods count
  return selectedCount;
};

// ─── Extract all periods from lesson content ───────────────────────────
const extractPeriods = (lessonContent: string): Array<{ periodNumber: number; title: string }> => {
  const periods: Array<{ periodNumber: number; title: string }> = [];
  
  // Remove intro text 
  const cleanContent = lessonContent.replace(/^[\s\S]*?(##|📝)/m, '$1');
  
  // Pattern 1: Multi-period format "## 📅 PERIOD 1 — Title"
  let periodRegex = /##\s*📅\s*PERIOD\s+(\d+)\s*[—-]\s*([^(\n]+)/gi;
  let match;
  
  while ((match = periodRegex.exec(cleanContent)) !== null) {
    const periodNumber = parseInt(match[1]);
    const title = match[2].trim();
    
    if (!periods.find(p => p.periodNumber === periodNumber)) {
      periods.push({ periodNumber, title });
    }
  }
  
  // Pattern 2: If no periods found, check for single-period format
  // (sections numbered like 📝 1. Learning Objectives, 📝 7. Assessment)
  if (periods.length === 0) {
    const hasAssessmentSection = /📝\s*\d+\.\s*Assessment|###\s*Assessment/i.test(cleanContent);
    if (hasAssessmentSection) {
      periods.push({ periodNumber: 1, title: 'Main Content' });
    }
  }
  
  return periods.sort((a, b) => a.periodNumber - b.periodNumber);
};

// ─── Extract exit ticket for a specific period ────────────────────────
const extractExitTicket = (lessonContent: string, periodNumber: number): string => {
  if (!lessonContent) {
    console.log("No lesson content provided");
    return "";
  }

  const cleanContent = lessonContent.replace(/^[\s\S]*?(##|📝)/m, '$1');
  console.log("Extracting exit ticket for period:", periodNumber);
  console.log("Lesson content length:", cleanContent.length);
  
  // Check if multi-period or single-period format
  const isMultiPeriod = /##\s*📅\s*PERIOD\s+\d+/i.test(cleanContent);
  console.log("Is multi-period format:", isMultiPeriod);
  
  if (isMultiPeriod) {
    // Multi-period: Extract from "## 📅 PERIOD X" section - be more flexible with the ending
    let periodRegex = new RegExp(
      `##\\s*📅\\s*PERIOD\\s+${periodNumber}[\\s\\S]*?(?=##\\s*📅|$)`,
      "i"
    );
    let periodMatch = cleanContent.match(periodRegex);
    
    console.log("Period match found:", !!periodMatch);
    
    if (!periodMatch) {
      // Try alternate period format without emoji
      periodRegex = new RegExp(
        `##\\s*PERIOD\\s+${periodNumber}[\\s\\S]*?(?=##\\s*PERIOD|##|$)`,
        "i"
      );
      periodMatch = cleanContent.match(periodRegex);
      console.log("Alternate period match found:", !!periodMatch);
    }
    
    if (!periodMatch) {
      console.log("No period match found");
      return "";
    }
    
    const periodContent = periodMatch[0];
    console.log("Period content length:", periodContent.length);
    console.log("Period content (first 500 chars):", periodContent.substring(0, 500));
    
    // Log all section headers found in period
    const headers = periodContent.match(/###\s*[^\n]+/g);
    console.log("Section headers found:", headers);
    
    // First try: Look for "7. Assessment — Exit Ticket" or "📝 7." section (Evaluate Phase)
    let exitTicketMatch = null;
    
    // Try with various patterns for section 7
    const evaluatePatterns = [
      /###\s*📝?\s*7\.?\s*Assessment[\s\S]*?(?=###|$)/i,
      /###\s*📝?\s*7\.?\s*(?:Assessment|Evaluate)[\s\S]*?(?=###|$)/i,
      /###\s*📝\s*Assessment.*?Evaluate.*?Phase[\s\S]*?(?=###|$)/i,
      /###\s*(?:\d+\.?\s+)?Evaluate\s*Phase[\s\S]*?(?=###|$)/i,
      /###\s*Assessment.*?Exit Ticket[\s\S]*?(?=###|$)/i,
      /###\s*\d+\.[\s\S]*?Exit Ticket[\s\S]*?(?=###|$)/i,
    ];
    
    for (const pattern of evaluatePatterns) {
      exitTicketMatch = periodContent.match(pattern);
      if (exitTicketMatch) {
        console.log("Found exit ticket with pattern:", pattern);
        break;
      }
    }
    
    const result = exitTicketMatch ? exitTicketMatch[0].trim() : "";
    console.log("Exit ticket result length:", result.length);
    if (result.length === 0) {
      console.log("No matching section found. Available content:", periodContent);
    }
    return result;
  } else {
    // Single-period: Extract from various assessment patterns
    let exitTicketMatch = null;
    
    const singlePeriodPatterns = [
      /📝\s*\d+\.\s*Assessment[\s\S]*?(?=📝\s*\d+\.|##|$)/i,
      /###\s*(?:\d+\.?\s+)?Evaluate\s*Phase[\s\S]*?(?=###|$)/i,
      /###\s*Assessment[\s\S]*?(?=###|$)/i,
      /###\s*(?:\d+\.?\s+)?(?:Assessment|Exit Ticket|Evaluation)[\s\S]*?(?=###|$)/i,
    ];
    
    for (const pattern of singlePeriodPatterns) {
      exitTicketMatch = cleanContent.match(pattern);
      if (exitTicketMatch) {
        console.log("Found exit ticket with pattern:", pattern);
        break;
      }
    }
    
    return exitTicketMatch ? exitTicketMatch[0].trim() : "";
  }
};

// ─── Extract questions from exit ticket content ───────────────────────
const extractQuestionsFromExitTicket = (exitTicketContent: string): string[] => {
  if (!exitTicketContent) return [];
  
  // Remove markdown headers and metadata lines
  let cleanContent = exitTicketContent
    .replace(/^###\s*Assessment[\s\S]*?\n/i, '') // Remove header
    .replace(/^(📝\s*\d+\.\s*)?Assessment[^\n]*\n/i, '') // Remove Assessment title
    .replace(/^(Format:|Collection Method:|Success Criteria:|Follow-up:)[^\n]*\n?/gim, '') // Remove metadata
    .replace(/^(Format|Collection|Success|Follow).*$/gm, '') // Remove info lines
    .trim();
  
  // Extract numbered questions (1. 2. 3. etc.)
  const questionPattern = /^\s*\d+\.\s*(.+?)(?=^\s*\d+\.|$)/gm;
  const questions: string[] = [];
  let match;
  
  while ((match = questionPattern.exec(cleanContent)) !== null) {
    const question = match[1].trim();
    if (question && question.length > 0) {
      questions.push(question);
    }
  }
  
  // If no numbered questions found, try to extract from bullet points
  if (questions.length === 0) {
    const bulletPattern = /^[\s\-*•]\s*(.+?)$/gm;
    while ((match = bulletPattern.exec(cleanContent)) !== null) {
      const question = match[1].trim();
      if (question && question.length > 0 && !question.match(/^(Format|Collection|Success|Follow)/i)) {
        questions.push(question);
      }
    }
  }
  
  // If still no questions, split by line breaks and filter
  if (questions.length === 0) {
    const lines = cleanContent.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && 
             !trimmed.match(/^(Format|Collection|Success|Follow|Method|Criteria)/i) &&
             trimmed.length > 10; // Avoid very short lines
    });
    return lines.slice(0, 5); // Return first 5 lines as questions
  }
  
  return questions;
};

// ─── Extract period title and topic ────────────────────────────────────
const extractPeriodInfo = (lessonContent: string, periodNumber: number): { title: string; topic: string } => {
  const cleanContent = lessonContent.replace(/^[\s\S]*?(##|📝)/m, '$1');
  
  // Check if multi-period or single-period format
  const isMultiPeriod = /##\s*📅\s*PERIOD\s+\d+/i.test(cleanContent);
  
  if (isMultiPeriod) {
    // Extract from "## 📅 PERIOD X — Title" or "## 📅 PERIOD X: Title"
    const periodRegex = new RegExp(
      `##\\s*📅\\s*PERIOD\\s+${periodNumber}\\s*(?:[—:-]\\s*)?([^\\n]+)`,
      "i"
    );
    const matches = cleanContent.match(periodRegex);
    let title = matches ? matches[1].trim() : `Period ${periodNumber}`;
    
    // Clean up title - remove extra formatting
    title = title.replace(/\s*\(\d+\s*min(?:utes?)?\s*\).*/i, '').trim();
    
    return { title, topic: title };
  } else {
    // Single-period: Extract main topic from title or first section
    const titleRegex = /###\s*([^\n]+)|📝\s*\d+\.\s*([^\n]+)/i;
    const matches = cleanContent.match(titleRegex);
    const title = matches ? (matches[1] || matches[2] || 'Main Content').trim() : 'Main Content';
    return { title, topic: title };
  }
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface TextbookFile {
  fileName: string;
  subject: string;
  chapter: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/curative-assistant`;

async function streamChat({
  selectedClass, section, subject, prompt, mode, chatHistory, schoolId, onDelta, onDone, onError,
}: {
  selectedClass: string; section: string; subject: string; prompt: string;
  mode: "generate" | "chat"; chatHistory: ChatMessage[]; schoolId: string | null;
  onDelta: (text: string) => void; onDone: () => void; onError: (msg: string) => void;
}) {
  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ selectedClass, section, subject, prompt, mode, chatHistory, schoolId }),
  });

  if (!resp.ok) {
    let errMsg = "Failed to get AI response";
    try { 
      const errData = await resp.json();
      errMsg = errData.error || errMsg;
    } catch {}
    onError(errMsg);
    return;
  }
  
  if (!resp.body) {
    onError("No response body");
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let textBuffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true });
      
      const lines = textBuffer.split("\n");
      textBuffer = lines[lines.length - 1];
      
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line || !line.startsWith("data: ")) continue;
        
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    }

    // Process any remaining buffer
    if (textBuffer.trim() && textBuffer.trim().startsWith("data: ")) {
      const jsonStr = textBuffer.slice(6).trim();
      if (jsonStr !== "[DONE]") {
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        } catch (e) {
          // Skip any remaining invalid JSON
        }
      }
    }
  } catch (e: any) {
    onError("Error reading stream: " + e.message);
    return;
  }

  onDone();
}

const Curative = () => {
  const { profile, user } = useAuth();
  const { awardXp } = useGamification();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [selectedClass, setSelectedClass] = useState(searchParams.get("class") || "");
  const [academicYear, setAcademicYear] = useState(searchParams.get("academicYear") || "2025-26");
  const [selectedSection, setSelectedSection] = useState(searchParams.get("section") || "");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedCurriculum, setSelectedCurriculum] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [topicValue, setTopicValue] = useState("");
  const [selectedSubtopic, setSelectedSubtopic] = useState("");
  const [selectedPeriods, setSelectedPeriods] = useState("1");
  const [periodDuration, setPeriodDuration] = useState("40");
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasGeneratedContent, setHasGeneratedContent] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [extractedChapters, setExtractedChapters] = useState<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // ─── Chat history persistence (localStorage) ──────────────────────────
  const historyKey = user?.id ? `curative-chat-history-${user.id}` : null;

  type ChatSession = {
    id: string;
    title: string;
    classLabel: string;
    section: string;
    subject: string;
    classValue?: string;
    sectionValue?: string;
    subjectValue?: string;
    messages: ChatMessage[];
    updatedAt: number;
  };

  const loadHistory = useCallback((): ChatSession[] => {
    if (!historyKey) return [];
    try {
      const raw = localStorage.getItem(historyKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ChatSession[];
      return Array.isArray(parsed) ? parsed.sort((a, b) => b.updatedAt - a.updatedAt) : [];
    } catch { return []; }
  }, [historyKey]);

  const saveHistory = useCallback((sessions: ChatSession[]) => {
    if (!historyKey) return;
    try {
      // Keep latest 50 to avoid bloat
      localStorage.setItem(historyKey, JSON.stringify(sessions.slice(0, 50)));
      setHistoryVersion((v) => v + 1);
    } catch (e) { console.error("Failed to save chat history", e); }
  }, [historyKey]);

  const persistCurrentSession = useCallback((messages: ChatMessage[]) => {
    if (!historyKey || messages.length === 0) return;
    const sessions = loadHistory();
    const firstUser = messages.find((m) => m.role === "user")?.content || "Untitled chat";
    const title = firstUser.length > 60 ? firstUser.slice(0, 60) + "…" : firstUser;
    const classLabel = CLASS_OPTIONS.find((c) => c.value === selectedClass)?.label || selectedClass || "—";
    const session: ChatSession = {
      id: currentSessionId || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      classLabel,
      section: selectedSection || "—",
      subject: selectedSubject || "",
      classValue: selectedClass,
      sectionValue: selectedSection,
      subjectValue: selectedSubject,
      messages,
      updatedAt: Date.now(),
    };
    if (!currentSessionId) setCurrentSessionId(session.id);
    const next = [session, ...sessions.filter((s) => s.id !== session.id)];
    saveHistory(next);
  }, [historyKey, currentSessionId, selectedClass, selectedSection, selectedSubject, loadHistory, saveHistory]);

  const chatHistorySessions = useMemo(() => loadHistory(), [loadHistory, historyVersion]);

  // Refs used by selectedClass-change effect to distinguish user changes from history-restore
  const prevClassRef = useRef(selectedClass);
  const skipNextClassResetRef = useRef(false);

  const handleNewChat = useCallback(() => {
    setChatMessages([]);
    setHasGeneratedContent(false);
    setCurrentSessionId(null);
  }, []);

  const handleLoadSession = useCallback((id: string) => {
    const sessions = loadHistory();
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    // Prevent the selectedClass effect from wiping the messages we're about to restore
    if (s.classValue && s.classValue !== selectedClass) {
      skipNextClassResetRef.current = true;
    }
    if (s.classValue) setSelectedClass(s.classValue);
    if (s.sectionValue) setSelectedSection(s.sectionValue);
    if (s.subjectValue !== undefined) setSelectedSubject(s.subjectValue);
    setChatMessages(s.messages);
    setCurrentSessionId(s.id);
    setHasGeneratedContent(s.messages.some((m) => m.role === "assistant"));
    toast.success(`Loaded chat: ${s.title}`);
  }, [loadHistory, selectedClass]);

  const handleDeleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = loadHistory().filter((s) => s.id !== id);
    saveHistory(next);
    if (currentSessionId === id) handleNewChat();
  }, [loadHistory, saveHistory, currentSessionId, handleNewChat]);



  // Authorization check - only teachers can access Curative page
  if (profile?.role !== "teacher") {
    return (
      <AppLayout>
        <PageHeader
          title="Pillar 4: The Curative Phase"
          subtitle="Generate personalized curative lessons"
        />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Lock className="h-12 w-12 text-danger mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Access Restricted</h2>
            <p className="text-muted-foreground max-w-md">
              Only teachers can generate and manage curative lessons. Contact your teacher for personalized learning plans.
            </p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  const getClassLabel = (value: string) => CLASS_OPTIONS.find(c => c.value === value)?.label || value;

  const { data: sections = [] } = useQuery({
    queryKey: ["curative-sections", selectedClass, user?.id],
    queryFn: async () => {
      if (!selectedClass || !user?.id) return DEFAULT_SECTIONS;
      const { data } = await supabase
        .from("student_assessments")
        .select("section")
        .eq("student_class", selectedClass)
        .eq("teacher_id", user.id);
      if (!data || data.length === 0) return DEFAULT_SECTIONS;
      const unique = [...new Set(data.map((d) => (d.section || "").toUpperCase()).filter(Boolean))] as string[];
      return [...new Set([...unique, ...DEFAULT_SECTIONS])].sort();
    },
    enabled: !!selectedClass && !!user?.id,
  });

  const { data: textbookFiles = [] } = useQuery<TextbookFile[]>({
    queryKey: ["curative-textbooks", selectedClass],
    queryFn: async () => {
      if (!selectedClass) return [];
      const classLabel = selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1);
      const { data, error } = await supabase
        .from("books")
        .select("subject, book_name")
        .eq("class_name", classLabel)
        .eq("is_active", true)
        .order("subject", { ascending: true });
      if (error || !data) return [];
      return data.map((b) => ({ fileName: b.book_name, subject: b.subject, chapter: "" }));
    },
    enabled: !!selectedClass,
  });

  const subjects = useMemo(
    () =>
      Array.from(
        new Map(
          textbookFiles.map((f) => [
            f.subject.toLowerCase(),
            { value: f.subject, label: f.subject },
          ]),
        ).values(),
      ).sort((a, b) => a.label.localeCompare(b.label)),
    [textbookFiles],
  );

  const chapters = useMemo(
    () =>
      selectedSubject
        ? textbookFiles
            .filter((f) => f.subject.toLowerCase() === selectedSubject.toLowerCase())
            .map((f) => ({
              value: f.fileName,
              label: f.chapter,
            }))
        : [],
    [selectedSubject, textbookFiles],
  );

  const { data: studentCount = 0 } = useQuery({
    queryKey: ["curative-student-count", selectedClass, selectedSection, profile?.school_id],
    queryFn: async () => {
      if (!selectedClass || !selectedSection || !profile?.school_id) return 0;
      const { count } = await supabase
        .from("student_assessments")
        .select("id", { count: "exact", head: true })
        .eq("student_class", selectedClass)
        .eq("section", selectedSection)
        .eq("school_id", profile.school_id);
      return count || 0;
    },
    enabled: !!selectedClass && !!selectedSection && !!profile?.school_id,
  });

  const userScrolledUp = useRef(false);

  const handleChatScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distanceFromBottom > 80;
  }, []);

  useEffect(() => {
    if (!userScrolledUp.current) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  const { data: chaptersList = [] } = useQuery({
    queryKey: ["chapters-by-class-subject", selectedClass, selectedSubject],
    queryFn: async () => {
      if (!selectedClass || !selectedSubject) return [];
      const classLabel = selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1);
      const { data: books } = await supabase
        .from("books")
        .select("id")
        .eq("class_name", classLabel)
        .eq("subject", selectedSubject)
        .eq("is_active", true)
        .limit(1);
      if (!books || books.length === 0) return [];
      const bookId = books[0].id;
      const { data: units } = await supabase
        .from("units")
        .select("id, unit_name")
        .eq("book_id", bookId)
        .eq("is_active", true)
        .order("id", { ascending: true });
      if (!units || units.length === 0) return [];
      const unitIds = units.map((u: any) => u.id);
      const { data: chapters } = await supabase
        .from("curriculum_chapters")
        .select("id, chapter_name, unit_id")
        .in("unit_id", unitIds)
        .eq("is_active", true)
        .order("id", { ascending: true });
      if (!chapters) return [];
      return chapters.map((c: any) => {
        const unit = units.find((u: any) => u.id === c.unit_id);
        return {
          id: c.id,
          chapter_name: c.chapter_name,
          full_chapter_name: `${unit?.unit_name ?? ""}: ${c.chapter_name}`,
          unit_name: unit?.unit_name ?? "",
        };
      });
    },
    enabled: !!selectedClass && !!selectedSubject,
  });

  // Fetch topics from curriculum_chapters -> topics
  const { data: topicsList = [] } = useQuery({
    queryKey: ["topics-by-chapter", selectedChapter],
    queryFn: async () => {
      if (!selectedChapter) return [];
      const chapter = (chaptersList as any[]).find(
        (c) => (c.full_chapter_name || c.chapter_name) === selectedChapter
      );
      if (!chapter) return [];
      const { data, error } = await supabase
        .from("topics")
        .select("id, topic_name")
        .eq("chapter_id", chapter.id)
        .order("id", { ascending: true });
      if (error || !data) return [];
      return data;
    },
    enabled: !!selectedChapter && chaptersList.length > 0,
  });

  // Fetch subtopics from topics -> subtopics
  const { data: subtopicsList = [] } = useQuery({
    queryKey: ["subtopics-by-topic", topicValue],
    queryFn: async () => {
      if (!topicValue) return [];
      const topic = (topicsList as any[]).find((t) => t.topic_name === topicValue);
      if (!topic) return [];
      const { data, error } = await supabase
        .from("subtopics")
        .select("id, subtopic_name")
        .eq("topic_id", topic.id)
        .eq("is_active", true)
        .order("id", { ascending: true });
      if (error || !data) return [];
      return data;
    },
    enabled: !!topicValue && topicsList.length > 0,
  });

  // Derive the full chapter name for TopicSelector
  // Look it up from extractedChapters to get full_chapter_name (e.g., "Unit 9: Time")
  const selectedChapterName = useMemo(() => {
    if (!selectedChapter || !extractedChapters.length) return "";
    const chapter = (extractedChapters as any[]).find(
      (c) => (c.full_chapter_name || c.chapter_name) === selectedChapter
    );
    return chapter?.full_chapter_name || chapter?.chapter_name || "";
  }, [selectedChapter, extractedChapters]);

  // Track previous class so we only clear chat on a USER-initiated class change,
  // not when restoring from history (which programmatically sets the class).
  useEffect(() => {
    if (prevClassRef.current === selectedClass) return;
    prevClassRef.current = selectedClass;
    if (skipNextClassResetRef.current) {
      skipNextClassResetRef.current = false;
      return;
    }
    setSelectedSection("");
    setSelectedSubject("");
    setSelectedChapter("");
    setTopicValue("");
    setSelectedSubtopic("");
    setExtractedChapters([]);
    setChatMessages([]);
  }, [selectedClass]);

  const sendMessage = useCallback(async (prompt: string, mode: "generate" | "chat") => {
    if (!selectedClass) { toast.error("Please select a class first"); return; }
    if (!selectedSection) { toast.error("Please select a section first"); return; }
    if (isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content: prompt };
    setChatMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsStreaming(true);

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    // Capture current values for the closure
    const currentTopic = topicValue.trim() || null;
    const currentSubject = selectedSubject ? extractSubjectName(selectedSubject) : "General";

    try {
      await streamChat({
        selectedClass,
        section: selectedSection,
        subject: selectedChapter || selectedSubject,
        prompt, mode, chatHistory: chatMessages,
        schoolId: profile?.school_id ?? null,
        onDelta: (chunk) => upsertAssistant(chunk),
        onDone: async () => {
          setIsStreaming(false);
          // Persist conversation to history
          try {
            const finalMessages: ChatMessage[] = [...chatMessages, userMsg, { role: "assistant", content: assistantSoFar }];
            persistCurrentSession(finalMessages);
          } catch (err) { console.error("history persist failed", err); }
          if (mode === "generate") {
            setHasGeneratedContent(true);
            awardXp("generate_lesson", "Generated a lesson plan");
            // Save lesson plan to database
            try {
              const classLabel = getClassLabel(selectedClass);
              const title = `${classLabel}-${selectedSection} ${currentSubject}${currentTopic ? ` ${currentTopic}` : ""}`;
              
              // Extract periods count from selected periods and lesson content
              const periodsCount = extractPeriodsCount(selectedPeriods, assistantSoFar);
              
              // Always create a new lesson plan (no override)
              await supabase.from("lessons").insert({
                title,
                subject: currentSubject,
                curriculum: selectedCurriculum || "",
                class_level: selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1),
                section: selectedSection,
                lesson_content: assistantSoFar,
                ai_generated: true,
                topic: currentTopic,
                teacher_id: user?.id || null,
                periods_count: periodsCount,
              } as any);
            } catch (err) {
              console.error("Failed to save lesson plan:", err);
            }
          }
        },
        onError: (msg) => { toast.error(msg); setIsStreaming(false); },
      });
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to connect to AI assistant");
      setIsStreaming(false);
    }
  }, [selectedClass, selectedSection, selectedSubject, selectedChapter, selectedCurriculum, topicValue, chatMessages, isStreaming, user?.id, persistCurrentSession]);

  const getPeriodBreakdown = (periods: number) => {
    if (periods === 1) return "a single period";
    return `${periods} periods (spread across ${periods} teaching sessions)`;
  };

  const handleGeneratePlan = async () => {
    const subjectLabel = selectedSubject ? selectedSubject : "";
    // selectedChapter is now the full chapter name directly from extractedChapters
    const chapterLabel = selectedChapter || "";
    const selectedChapterData = extractedChapters.find(
      (c) => (c.full_chapter_name || c.chapter_name) === selectedChapter
    );
    const pageNumbers = selectedChapterData?.page_numbers || "";
    const subjectText = subjectLabel ? ` for subject: ${subjectLabel}` : "";
    const chapterText = chapterLabel ? `, Chapter/Unit: "${chapterLabel}"${pageNumbers ? `, Pages: ${pageNumbers}` : ""}` : "";
    const topicText = topicValue.trim() ? `, Topic: "${topicValue.trim()}"` : "";
    const curriculumLabel = CURRICULUM_OPTIONS.find(c => c.value === selectedCurriculum)?.label || "";
    const curriculumText = curriculumLabel ? ` using ${curriculumLabel} pedagogical framework` : "";
    const periods = parseInt(selectedPeriods) || 1;
    const periodDesc = getPeriodBreakdown(periods);
    const periodDurationMin = parseInt(periodDuration) || 40;

    // Duplicate check: prevent regenerating an identical lesson plan
    try {
      const subjectName = selectedSubject ? extractSubjectName(selectedSubject) : "General";
      const topicTrimmed = topicValue.trim();

      let dupQuery = supabase
        .from("lessons")
        .select("id, title, lesson_content, created_at")
        .eq("class_level", selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1))
        .eq("section", selectedSection)
        .eq("subject", subjectName)
        .eq("curriculum", selectedCurriculum || "")
        .eq("periods_count", periods);

      dupQuery = topicTrimmed
        ? dupQuery.eq("topic", topicTrimmed)
        : dupQuery.is("topic", null);

      if (user?.id) dupQuery = dupQuery.eq("teacher_id", user.id);

      const { data: existing, error: dupErr } = await dupQuery
        .order("created_at", { ascending: false })
        .limit(1);
      if (!dupErr && existing && existing.length > 0) {
        const existingLesson = existing[0] as any;
        const hasContent = typeof existingLesson.lesson_content === "string" && existingLesson.lesson_content.trim().length > 0;

        if (hasContent) {
          // Load the previously generated plan into the chat so the teacher can see it
          const userPrompt = `Generate a lesson plan for ${getClassLabel(selectedClass)}-${selectedSection} • ${subjectName}${topicTrimmed ? ` • "${topicTrimmed}"` : ""} • ${curriculumLabel || "this curriculum"} • ${periods} period(s).`;
          setChatMessages([
            { role: "user", content: userPrompt },
            { role: "assistant", content: existingLesson.lesson_content },
          ]);
          setHasGeneratedContent(true);
          toast.success(
            `Loaded existing lesson plan for ${getClassLabel(selectedClass)}-${selectedSection} • ${subjectName}${topicTrimmed ? ` • "${topicTrimmed}"` : ""}. Change topic, periods, or curriculum to generate a new one.`,
            { duration: 6000 }
          );
        } else {
          // Stale empty row — delete it so the teacher can regenerate
          await supabase.from("lessons").delete().eq("id", existingLesson.id);
          toast.info("Found an incomplete previous attempt — regenerating now.");
          // Fall through to sendMessage below
        }

        if (hasContent) return;
      }
    } catch (err) {
      console.error("Duplicate lesson check failed:", err);
    }

    sendMessage(
      `Generate a COMPLETE LESSON PLAN for ${getClassLabel(selectedClass)} Section ${selectedSection}${subjectText}${chapterText}${topicText}${curriculumText} with ${studentCount} students.

TOTAL PERIODS: ${periods}
PERIOD DURATION: ${periodDurationMin} minutes each

${periods > 1 ? `CRITICAL STRUCTURE REQUIREMENT: This lesson plan MUST be divided into exactly ${periods} PERIODS. Each period is ${periodDurationMin} minutes. 

MANDATORY SECTION STRUCTURE FOR EVERY PERIOD (do NOT deviate):
Each period MUST have EXACTLY these 8 sections in this order:

### 📋 1. Learning Objectives
- Clear, measurable objectives for THIS period using Bloom's taxonomy

### 🎣 2. Introduction — Hook Activity (First [X] minutes — PRIMACY EFFECT)
- Engaging opening that captures attention
- X = approximately 20% of period duration

### 📚 3. Main Teaching — Chunked Delivery (10-2-10 Rule)
- Chunk 1: Input → 2-min Processing → Application (with 3-tier differentiation)
- Chunk 2: Input → 2-min Processing → Application (with 3-tier differentiation)
- Chunk 3: (if time permits) Input → 2-min Processing → Application
- Include VARK-aligned activities for Visual, Auditory, Read/Write, Kinesthetic learners

### 🎯 4. Activities — Differentiated Group Work ([X] minutes)
- Group-based collaborative activities
- 3-tier tasks: Support/Core/Extension for mixed ability groups
- X = approximately 30-40% of period duration

### ✅ 5. Assessment — Quick Check ([X] minutes)
- Formative assessment to check understanding
- Quick quiz, observation checklist, or interactive check
- X = approximately 10% of period duration

### 🔄 6. Closure — Revision Activity (Last [X] minutes — RECENCY EFFECT)
- Summarize key learning points
- Quick review game, exit slip preview, or concept mapping
- X = approximately 10% of period duration

### 📝 7. Assessment — Exit Ticket (5 minutes — Evaluate Phase)
- 3-5 NUMBERED questions (1. 2. 3. etc.) that assess the key learning from this period
- Questions should be clear, specific, and answerable in 5 minutes
- Format: Simple numbered list with clear question text
- Example:
  1. Define [key term]
  2. Give an example of [concept]
  3. Explain how [concept A] relates to [concept B]
  4. Solve [sample problem]
  5. What would happen if [scenario]?

### 📊 8. BBL Compliance Checklist
- Primacy Effect applied: ✓
- Recency Effect applied: ✓
- Cognitive Load managed: ✓
- Social Brain activated: ✓
- VARK differentiation: ✓
- 3-tier scaffolding: ✓

---

NOW APPLY THIS STRUCTURE TO ALL ${periods} PERIODS:

## 📝 Overall Learning Objectives (for the complete unit across all periods)
(3-5 cumulative objectives for the entire ${periods}-period lesson)

---
## 📅 PERIOD 1 — [Sub-topic Title]
[Apply the 8-section structure above]

---
## 📅 PERIOD 2 — [Sub-topic Title]
[Apply the 8-section structure above, building on Period 1]

... repeat for ALL ${periods} periods ...

---
## 📅 PERIOD ${periods} — [Sub-topic Title]
[Apply the 8-section structure above with comprehensive review]

---
## Learning Outcomes
(What students can do after completing all ${periods} periods)

---

CRITICAL REQUIREMENTS:
✓ EVERY period (1 through ${periods}) MUST have ALL 8 sections
✓ Section 7 (Evaluate Phase Exit Ticket) MUST have numbered questions (1. 2. 3. etc.)
✓ Period timings MUST total exactly ${periodDurationMin} minutes per period
✓ Content must be distributed evenly across ${periods} periods with progressive complexity
✓ Each period builds on previous learning
✓ Exit tickets must assess THAT period's specific learning objectives
` : `Cover the complete topic within a single ${periodDurationMin}-minute period with full detail.

Auto-generate 3-5 clear, measurable learning objectives using simple Bloom's taxonomy action verbs.

Apply the same 8-section structure for the single period:
### 📋 1. Learning Objectives
### 🎣 2. Introduction — Hook Activity
### 📚 3. Main Teaching — Chunked Delivery
### 🎯 4. Activities — Differentiated Group Work
### ✅ 5. Assessment — Quick Check
### 🔄 6. Closure — Revision Activity
### 📝 7. Assessment — Exit Ticket (5 minutes — Evaluate Phase)
[Include 3-5 NUMBERED exit ticket questions]
### 📊 8. BBL Compliance Checklist`}

Generate ONLY the lesson plan (do NOT generate a diagnostic report). Include:
- Differentiated activities for each of the 4 VARK groups with 3-tier task cards (Support/Core/Extension)
- Mismatch alerts for at-risk groups
- ONE numbered Exit Ticket (Section 7 - Evaluate Phase) per period with 3-5 clear questions
- Read the textbook content for this chapter/unit and align all activities to the curriculum
${selectedCurriculum === "ib" ? "- Use Inquiry-Based methodology: K-W-L structure, Socratic questioning, transdisciplinary themes" : ""}${selectedCurriculum === "cbse" ? "- Use CBSE pedagogical approach with NCERT alignment" : ""}${selectedCurriculum === "cambridge" ? "- Use Project-Based Learning: real-world tasks, success criteria, practical experiments" : ""}${selectedCurriculum === "ai" ? "- Auto-detect the best pedagogical approach based on the subject, class level, and assessment data" : ""}

IMPORTANT: For each VARK learning style group (Visual, Auditory, Read/Write, Kinesthetic), LIST the actual student names that belong to that group based on their assessment data.

IMPORTANT: You MUST complete the ENTIRE lesson plan. Do NOT stop early or truncate. The plan MUST end with the "Learning Outcomes" section.

IMPORTANT: At the VERY END of the lesson plan, after Learning Outcomes, include a "📖 Word Decoder" section. This section MUST define every advanced/technical term used in the plan in simple, kid-friendly language. Format each term as:
→ **Term Name** = Simple explanation in 1-2 sentences that a parent or student can understand.
Include terms like: Primacy Effect, Recency Effect, 10-2-10 Chunking Rule, Cognitive Load, Amygdala Filter, Patterning & Meaning, Spaced Repetition, Social Brain, ZPD (Zone of Proximal Development), Scaffolding, Multiple Intelligences (MI), VARK, Bloom's Taxonomy, Formative Check, and any other technical terms used in the plan.

Whenever you use any advanced or technical word in the lesson plan body, add a simple decode inline as well.`,
      "generate",
    );
  };

  const handleDownloadPDF = async (messageContent: string, messageIndex: number) => {
    const timestamp = new Date().toLocaleString('en-US', { 
      year: 'numeric', month: '2-digit', day: '2-digit', 
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
    }).replace(/[/:]/g, '-');
    
    const filename = `APAS-LessonPlan-${getClassLabel(selectedClass)}-Section${selectedSection}-${timestamp}.pdf`;
    
    // Convert markdown to structured HTML
    let html = messageContent;

    // Helper: friendly label for a YouTube link
    const makeYoutubeLabel = (url: string, fallback?: string): string => {
      try {
        const u = new URL(url);
        const q = u.searchParams.get('search_query') || u.searchParams.get('q');
        if (q) {
          const topic = decodeURIComponent(q.replace(/\+/g, ' ')).trim();
          return `▶ Watch on YouTube: ${topic}`;
        }
      } catch { /* ignore */ }
      if (fallback && !/^https?:/i.test(fallback)) return `▶ ${fallback}`;
      return '▶ Watch on YouTube';
    };

    // 1) Markdown links [text](url) — replace YouTube ones with friendly labels, all open in new tab
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => {
      const isYT = /youtube\.com|youtu\.be/i.test(url);
      const label = isYT ? makeYoutubeLabel(url, text) : text;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    // 2) Bare YouTube URLs → friendly anchor
    html = html.replace(/(^|[\s(])(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+)/g, (_m, pre: string, url: string) => {
      return `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${makeYoutubeLabel(url)}</a>`;
    });

    // Tables
    html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (match, header, sep, body) => {
      const headerCells = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
    });

    // Headings
    html = html.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[\s(])\*([^\*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');

    // Blockquotes
    html = html.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>');

    // Lists — support both "- " and "* " bullets
    html = html.replace(/^[ \t]*[-*][ \t]+(.*?)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.*?)$/gm, '<li>$1. $2</li>');

    // Wrap consecutive <li> in <ul>
    html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');
    
    // Paragraphs
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
          <div class="lc-field">
            <label>Class</label>
            <value>${getClassLabel(selectedClass)}</value>
            <small>Section ${selectedSection}</small>
          </div>
          <div class="lc-field">
            <label>Subject</label>
            <value>${selectedSubject || 'General'}</value>
            <small>${studentCount} students</small>
          </div>
          <div class="lc-field">
            <label>Report Type</label>
            <value>Lesson Plan</value>
            <small>Differentiated</small>
          </div>
        </div>

        <div class="content">
          ${html}
        </div>

        <div class="footer">
          <div class="footer-note">This report is auto-generated by the APAS AI engine. For academic use only.</div>
          <div class="footer-apas">APAS · ${new Date().getFullYear()}</div>
        </div>
      </div>
    `;
    
    // Ensure emoji font is available
    const metaCharset = document.createElement('meta');
    metaCharset.setAttribute('charset', 'utf-8');
    tempDiv.prepend(metaCharset);

    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
      * { font-family: 'DM Sans', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif; }
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
      
      .content { }
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
      filename: filename,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#f7f5f0' },
      jsPDF: { orientation: 'portrait' as const, unit: 'mm' as const, format: 'a4' as const, compress: true },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };
    
    const html2pdf = (await import("html2pdf.js")).default;
    html2pdf().set(opt).from(tempDiv).save();
    toast.success('PDF downloaded successfully!');
  };

  const handleSendChat = () => { if (!inputValue.trim()) return; sendMessage(inputValue.trim(), "chat"); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); }
  };

  const isReady = !!selectedClass && !!selectedSection;

  return (
    <AppLayout>
      {/* Hero Header */}
      <div className="relative mb-8 rounded-2xl overflow-hidden bg-gradient-to-br from-primary/80 via-primary to-primary/80 p-8 shadow-xl animate-fade-in">
          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>
<div className="hidden md:block">
                    <div className="absolute top-12 left-[45%] text-white/80 text-xl">?</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">?</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">?</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>
          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>
          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djJoLTJ2LTJoMnptMC00aDJ2MmgtMnYtMnptLTQgOGgydjJoLTJ2LTJ6bTIgMGgydjJoLTJ2LTJ6bTItNGgydjJoLTJ2LTJ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-white/20 backdrop-blur-sm rounded-xl animate-bounce-slow">
              <Wand2 className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">Lesson Plan Generator</h1>
              <p className="text-white/80 text-semibold mt-0.5">AI-powered teaching assistant - generates differentiated lesson plans using class reports & textbooks</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="lesson-plan" className="mb-6 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-4 ">
          <TabsTrigger value="lesson-plan" className=" data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg gap-2">
            <Wand2 className="h-6 w-6" /> Lesson Plan
          </TabsTrigger>
          <TabsTrigger value="assign-homework" className=" data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg gap-2">
            <Briefcase className="h-6 w-6" /> Assign Homework
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lesson-plan" className="space-y-6 mt-0">
          {/* Configuration Card */}
          <Card className="border-2 border-primary/10 shadow-lg hover:shadow-xl transition-all duration-500">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex items-center gap-2 text-primary">
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
                <BookMarked className="h-7 w-7 text-red-600" />
                </div>
                Configure Your Lesson
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="group">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">Select Class</label>
                  <Select value={selectedClass} onValueChange={setSelectedClass}>
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50 focus:ring-primary/30"><SelectValue placeholder="Choose a class..." /></SelectTrigger>
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
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50"><SelectValue placeholder={!selectedClass ? "Select a class first..." : "Choose a section..."} /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s} value={s}>
                          <span className="flex items-center gap-2"><Users className="h-3.5 w-3.5" />Section {s}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="group">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">Select Subject</label>
                  <Select value={selectedSubject} onValueChange={(v) => { setSelectedSubject(v); setSelectedChapter(""); setTopicValue(""); setSelectedSubtopic(""); }} disabled={!selectedClass}>
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
                      <SelectValue placeholder={!selectedClass ? "Select a class first..." : subjects.length === 0 ? "No textbooks found" : "Choose a subject..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          <span className="flex items-center gap-2"><BookOpen className="h-3.5 w-3.5" />{s.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="group">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">
                    Select Chapter
                  </label>
                  <Select
                    value={selectedChapter}
                    onValueChange={(v) => { setSelectedChapter(v); setTopicValue(""); setSelectedSubtopic(""); }}
                    disabled={!selectedSubject || chaptersList.length === 0}
                  >
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
                      <SelectValue
                        placeholder={
                          !selectedSubject
                            ? "Select a subject first..."
                            : chaptersList.length === 0
                            ? "No chapters found"
                            : "Choose a chapter..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {chaptersList.map((ch: any) => (
                        <SelectItem key={ch.id} value={ch.full_chapter_name || ch.chapter_name}>
                          <span className="flex items-center gap-2">
                            <BookOpen className="h-3.5 w-3.5 shrink-0" />
                            <span>{ch.full_chapter_name || ch.chapter_name}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="group">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">
                    Select Topic
                  </label>
                  <Select
                    value={topicValue}
                    onValueChange={setTopicValue}
                    disabled={!selectedChapter || topicsList.length === 0}
                  >
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
                      <SelectValue
                        placeholder={
                          !selectedChapter
                            ? "Select a chapter first..."
                            : topicsList.length === 0
                            ? "No topics found"
                            : "Choose a topic..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {topicsList.map((t: any) => (
                        <SelectItem key={t.id} value={t.topic_name}>
                          <span className="flex items-center gap-2">
                            <BookOpen className="h-3.5 w-3.5 shrink-0" />
                            <span>{t.topic_name}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="group">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">
                    Select Subtopic
                  </label>
                  <Select
                    value={selectedSubtopic}
                    onValueChange={setSelectedSubtopic}
                    disabled={!topicValue || subtopicsList.length === 0}
                  >
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
                      <SelectValue
                        placeholder={
                          !topicValue
                            ? "Select a topic first..."
                            : subtopicsList.length === 0
                            ? "No subtopics found"
                            : "Choose a subtopic..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {subtopicsList.map((s: any) => (
                        <SelectItem key={s.id} value={s.subtopic_name}>
                          <span className="flex items-center gap-2">
                            <BookOpen className="h-3.5 w-3.5 shrink-0" />
                            <span>{s.subtopic_name}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="group">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">Curriculum</label>
                  <Select value={selectedCurriculum} onValueChange={setSelectedCurriculum}>
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50"><SelectValue placeholder="Choose curriculum..." /></SelectTrigger>
                    <SelectContent>
                      {CURRICULUM_OPTIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          <span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" />{c.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="group">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors">Academic Year</label>
                  <Select value={academicYear} onValueChange={setAcademicYear}>
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
                      <SelectValue placeholder="Select year..." />
                    </SelectTrigger>
                    <SelectContent>
                      {["2025-26","2026-27","2027-28","2028-29","2029-30"].map(y => (
                        <SelectItem key={y} value={y}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Topic & Duration row */}
              <div className="mt-5 flex flex-wrap gap-4">
                <div className="w-[170px] group">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors flex items-center gap-1.5">
                    <CalendarDays className="h-3 w-3" /> Periods
                  </label>
                  <Select value={selectedPeriods} onValueChange={setSelectedPeriods}>
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50"><SelectValue placeholder="Periods" /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 15 }, (_, i) => i + 1).map((p) => (
                        <SelectItem key={p} value={String(p)}>{p} {p === 1 ? "Period" : "Periods"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-[170px] group">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block group-hover:text-primary transition-colors flex items-center gap-1.5">
                    <Clock className="h-3 w-3" /> Period Duration
                  </label>
                  <Select value={periodDuration} onValueChange={setPeriodDuration}>
                    <SelectTrigger className="transition-all duration-300 hover:border-primary/50"><SelectValue placeholder="Duration" /></SelectTrigger>
                    <SelectContent>
                      {[30, 35, 40, 45, 50, 55, 60].map((d) => (
                        <SelectItem key={d} value={String(d)}>{d} min</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Generate Button */}
              <div className="mt-6 flex items-center gap-3">
                <Button
                  onClick={handleGeneratePlan}
                  disabled={!isReady || isStreaming}
                  size="lg"
                  className="shrink-0 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-base px-8 py-3 rounded-xl"
                >
                  {isStreaming ? (
                    <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Generating...</>
                  ) : (
                    <><Sparkles className="h-5 w-5 mr-2" /> Generate Lesson Plan</>
                  )}
                </Button>
              </div>

              {/* Status Badges */}
              {isReady && (
                <div className="mt-4 flex items-center gap-2 flex-wrap animate-fade-in">
                  <Badge variant="secondary" className="text-xs gap-1 shadow-sm"><GraduationCap className="h-3 w-3" /> {getClassLabel(selectedClass)}</Badge>
                  <Badge variant="outline" className="text-xs gap-1"><Users className="h-3 w-3" /> Section {selectedSection}</Badge>
                  {selectedSubject && (
                    <Badge variant="outline" className="text-xs gap-1"><BookOpen className="h-3 w-3" /> {selectedSubject}</Badge>
                  )}
                  {selectedCurriculum && (
                    <Badge variant="outline" className="text-xs gap-1"><Globe className="h-3 w-3" /> {CURRICULUM_OPTIONS.find(c => c.value === selectedCurriculum)?.label}</Badge>
                  )}
                  {topicValue.trim() && (
                    <Badge className="text-xs gap-1 bg-primary/10 text-primary border-primary/20"><BookMarked className="h-3 w-3" /> {topicValue.trim()}</Badge>
                  )}
                  <Badge variant="outline" className="text-xs gap-1"><CalendarDays className="h-3 w-3" /> {selectedPeriods} {parseInt(selectedPeriods) === 1 ? "Period" : "Periods"} × {periodDuration}min</Badge>
                  <span className="text-xs text-muted-foreground ml-2">
                    {studentCount} student{studentCount !== 1 ? "s" : ""} found. AI will use assessment reports & textbook content
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

      {/* AI Teaching Assistant */}
      <div className="mb-6 animate-fade-in" style={{ animationDelay: '0.2s' }}>
        {/* Assistant Header */}
        <div className="relative rounded-t-2xl overflow-hidden bg-gradient-to-r from-blue-500 via-blue-500 to-blue-500 p-5">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIxLjUiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4xKSIvPjwvc3ZnPg==')] opacity-60" />
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-11 h-11 rounded-xl overflow-hidden shadow-lg animate-bounce-slow border-2 border-white/30">
                  <img src={teacherAiAvatar} alt="AI Teacher" className="w-full h-full object-cover" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-white/30 animate-pulse" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  AI Teaching Assistant
                  <span className="text-[10px] font-medium bg-white/20 backdrop-blur-sm text-white/90 px-2 py-0.5 rounded-full uppercase tracking-wider">Online</span>
                </h2>
                <p className="text-white/70 text-xs mt-0.5">Your intelligent co-teacher,ask anything about your class</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 text-xs gap-1.5 rounded-lg transition-all duration-300">
                    <History className="h-3.5 w-3.5" /> History
                    {chatHistorySessions.length > 0 && (
                      <span className="ml-1 text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">{chatHistorySessions.length}</span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
                  <DropdownMenuLabel className="flex items-center justify-between">
                    <span>Chat history</span>
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={handleNewChat}>
                      <Plus className="h-3 w-3" /> New
                    </Button>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {chatHistorySessions.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No previous chats yet. Start a conversation and it will appear here.
                    </div>
                  ) : (
                    chatHistorySessions.map((s) => (
                      <DropdownMenuItem
                        key={s.id}
                        onClick={() => handleLoadSession(s.id)}
                        className={`flex items-start justify-between gap-2 cursor-pointer py-2 ${currentSessionId === s.id ? "bg-accent/10" : ""}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-foreground truncate">{s.title}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                            <span>{s.classLabel} • Sec {s.section}</span>
                            <span>·</span>
                            <span>{new Date(s.updatedAt).toLocaleDateString()} {new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteSession(s.id, e)}
                          className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          aria-label="Delete chat"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {chatMessages.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleNewChat} className="text-white/70 hover:text-white hover:bg-white/10 text-xs gap-1.5 rounded-lg transition-all duration-300">
                  <Plus className="h-3.5 w-3.5" /> New Chat
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="border-x-2 border-b-2 border-accent/10 rounded-b-2xl bg-card shadow-xl overflow-hidden">
          <div ref={contentRef} onScroll={handleChatScroll} className="min-h-[340px] max-h-[600px] overflow-y-auto p-5 space-y-5" style={{ background: 'linear-gradient(180deg, hsl(var(--muted)/0.15) 0%, hsl(var(--background)) 100%)', overflowAnchor: 'none' }}>
            {chatMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-[300px] text-center animate-fade-in">
                {/* Animated Bot Avatar */}
                <div className="relative mb-5">
                  <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-lg border-2 border-accent/20">
                    <img src={teacherAiAvatar} alt="AI Teacher" className="w-full h-full object-cover animate-bounce-slow" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-400 rounded-full border-2 border-card flex items-center justify-center">
                    <Sparkles className="h-2.5 w-2.5 text-white" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-foreground mb-1.5">Hello, Teacher!</h3>
                <p className="text-sm text-muted-foreground max-w-md mb-1">I'm your AI Teaching Assistant powered by advanced intelligence.</p>
                <p className="text-xs text-muted-foreground/70 max-w-sm mb-6">Select a class & section above, then generate a lesson plan or ask me anything about your students.</p>
                
                {/* Quick Action Cards */}
                {isReady && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full max-w-2xl">
                    <button
                      onClick={() => sendMessage(`What are the class-wide weak areas for ${getClassLabel(selectedClass)} Section ${selectedSection} based on the assessment report? Focus on dimensions where the class is struggling overall and avoid mentioning individual student names. Provide a summary of weak dimensions and average performance levels.`, "chat")}
                      disabled={isStreaming}
                      className="group flex flex-col items-center gap-2 p-3.5 rounded-xl border border-border bg-card hover:border-accent/40 hover:bg-accent/5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 text-center disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        <MessageSquare className="h-4.5 w-4.5 text-red-500" />
                      </div>
                      <span className="text-xs font-medium text-foreground/80">Weak Areas</span>
                    </button>
                    <button
                      onClick={() => {
                        const subjectLabel = selectedSubject ? extractSubjectName(selectedSubject) : "English";
                        sendMessage(`Generate a lesson plan for ${getClassLabel(selectedClass)} Section ${selectedSection} ${subjectLabel} – Chapter 1 based on the class assessment report. Focus on class-wide performance patterns with ${studentCount} students. Do NOT mention individual student names - provide recommendations based on class-level weak areas and average performance metrics. Generate ONLY the lesson plan, not a diagnostic report.`, "generate");
                      }}
                      disabled={isStreaming}
                      className="group flex flex-col items-center gap-2 p-3.5 rounded-xl border border-border bg-card hover:border-accent/40 hover:bg-accent/5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 text-center disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        <BookOpen className="h-4.5 w-4.5 text-blue-500" />
                      </div>
                      <span className="text-xs font-medium text-foreground/80">Ch. 1 Plan</span>
                    </button>
                    <button
                      onClick={() => {
                        const subjectLabel = selectedSubject ? extractSubjectName(selectedSubject) : "English";
                        sendMessage(`Create a comprehensive practice worksheet package for ${getClassLabel(selectedClass)} Section ${selectedSection} ${subjectLabel} with MINIMUM 5 PAGES structured as follows:

PAGE 1 - Foundation Skills: 2-3 activities targeting basic skills (visual recognition, sound identification, letter matching, tracing)

PAGE 2 - Word Building: 2-3 activities (fill-in-vowels, word scramble, word formation, CVC words)

PAGE 3 - Comprehension & Grammar: 2-3 activities (sentence completion, structure recognition, reading comprehension)

PAGE 4 - Application & Practice: 2-3 activities (context-based exercises, sentence formation, practical usage)

PAGE 5 - Assessment & Extension: 2-3 activities (assessment questions, challenge activities, creative tasks)

REQUIREMENTS:
- Each page must have different activity types
- Include diverse formats: fill-in-the-blank, matching, multiple choice, tracing, word scramble, sentence completion, picture labeling, sorting, true/false, short answer
- Each activity needs clear title, step-by-step instructions, and examples
- Focus on weak dimensions identified in the assessment report
- Appropriate for ${studentCount} students in the class
- Do NOT mention individual student names
- Include a COMPLETE ANSWER KEY at the end covering all pages
- Professional formatting with clear section breaks between pages`, "generate");
                      }}
                      disabled={isStreaming}
                      className="group flex flex-col items-center gap-2 p-3.5 rounded-xl border border-border bg-card hover:border-accent/40 hover:bg-accent/5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 text-center disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-lg bg-green-50 dark:bg-green-900/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        <Wand2 className="h-4.5 w-4.5 text-green-500" />
                      </div>
                      <span className="text-xs font-medium text-foreground/80">Worksheets</span>
                    </button>
                    <button
                      onClick={() => sendMessage(`What teaching strategies would you recommend for ${getClassLabel(selectedClass)} Section ${selectedSection} with ${studentCount} students based on class-wide performance? Focus on class-level interventions and do NOT mention individual student names. Provide actionable teaching strategies for the entire section.`, "chat")}
                      disabled={isStreaming}
                      className="group flex flex-col items-center gap-2 p-3.5 rounded-xl border border-border bg-card hover:border-accent/40 hover:bg-accent/5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 text-center disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        <GraduationCap className="h-4.5 w-4.5 text-purple-500" />
                      </div>
                      <span className="text-xs font-medium text-foreground/80">Strategies</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {chatMessages.map((msg, i) => (
              <div key={i} className="animate-fade-in">
                <div className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="shrink-0 w-8 h-8 rounded-xl overflow-hidden shadow-sm border border-accent/10">
                      <img src={teacherAiAvatar} alt="AI Teacher" className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  )}
                  <div className={`rounded-2xl px-5 py-4 max-w-[85%] shadow-sm ${
                    msg.role === "user" 
                      ? "bg-gradient-to-br from-accent to-accent/85 text-white text-sm rounded-br-md" 
                      : "bg-card border border-border/60 rounded-bl-md"
                  }`}>
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (<p className="text-sm leading-relaxed">{msg.content}</p>)}
                  </div>
                  {msg.role === "user" && (
                    <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mt-1 shadow-sm">
                      <User className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                </div>
                {msg.role === "assistant" && (
                  <div className="flex justify-start mt-2.5 ml-11">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleDownloadPDF(msg.content, i)}
                      className="text-xs gap-1.5 bg-green-50 hover:bg-green-100 text-green-700 border-green-200 rounded-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-900/30"
                    >
                      <Download className="h-3.5 w-3.5" /> Download PDF
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {isStreaming && chatMessages[chatMessages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-3 animate-fade-in">
                <div className="shrink-0 w-8 h-8 rounded-xl overflow-hidden shadow-sm border border-accent/10">
                  <img src={teacherAiAvatar} alt="AI Teacher" className="w-full h-full object-cover" loading="lazy" />
                </div>
                <div className="bg-card border border-border/60 rounded-2xl rounded-bl-md px-5 py-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    <span className="text-xs text-muted-foreground">Thinking...</span>
                    <span className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-accent/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-accent/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-accent/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t border-border/50 p-4 bg-muted/20">
            <div className="flex gap-2.5 items-center">
              <div className="relative flex-1">
                <Input 
                  value={inputValue} 
                  onChange={(e) => setInputValue(e.target.value)} 
                  onKeyDown={handleKeyDown}
                  placeholder={isReady ? `Ask about ${getClassLabel(selectedClass)} Section ${selectedSection}...` : "Select a class and section first..."}
                  disabled={!isReady || isStreaming} 
                  className="pr-4 rounded-xl border-border/60 bg-card focus:ring-accent/30 focus:border-accent/50 transition-all duration-300 h-11" 
                />
              </div>
              <Button 
                onClick={handleSendChat} 
                disabled={!isReady || !inputValue.trim() || isStreaming} 
                size="icon"
                className="h-11 w-11 rounded-xl bg-gradient-to-br from-accent to-accent/85 hover:from-accent/90 hover:to-accent shadow-md hover:shadow-lg hover:scale-[1.05] active:scale-[0.95] transition-all duration-300"
              >
                <Send className="h-4.5 w-4.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
        </TabsContent>

        {/* ─── Assign Homework Tab ─── */}
        <TabsContent value="assign-homework" className="space-y-6 mt-0">
          <AssignHomeworkTab user={user} profile={profile} getClassLabel={getClassLabel} />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
};

// ─── Assign Homework Component ───────────────────────────────────────
interface AssignHomeworkTabProps {
  user: any;
  profile: any;
  getClassLabel: (value: string) => string;
}

interface GeneratedLesson {
  id: string;
  title: string;
  subject: string;
  class_level: string;
  section: string;
  lesson_content: string;
  created_at: string;
  curriculum?: string;
  topic?: string;
  periods_count?: number;
}

const AssignHomeworkTab = ({ user, profile, getClassLabel }: AssignHomeworkTabProps) => {
  const [homeworkClass, setHomeworkClass] = useState("");
  const [homeworkSection, setHomeworkSection] = useState("");
  const [selectedLessonId, setSelectedLessonId] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [showLessonPreview, setShowLessonPreview] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<"none" | "in-class" | "at-home">("none");
  const [isAssigning, setIsAssigning] = useState(false);
  const [isEditingQuestions, setIsEditingQuestions] = useState(false);
  const [editedQuestions, setEditedQuestions] = useState<string[]>([]);
  const [newQuestions, setNewQuestions] = useState<string[]>([]);
  const [showClassScoreModal, setShowClassScoreModal] = useState(false);
  const [classPerformanceScore, setClassPerformanceScore] = useState<number | "">("");
  const [showAssignmentConfirmation, setShowAssignmentConfirmation] = useState(false);
  const [assignmentConfirmationData, setAssignmentConfirmationData] = useState<any>(null);
  const queryClient = useQueryClient();
  const [chapters, setChapters] = useState<string[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<string>("");
  const [extractedChapters, setExtractedChapters] = useState<string[]>([]);

  const { data: homeworkSections = [] } = useQuery({
    queryKey: ["homework-sections", homeworkClass, user?.id],
    queryFn: async () => {
      if (!homeworkClass || !user?.id) return DEFAULT_SECTIONS;
      const { data } = await supabase
        .from("student_assessments")
        .select("section")
        .eq("student_class", homeworkClass)
        .eq("teacher_id", user.id);
      if (!data || data.length === 0) return DEFAULT_SECTIONS;
      const unique = [...new Set(data.map((d) => (d.section || "").toUpperCase()).filter(Boolean))] as string[];
      return [...new Set([...unique, ...DEFAULT_SECTIONS])].sort();
    },
    enabled: !!homeworkClass && !!user?.id,
  });

  const { data: generatedLessons = [], isLoading: isLoadingLessons } = useQuery<GeneratedLesson[]>({
    queryKey: ["generated-lessons", homeworkClass, homeworkSection, user?.id],
    queryFn: async () => {
      if (!homeworkClass || !homeworkSection || !user?.id) return [];
      const { data, error } = await supabase
        .from("lessons")
        .select("*")
        .eq("class_level", homeworkClass.match(/^\d+$/) ? `Class ${homeworkClass}` : homeworkClass.charAt(0).toUpperCase() + homeworkClass.slice(1))
        .eq("section", homeworkSection)
        .eq("teacher_id", user.id)
        .eq("ai_generated", true)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Error fetching lessons:", error);
        return [];
      }
      return (data as GeneratedLesson[]) || [];
    },
    enabled: !!homeworkClass && !!homeworkSection && !!user?.id,
  });

  // Fetch student count for homework assignment
  const { data: homeworkStudentCount = 0 } = useQuery({
    queryKey: ["homework-student-count", homeworkClass, homeworkSection, user?.id],
    queryFn: async () => {
      if (!homeworkClass || !homeworkSection || !user?.id) return 0;
      const { count } = await supabase
        .from("student_assessments")
        .select("id", { count: "exact", head: true })
        .eq("student_class", homeworkClass)
        .eq("section", homeworkSection)
        .eq("teacher_id", user.id);
      return count || 0;
    },
    enabled: !!homeworkClass && !!homeworkSection && !!user?.id,
  });

  // Fetch existing in-class assignments for this lesson/class/section
  const { data: existingInClassAssignments = [] } = useQuery({
    queryKey: ["in-class-assignments", selectedLessonId, homeworkClass, homeworkSection, user?.id],
    queryFn: async () => {
      if (!selectedLessonId || !homeworkClass || !homeworkSection || !user?.id) return [];
      const { data, error } = await supabase
        .from("homework_assignments")
        .select("*")
        .eq("lesson_id", selectedLessonId)
        .eq("class_level", homeworkClass.match(/^\d+$/) ? `Class ${homeworkClass}` : homeworkClass.charAt(0).toUpperCase() + homeworkClass.slice(1))
        .eq("section", homeworkSection)
        .eq("assignment_type", "in-class")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Error fetching in-class assignments:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!selectedLessonId && !!homeworkClass && !!homeworkSection && !!user?.id,
  });

  // Fetch existing at-home assignments for this lesson/class/section
  const { data: existingAtHomeAssignments = [] } = useQuery({
    queryKey: ["at-home-assignments", selectedLessonId, homeworkClass, homeworkSection, user?.id],
    queryFn: async () => {
      if (!selectedLessonId || !homeworkClass || !homeworkSection || !user?.id) return [];
      const { data, error } = await supabase
        .from("homework_assignments")
        .select("*")
        .eq("lesson_id", selectedLessonId)
        .eq("class_level", homeworkClass.match(/^\d+$/) ? `Class ${homeworkClass}` : homeworkClass.charAt(0).toUpperCase() + homeworkClass.slice(1))
        .eq("section", homeworkSection)
        .eq("assignment_type", "at-home")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Error fetching at-home assignments:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!selectedLessonId && !!homeworkClass && !!homeworkSection && !!user?.id,
  });

  const selectedLesson = generatedLessons.find((lesson) => lesson.id === selectedLessonId) || null;

  // Extract available periods from selected lesson
  let availablePeriods = selectedLesson ? extractPeriods(selectedLesson.lesson_content) : [];
  
  // Fallback: if extraction fails but periods_count exists, generate period list
  if (availablePeriods.length === 0 && selectedLesson?.periods_count && selectedLesson.periods_count > 0) {
    const lessonTitle = selectedLesson.title || selectedLesson.topic || "Lesson";
    availablePeriods = Array.from({ length: selectedLesson.periods_count }, (_, i) => ({
      periodNumber: i + 1,
      title: `${lessonTitle} - Part ${i + 1}`,
    }));
  }

  // Detect if single-period or multi-period lesson
  const isSinglePeriod = availablePeriods.length === 1;
  
  // Auto-select period 1 for single-period lessons
  useEffect(() => {
    if (isSinglePeriod && !selectedPeriod && availablePeriods.length > 0) {
      setSelectedPeriod('1');
    }
  }, [isSinglePeriod, selectedLessonId, availablePeriods.length]);

  // Extract exit ticket for selected period
  const selectedExitTicket = selectedLesson && selectedPeriod 
    ? extractExitTicket(selectedLesson.lesson_content, parseInt(selectedPeriod))
    : "";

  // Extract questions from exit ticket
  const extractedQuestions = extractQuestionsFromExitTicket(selectedExitTicket);

  // Find existing in-class assignment for selected period
  const existingInClassAssignment = selectedPeriod && existingInClassAssignments
    ? existingInClassAssignments.find((a: any) => a.period_number === parseInt(selectedPeriod))
    : null;

  // Find existing at-home assignment for selected period
  const existingAtHomeAssignment = selectedPeriod && existingAtHomeAssignments
    ? existingAtHomeAssignments.find((a: any) => a.period_number === parseInt(selectedPeriod))
    : null;

  // Initialize edited questions when exit ticket changes
  useEffect(() => {
    if (selectedExitTicket && extractedQuestions.length > 0) {
      setEditedQuestions(extractedQuestions);
      setIsEditingQuestions(false);
    }
  }, [selectedExitTicket]);

  // Get period info (title/topic)
  const selectedPeriodInfo = selectedLesson && selectedPeriod 
    ? extractPeriodInfo(selectedLesson.lesson_content, parseInt(selectedPeriod))
    : { title: `Period ${selectedPeriod || ""}`, topic: `Period ${selectedPeriod || ""}` };

  const handleAssignInClass = async () => {
    if (!selectedLesson || !selectedPeriod) return;
    // Set assignment mode to in-class
    setAssignmentMode("in-class");
    // Open modal to collect class performance score
    setShowClassScoreModal(true);
    setClassPerformanceScore("");
  };

  const handleSaveClassAssignment = async () => {
    if (!selectedLesson || !selectedPeriod || classPerformanceScore === "") {
      toast.error("Please enter a class performance score");
      return;
    }

    const score = typeof classPerformanceScore === "string" ? parseFloat(classPerformanceScore) : classPerformanceScore;
    if (isNaN(score) || score < 0 || score > 100) {
      toast.error("Please enter a valid score between 0 and 100");
      return;
    }

    setIsAssigning(true);
    try {
      // Build exit ticket content from edited and new questions
      const allQuestions = [...editedQuestions, ...newQuestions].filter(q => q.trim());
      const exitTicketContent = allQuestions.length > 0
        ? allQuestions.map((q, idx) => `${idx + 1}. ${q}`).join("\n")
        : selectedExitTicket;

      // Save in-class assignment with performance score
      const assignmentData = {
        assigned_by: user?.id,
        lesson_id: selectedLesson.id,
        class_level: homeworkClass,
        section: homeworkSection,
        title: `${selectedLesson.subject || selectedLesson.curriculum || "General"} - Period ${selectedPeriod}`,
        questions: allQuestions,
        period_number: parseInt(selectedPeriod),
        period_title: selectedPeriodInfo.title,
        topic: selectedPeriodInfo.topic,
        subject: selectedLesson.subject || selectedLesson.curriculum || "General",
        exit_ticket_content: exitTicketContent,
        assignment_type: "in-class",
        class_performance_score: score,
        status: "active",
        // assigned_at will be set automatically by database DEFAULT once migration is applied
      };

      console.log("Inserting assignment:", assignmentData);
      
      const { data, error } = await supabase
        .from("homework_assignments")
        .insert([assignmentData] as any);

      if (error) {
        console.error("Supabase error:", error);
        throw new Error(error.message || "Failed to create assignment");
      }

      toast.success(`✓ Assignment created for Period ${selectedPeriod} (In Class)\n✓ Class Performance Score: ${score}%\n✓ This will be used for analytics and performance tracking.`);
      setShowClassScoreModal(false);
      setClassPerformanceScore("");
      setAssignmentMode("none");
      setSelectedPeriod("");
      setEditedQuestions([]);
      setNewQuestions([]);
      // Refresh the in-class assignments list to show the newly assigned homework
      queryClient.invalidateQueries({ queryKey: ["in-class-assignments", selectedLessonId, homeworkClass, homeworkSection, user?.id] });
    } catch (err: any) {
      console.error("Error assigning in-class:", err);
      toast.error(`Failed to create assignment: ${err.message || "Unknown error"}`);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleAssignAtHome = async () => {
    if (!selectedLesson || !selectedPeriod) return;
    setAssignmentMode("at-home");
    setIsAssigning(true);

    try {
      // Get student list for this class/section
      const { data: students } = await supabase
        .from("student_assessments")
        .select("student_name, id")
        .eq("student_class", homeworkClass)
        .eq("section", homeworkSection)
        .eq("teacher_id", user?.id);

      if (!students || students.length === 0) {
        toast.error("No students found in this class/section");
        setIsAssigning(false);
        return;
      }

      // Get unique student names and check which ones have full_name in profiles table
      const uniqueStudentNames = Array.from(new Set(students.map(s => s.student_name).filter(Boolean)));
      
      // Query profiles table to get only students with full_name populated
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("role", "student")
        .not("full_name", "is", null)
        .in("full_name", uniqueStudentNames);

      // Get the filtered list of students who have full names in profiles
      const studentsWithFullNames = profilesData ? profilesData.map(p => p.full_name) : [];
      
      if (studentsWithFullNames.length === 0) {
        toast.error("No students with registered names found in this class/section");
        setIsAssigning(false);
        return;
      }

      // Extract unique student names from the results
      const studentNames = Array.from(new Set(studentsWithFullNames));

      // Build exit ticket content from edited and new questions
      const allQuestions = [...editedQuestions, ...newQuestions].filter(q => q.trim());
      const exitTicketContent = allQuestions.length > 0
        ? allQuestions.map((q, idx) => `${idx + 1}. ${q}`).join("\n")
        : selectedExitTicket;

      // Create homework assignment for at-home with exit ticket questions
      const assignmentData = {
        assigned_by: user?.id,
        lesson_id: selectedLesson.id,
        class_level: homeworkClass,
        section: (homeworkSection || "").toUpperCase().trim(), // Normalize section for consistency
        title: `${selectedLesson.subject || selectedLesson.curriculum || "General"} - Period ${selectedPeriod}`,
        questions: allQuestions,
        period_number: parseInt(selectedPeriod),
        period_title: selectedPeriodInfo.title,
        topic: selectedPeriodInfo.topic,
        subject: selectedLesson.subject || selectedLesson.curriculum || "General",
        exit_ticket_content: exitTicketContent,
        assignment_type: "at-home",
        assigned_student_count: studentNames.length, // Count of students with full names
        status: "active",
        // assigned_at will be set automatically by database DEFAULT once migration is applied
      };

      console.log("Creating assignment with data:", assignmentData);

      const { data: assignment, error: assignmentError } = await supabase
        .from("homework_assignments")
        .insert([assignmentData] as any)
        .select();

      if (assignmentError || !assignment || assignment.length === 0) {
        console.error("Assignment error:", assignmentError);
        console.error("Assignment error details:", {
          message: assignmentError?.message,
          code: assignmentError?.code,
          details: assignmentError?.details,
          hint: assignmentError?.hint,
        });
        toast.error(`Failed to create homework assignment: ${assignmentError?.message || "Unknown error"}`);
        setIsAssigning(false);
        return;
      }

      console.log("Assignment created successfully:", assignment[0]);

      // Store confirmation data to show detailed dialog
      const questionsArray = allQuestions.length > 0 
        ? allQuestions 
        : ["Questions from exit ticket"];
      
      setAssignmentConfirmationData({
        period: selectedPeriod,
        periodTitle: selectedPeriodInfo.title,
        topic: selectedPeriodInfo.topic,
        subject: selectedLesson.subject || selectedLesson.curriculum || "General",
        studentCount: studentNames.length,
        studentList: studentNames, // Show student names from the class/section
        questionCount: questionsArray.length,
        questions: questionsArray,
      });
      
      toast.success(`✓ Homework assigned to ${studentNames.length} student${studentNames.length !== 1 ? 's' : ''} in ${homeworkClass} - Section ${homeworkSection}`);
      setShowAssignmentConfirmation(true);
      setAssignmentMode("none");
      setSelectedPeriod("");
      setEditedQuestions([]);
      setNewQuestions([]);
      // Refresh the at-home assignments list to show the newly assigned homework
      queryClient.invalidateQueries({ queryKey: ["at-home-assignments", selectedLessonId, homeworkClass, homeworkSection, user?.id] });
    } catch (err: any) {
      console.error("Error assigning at-home:", err);
      toast.error(`Failed to assign homework: ${err.message || "Unknown error"}`);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!selectedLesson) return;
    const timestamp = new Date().toLocaleString('en-US', { 
      year: 'numeric', month: '2-digit', day: '2-digit', 
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
    }).replace(/[/:]/g, '-');
    
    const filename = `APAS-LessonPlan-${selectedLesson.title}-${timestamp}.pdf`;
    
    let html = selectedLesson.lesson_content;
    
    // Tables
    html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (match, header, sep, body) => {
      const headerCells = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
    });
    
    // Headings
    html = html.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    
    // Bold and italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Blockquotes
    html = html.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');
    
    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>');
    
    // Lists
    html = html.replace(/^- (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.*?)$/gm, '<li>$1. $2</li>');
    
    // Wrap consecutive <li> in <ul>
    html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');
    
    // Paragraphs
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
          <div class="lc-field">
            <label>Class</label>
            <value>${CLASS_OPTIONS.find(c => c.value === homeworkClass)?.label}</value>
            <small>Section ${homeworkSection}</small>
          </div>
          <div class="lc-field">
            <label>Subject</label>
            <value>${selectedLesson.subject || 'General'}</value>
            <small>${selectedLesson.topic || 'Lesson Plan'}</small>
          </div>
          <div class="lc-field">
            <label>Report Type</label>
            <value>Lesson Plan</value>
            <small>Differentiated</small>
          </div>
        </div>

        <div class="content">
          ${html}
        </div>

        <div class="footer">
          <div class="footer-note">This report is auto-generated by the APAS AI engine. For academic use only.</div>
          <div class="footer-apas">APAS · ${new Date().getFullYear()}</div>
        </div>
      </div>
    `;
    
    // Ensure emoji font is available
    const metaCharset = document.createElement('meta');
    metaCharset.setAttribute('charset', 'utf-8');
    tempDiv.prepend(metaCharset);

    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
      * { font-family: 'DM Sans', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif; }
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
      
      .content { }
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
      filename: filename,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#f7f5f0' },
      jsPDF: { orientation: 'portrait' as const, unit: 'mm' as const, format: 'a4' as const, compress: true },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };
    
    const html2pdf = (await import("html2pdf.js")).default;
    html2pdf().set(opt).from(tempDiv).save();
    toast.success('PDF downloaded successfully!');
  };

  return (
    <div className="space-y-4">
      {/* Class & Section Selection */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="group">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Select Class</label>
          <Select value={homeworkClass} onValueChange={(val) => { setHomeworkClass(val); setHomeworkSection(""); setSelectedLessonId(""); }}>
            <SelectTrigger className="transition-all duration-300"><SelectValue placeholder="Choose a class..." /></SelectTrigger>
            <SelectContent>
              {CLASS_OPTIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="group">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Select Section</label>
          <Select value={homeworkSection} onValueChange={(val) => { setHomeworkSection(val); setSelectedLessonId(""); }} disabled={!homeworkClass}>
            <SelectTrigger className="transition-all duration-300"><SelectValue placeholder={!homeworkClass ? "Select a class first..." : "Choose a section..."} /></SelectTrigger>
            <SelectContent>
              {homeworkSections.map((s) => (
                <SelectItem key={s} value={s}>Section {s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Lesson Plan Selection */}
      {homeworkClass && homeworkSection && (
        <>
          <div className="group">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Select Lesson Plan</label>
            <Select value={selectedLessonId} onValueChange={setSelectedLessonId} disabled={isLoadingLessons}>
              <SelectTrigger className="transition-all duration-300">
                <SelectValue placeholder={isLoadingLessons ? "Loading..." : generatedLessons.length === 0 ? "No lesson plans available" : "Choose a lesson plan..."} />
              </SelectTrigger>
              <SelectContent>
                {generatedLessons.map((lesson) => (
                  <SelectItem key={lesson.id} value={lesson.id}>
                    {lesson.title} {lesson.periods_count && lesson.periods_count > 0 ? `(${lesson.periods_count} period${lesson.periods_count > 1 ? "s" : ""})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Student Count Display */}
          <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
              {homeworkStudentCount} student{homeworkStudentCount !== 1 ? "s" : ""} found. Homework will be assigned to this group
            </span>
          </div>

          {/* Action Buttons */}
          {selectedLesson && (
            <div className="space-y-3 pt-2">
              {selectedLesson.periods_count && selectedLesson.periods_count > 0 && (
                <div className="flex items-center gap-2 p-3 bg-primary/10 rounded-lg border border-primary/20">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-primary">
                    This lesson plan contains <strong>{selectedLesson.periods_count}</strong> period{selectedLesson.periods_count > 1 ? "s" : ""}
                  </span>
                </div>
              )}

              {/* Period Selection for Multi-Period Lessons */}
              {availablePeriods.length > 0 && (
                <div className="space-y-3">
                  {/* Only show period selector for multi-period lessons */}
                  {!isSinglePeriod && (
                    <div className="group">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Select Period to Assign Exit Ticket</label>
                      <Select value={selectedPeriod} onValueChange={(val) => setSelectedPeriod(val)}>
                        <SelectTrigger className="transition-all duration-300">
                          <SelectValue placeholder="Choose a period..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availablePeriods.map((period) => (
                            <SelectItem key={period.periodNumber} value={String(period.periodNumber)}>
                              Period {period.periodNumber} — {period.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Exit Ticket Display & Assignment */}
                  {selectedPeriod && (
                    <Card className="border-2 border-accent/20 bg-accent/5">
                      <CardHeader className="pb-3 border-b border-border/50">
                        <CardTitle className="text-sm flex items-center gap-2 text-accent">
                          <FileText className="h-4 w-4" />
                          {isSinglePeriod ? (
                            selectedPeriodInfo.title || "Assessment Questions"
                          ) : (
                            `Period ${selectedPeriod} — ${selectedPeriodInfo.title}`
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4">
                        {extractedQuestions.length > 0 ? (
                          <>
                            {/* Questions Display */}
                            <div className="space-y-3 mb-4">
                              {isEditingQuestions ? (
                                // Edit Mode
                                <div className="space-y-4">
                                  {/* Existing Questions Section */}
                                  <div>
                                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">Edit Existing Questions</p>
                                    {editedQuestions.map((question, idx) => (
                                      <div key={idx} className="space-y-1 mb-3">
                                        <label className="text-xs font-medium">Question {idx + 1}</label>
                                        <Textarea
                                          value={question}
                                          onChange={(e) => {
                                            const updated = [...editedQuestions];
                                            updated[idx] = e.target.value;
                                            setEditedQuestions(updated);
                                          }}
                                          className="text-sm"
                                          rows={2}
                                        />
                                      </div>
                                    ))}
                                  </div>

                                  {/* New Questions Section */}
                                  <div className="border-t border-border/30 pt-4">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-3 flex items-center gap-2">
                                      <Plus className="h-3.5 w-3.5" />
                                      Add New Questions
                                    </p>
                                    {newQuestions.map((question, idx) => (
                                      <div key={`new-${idx}`} className="space-y-1 mb-3">
                                        <label className="text-xs font-medium">New Question {idx + 1}</label>
                                        <div className="flex gap-2">
                                          <Textarea
                                            value={question}
                                            onChange={(e) => {
                                              const updated = [...newQuestions];
                                              updated[idx] = e.target.value;
                                              setNewQuestions(updated);
                                            }}
                                            placeholder="Enter new question..."
                                            className="text-sm flex-1"
                                            rows={2}
                                          />
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              const updated = newQuestions.filter((_, i) => i !== idx);
                                              setNewQuestions(updated);
                                            }}
                                            className="h-fit text-destructive hover:bg-destructive/10"
                                          >
                                            <X className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="gap-2 w-full"
                                      onClick={() => setNewQuestions([...newQuestions, ""])}
                                    >
                                      <Plus className="h-4 w-4" />
                                      Add Another Question
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                // Display Mode
                                <div className="space-y-2">
                                  {editedQuestions.concat(newQuestions).map((question, idx) => (
                                    <div key={idx} className="flex gap-3 items-start">
                                      <span className="text-sm font-semibold text-primary/70 flex-shrink-0">{idx + 1}.</span>
                                      <p className="text-sm text-foreground/85">{question}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-3 flex-col sm:flex-row pt-4 border-t border-border/30">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2 flex-1"
                                onClick={() => {
                                  if (isEditingQuestions) {
                                    setIsEditingQuestions(false);
                                  } else {
                                    setIsEditingQuestions(true);
                                  }
                                }}
                              >
                                {isEditingQuestions ? (
                                  <>
                                    <Check className="h-4 w-4" />
                                    Done Editing
                                  </>
                                ) : (
                                  <>
                                    <Wand2 className="h-4 w-4" />
                                    Edit Questions
                                  </>
                                )}
                              </Button>
                            </div>

                            {/* Assignment Buttons */}
                            {existingInClassAssignment && (
                              <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg mb-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1">
                                    <h4 className="font-semibold text-emerald-900 dark:text-emerald-100 flex items-center gap-2">
                                      <Check className="h-5 w-5" />
                                      In-Class Assignment Already Created
                                    </h4>
                                    <div className="mt-2 space-y-1 text-sm text-emerald-800 dark:text-emerald-200">
                                      <p><span className="font-medium">Assigned on:</span> {new Date(existingInClassAssignment.assigned_at).toLocaleString()}</p>
                                      <p><span className="font-medium">Class Performance Score:</span> <span className="font-bold text-lg">{existingInClassAssignment.class_performance_score}%</span></p>
                                      <p><span className="font-medium">Topic:</span> {existingInClassAssignment.topic}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {existingAtHomeAssignment && (
                              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg mb-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1">
                                    <h4 className="font-semibold text-blue-900 dark:text-blue-100 flex items-center gap-2">
                                      <Check className="h-5 w-5" />
                                      At-Home Assignment Already Assigned
                                    </h4>
                                    <div className="mt-2 space-y-1 text-sm text-blue-800 dark:text-blue-200">
                                      <p><span className="font-medium">Assigned on:</span> {new Date(existingAtHomeAssignment.assigned_at).toLocaleString()}</p>
                                      <p><span className="font-medium">Class:</span> {getClassLabel(existingAtHomeAssignment.class_level)}</p>
                                      <p><span className="font-medium">Section:</span> {existingAtHomeAssignment.section}</p>
                                      <p><span className="font-medium">Students Assigned:</span> <span className="font-bold">{existingAtHomeAssignment.assigned_student_count}</span></p>
                                      <p><span className="font-medium">Topic:</span> {existingAtHomeAssignment.topic}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="flex gap-3 flex-col sm:flex-row pt-3">
                              <Button
                                variant="outline"
                                className="gap-2 flex-1"
                                onClick={handleAssignInClass}
                                disabled={isAssigning || isEditingQuestions || !!existingInClassAssignment || assignmentMode === "at-home" || !!existingAtHomeAssignment}
                              >
                                <Users className="h-4 w-4" />
                                Assign In Class
                              </Button>
                              <Button
                                className={`gap-2 flex-1 ${!!existingAtHomeAssignment ? 'border-muted text-muted-foreground cursor-not-allowed' : ''}`}
                                onClick={handleAssignAtHome}
                                disabled={isAssigning || isEditingQuestions || assignmentMode === "in-class" || !!existingInClassAssignment || !!existingAtHomeAssignment}
                              >
                                <Home className="h-4 w-4" />
                                {existingAtHomeAssignment ? 'Already Assigned At Home ✓' : 'Assign At Home'}
                              </Button>
                            </div>
                          </>
                        ) : selectedExitTicket ? (
                          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg mb-4">
                            <p className="text-sm text-yellow-800 dark:text-yellow-200 font-semibold mb-2">
                              Could not extract questions from exit ticket. Showing raw content:
                            </p>
                            <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-3">
                              Check browser console (F12) for extraction debug logs
                            </p>
                            <div className="prose prose-sm dark:prose-invert max-w-none mt-3 max-h-96 overflow-y-auto">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                                {selectedExitTicket}
                              </ReactMarkdown>
                            </div>
                          </div>
                        ) : (
                          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                            <p className="text-sm text-yellow-800 dark:text-yellow-200">
                              Loading exit ticket content... If content doesn't appear:
                            </p>
                            <ul className="text-xs text-yellow-700 dark:text-yellow-300 mt-2 space-y-1">
                              <li>• Check browser console (F12) for error details</li>
                              <li>• Verify lesson plan was saved correctly</li>
                              <li>• Try selecting a different period</li>
                              <li>• Check the actual lesson content structure</li>
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="gap-2 flex-1 sm:flex-none"
                  onClick={() => setShowLessonPreview(!showLessonPreview)}
                >
                  <Eye className="h-4 w-4" />
                  View Full Lesson
                </Button>
                <Button
                  className="gap-2 flex-1 sm:flex-none"
                  onClick={handleDownloadPDF}
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Lesson Preview */}
      {showLessonPreview && selectedLesson && (
        <Card className="border-2 border-primary/10 shadow-lg mt-6">
          <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2 text-primary">
              <FileText className="h-5 w-5" />
              {selectedLesson.title}
            </CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowLessonPreview(false)}
              className="text-muted-foreground"
            >
              ✕
            </Button>
          </CardHeader>
          <CardContent className="p-6 max-h-[600px] overflow-y-auto">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                {selectedLesson.lesson_content}
              </ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Class Performance Score Modal */}
      <Dialog open={showClassScoreModal} onOpenChange={setShowClassScoreModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Enter Class Performance Score
            </DialogTitle>
            <DialogDescription>
              This score will be used for analytics and performance tracking of Period {selectedPeriod}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="score" className="text-sm font-medium">
                Class Performance Score (0-100)
              </label>
              <Input
                id="score"
                type="number"
                min="0"
                max="100"
                placeholder="Enter score..."
                value={classPerformanceScore}
                onChange={(e) => setClassPerformanceScore(e.target.value ? parseFloat(e.target.value) : "")}
                className="focus-visible:ring-primary"
              />
              <p className="text-xs text-muted-foreground">
                The score represents the overall performance level of the class in this period (0-100)
              </p>
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowClassScoreModal(false);
                setClassPerformanceScore("");
              }}
              disabled={isAssigning}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveClassAssignment}
              disabled={isAssigning || classPerformanceScore === ""}
              className="gap-2"
            >
              {isAssigning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Assign & Save Score
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assignment Confirmation Dialog */}
      <Dialog open={showAssignmentConfirmation} onOpenChange={setShowAssignmentConfirmation}>
        <DialogContent className="max-w-2xl max-h-96 overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-emerald-600" />
              Homework Successfully Assigned!
            </DialogTitle>
          </DialogHeader>
          
          {assignmentConfirmationData && (
            <div className="space-y-6">
              {/* Assignment Summary */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Period</p>
                  <p className="text-lg font-bold text-foreground">{assignmentConfirmationData.period}</p>
                  <p className="text-sm text-muted-foreground">{assignmentConfirmationData.periodTitle}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Topic</p>
                  <p className="text-sm font-semibold text-foreground">{assignmentConfirmationData.topic}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Subject</p>
                  <p className="text-sm font-semibold text-foreground">{assignmentConfirmationData.subject}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Questions</p>
                  <p className="text-lg font-bold text-primary">{assignmentConfirmationData.questionCount}</p>
                </div>
              </div>

              {/* Students List */}
              <div>
                <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Assigned to {assignmentConfirmationData.studentCount} Students
                </h4>
                <div className="grid grid-cols-2 gap-2 p-3 bg-muted/50 rounded-lg max-h-40 overflow-y-auto">
                  {assignmentConfirmationData.studentList.map((studentName: string, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                      <span className="text-foreground">{studentName}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Questions Preview */}
              <div>
                <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  Questions Students Will Answer
                </h4>
                <div className="space-y-2 p-3 bg-muted/50 rounded-lg max-h-40 overflow-y-auto">
                  {assignmentConfirmationData.questions.slice(0, 5).map((question: string, idx: number) => (
                    <div key={idx} className="text-sm">
                      <span className="font-semibold text-primary">{idx + 1}.</span>
                      <span className="text-foreground ml-2">{question}</span>
                    </div>
                  ))}
                  {assignmentConfirmationData.questions.length > 5 && (
                    <p className="text-xs text-muted-foreground italic">
                      ...and {assignmentConfirmationData.questions.length - 5} more question(s)
                    </p>
                  )}
                </div>
              </div>

              {/* Info Message */}
              <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                <p className="text-sm text-emerald-900 dark:text-emerald-100">
                  ✓ These questions will appear in each student's homework with full details (Topic, Period, Subject)
                </p>
                <p className="text-xs text-emerald-800 dark:text-emerald-200 mt-1">
                  Students will answer all questions and enter their test score before submission.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={() => {
                setShowAssignmentConfirmation(false);
                setAssignmentConfirmationData(null);
                toast.success("✓ Homework assignment complete!");
              }}
              className="gap-2"
            >
              <Check className="h-4 w-4" />
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Curative;









