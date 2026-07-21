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
import { Sparkles, Loader2, Send, GraduationCap, MessageSquare, Bot, User, Trash2, Users, BookOpen, Lock, Download, Globe, Check, Clock, BookMarked, Wand2, CalendarDays, FileText, Briefcase, Eye, Home, CheckCircle, Plus, X, History, Image as ImageIcon } from "lucide-react";
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
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
const CLASS_OPTIONS = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `Class ${i + 1}` })),
];

// --- Custom Markdown Components ---------------------------------------
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
      label = topic ? `? Watch on YouTube: ${topic}` : "? Watch on YouTube";
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
  { value: "scert", label: "SCERT" },
];


// --- Worksheet Prompt Builder ----------------------------------------------
interface WorksheetPromptParams {
  classLabel: string;
  section: string;
  varkType?: string;
  subject: string;
  chapter: string;
  topic: string;
  subtopic: string;
  studentCount: number;
  contextLine: string;
}

const buildWorksheetPrompt = ({
  classLabel, section, subject, chapter, topic, subtopic, studentCount, contextLine, varkType,
}: WorksheetPromptParams): string => {
  const VARK_INSTRUCTIONS: Record<string, string> = {
    visual: `Design ALL 12-15 activities specifically for VISUAL learners studying "${topic || chapter || subject}".
VISUAL ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Draw and label: Student draws the concept by hand and writes labels. Example instruction: "Draw a circle in the box below and write its name."
- Colour coding: List shapes/items as words. Student colours or circles each. Example: "Circle all triangles in blue."
- Pattern completion using symbols: Use O [] /\ as shape symbols. Example: O -- [] -- O -- [] -- ___
- Match with lines (text only): Write Column A and Column B as numbered/lettered text lists. Student draws lines.
- Sort into table: Give a word list, student writes items into a 2-3 column table drawn with | characters.
- Number line fill: 1---2---3---[___]---5  Student fills the blank.
- Spot the difference: Describe two similar things in words, student writes what differs.
STRICT RULE: NEVER write [Image: ...] or (Image of ...). Use text, symbols O [] /\, or "(Draw your answer in the box below)".`,

    auditory: `Design ALL 12-15 activities specifically for AUDITORY learners studying "${topic || chapter || subject}".
AUDITORY ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Say and write: "Say this aloud three times, then write the next item: 10, 20, 30, ___"
- Rhyme completion: Give a rhyme with blanks. Example: "Five, ten, ___, twenty - counting by fives is plenty!"
- Read aloud and answer: A short 3-4 sentence passage the student reads, then 3 questions below it.
- Echo pattern: "Continue the pattern you hear in your head: 100, 99, 98, ___, ___, ___"
- Circle the direction: "100, 99, 98, 97 - is this counting (Forward / Backward)?" Student circles one.
- Story with spoken numbers: Short story like "A bird sat on branch 125. It flew forward twice." Student writes the answer.
- Partner dictation: "Your partner says a number. Write the number that comes before it: ___"
STRICT RULE: NEVER write [Image: ...]. All activities must work as written text a student can read aloud.`,

    readwrite: `Design ALL 12-15 activities specifically for READ/WRITE learners studying "${topic || chapter || subject}".
READ/WRITE ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Definition match: Terms on left (A,B,C), definitions on right (1,2,3). Student writes matching pairs.
- Fill in the blank: Complete sentences using a word bank. Example: "A ___ has 3 sides." Word bank: [circle, triangle, square]
- Rewrite in own words: Give a rule or definition, student rewrites it simply.
- Jumbled facts: Give 4-5 facts out of order, student numbers them correctly.
- True or False with reason: Statement, student writes T/F and one sentence explaining why.
- Short answer: "Write 2 sentences explaining what forward counting means."
- Vocabulary table: | Word | Meaning | My sentence | - student fills all 3 columns.
- Compare table: Two columns (e.g. Forward Counting vs Backward Counting), student fills facts for each.
STRICT RULE: NEVER write [Image: ...]. All tasks must be purely text-based reading and writing.`,

    kinesthetic: `Design ALL 12-15 activities specifically for KINESTHETIC learners studying "${topic || chapter || subject}".
KINESTHETIC ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Cut and sort (written): Give a box of mixed words/numbers. Draw two columns below. Student writes each item in correct column.
- Trace and write: "Trace this shape with your finger: a square has 4 equal sides. Now draw it yourself in the box below."
- Act it out and record: "Start at 10. Hop forward 3 times. Write where you land: ___. Now hop back 2. Write it: ___"
- Build with symbols: "Use O for circles and [] for squares. Extend this pattern 4 more: O [] O [] ___ ___ ___ ___"
- Real-life scenario: "You have 15 apples. You give 4 to a friend. How many are left? Show your working: ___"
- Step-by-step activity: Numbered steps where each answer feeds the next. Student works through all steps in order.
- Paper game board: A simple 10-box path: [1]---[2]---[3]---[___]---[5]. Student fills answers to advance.
STRICT RULE: NEVER write [Image: ...]. All hands-on elements must use text instructions, symbols, or ASCII.`,

    general: `Design 12-15 activities covering ALL FOUR VARK learning styles for "${topic || chapter || subject}".
Label each section clearly. NEVER write [Image: ...] anywhere.

=== VISUAL (Activities 1-3) ===
Use: draw-and-label (text instructions only), symbol pattern completion (O [] /\), text-based matching tables, or colour-coding tasks written as text.

=== AUDITORY (Activities 4-6) ===
Use: say-and-write sequences, rhyme completion with blanks, echo patterns, or read-aloud-and-answer passages.

=== READ/WRITE (Activities 7-9) ===
Use: definition matching (text columns), fill-in-blank with word bank, true/false with reason, or vocabulary/compare tables.

=== KINESTHETIC (Activities 10-12) ===
Use: cut-and-sort (written version), act-it-out-and-record, real-life scenario, or paper game board path.

Each section must have exactly 3 activities. All 12 activities must be strictly about "${topic || chapter || subject}".`,
  };
  const varkInstruction = varkType && varkType !== "general"
    ? VARK_INSTRUCTIONS[varkType] ?? ""
    : VARK_INSTRUCTIONS["general"];
  const subjectLower = subject.toLowerCase();

  const isMath = /math|maths|arithmetic|algebra|geometry|number|numeracy/i.test(subjectLower);
  const isScience = /science|physics|chemistry|biology|evs|environment/i.test(subjectLower);
  const isLanguage = /english|language|grammar|reading|writing|literature|hindi|telugu|kannada|tamil/i.test(subjectLower);
  const isSocial = /social|history|geography|civics|gk|general knowledge/i.test(subjectLower);
  const isComputer = /computer|ict|coding|programming/i.test(subjectLower);

  let pageStructure = "";

  if (isMath) {
    pageStructure = `
2-3 activities on basic recognition and identification of "${topic || subject}" concepts (matching, visual, fill-in-the-blank)
2-3 activities on understanding and applying "${topic || chapter}" with equations and symbol work
2-3 story problem activities using real-life scenarios based on "${topic || subject}"
2-3 mixed practice and challenge activities with pattern recognition and higher-order thinking on "${topic}"
2-3 assessment and creative activities including a brain challenge and student-created problem on "${topic || subject}"`;
  } else if (isScience) {
    pageStructure = `
2-3 activities on identifying and labeling "${topic || subject}" concepts (diagrams, matching, true/false)
2-3 activities on understanding "${topic || chapter}" with fill-in-the-blank and sort/classify
2-3 activities exploring "${topic}" through observation, cause-effect, and real-life examples
2-3 activities applying "${topic}" to daily life with short answers and diagram completion
2-3 assessment and creative activities including a quiz and a draw/explain task on "${topic || subject}"`;
  } else if (isLanguage) {
    pageStructure = `
2-3 activities on recognizing and matching "${topic || subject}" (word/letter matching, tracing, identification)
2-3 vocabulary activities on "${chapter || topic}" (fill-in-blanks, word scramble, word building)
2-3 comprehension and grammar activities based on "${topic || chapter}" (passage, sentence completion)
2-3 writing activities applying "${topic}" (sentence formation, paragraph, creative prompt)
2-3 assessment and creative activities on "${topic || subject}" (quiz, grammar check, write your own)`;
  } else if (isSocial) {
    pageStructure = `
2-3 activities identifying and matching facts about "${topic || subject}" (maps, diagrams, true/false)
2-3 activities understanding key ideas of "${topic || chapter}" (fill-in-blank, define, sequence)
2-3 reading and comprehension activities about "${topic}" with cause-and-effect questions
2-3 activities applying "${topic}" to real-world context (short answer, compare-contrast)
2-3 assessment and creative activities on "${topic || subject}" (quiz, timeline, creative project)`;
  } else if (isComputer) {
    pageStructure = `
2-3 activities identifying parts and terms of "${topic || subject}" (matching, true/false, labeling)
2-3 activities on how "${topic || chapter}" works (fill-in-blanks, sequence steps, label diagrams)
2-3 practical activities applying "${topic}" to real-world technology use
2-3 problem-solving activities on "${topic}" (logic puzzles, flowchart, simple algorithm)
2-3 assessment and creative activities on "${topic || subject}" (quiz, design your own solution)`;
  } else {
    pageStructure = `
2-3 activities identifying and recognizing key elements of "${topic || subject}" (matching, labeling, true/false)
2-3 activities exploring "${topic || chapter}" concepts (fill-in-blank, sorting, definitions)
2-3 comprehension activities about "${topic}" (scenario/passage, questions, compare-contrast)
2-3 application activities connecting "${topic}" to real-life examples and short answers
2-3 assessment and creative activities on "${topic || subject}" (quiz, higher-order thinking, creative task)`;
  }

  return `Generate ONLY a student practice worksheet for ${classLabel} Section ${section}.

TOPIC LOCK: EVERY activity MUST be about "${topic || chapter || subject}" only. Never switch topics mid-worksheet.

SUBJECT: ${subject}${chapter ? ` | CHAPTER: ${chapter}` : ""}${topic ? ` | TOPIC: ${topic}` : ""}${subtopic ? ` | SUBTOPIC: ${subtopic}` : ""}

${varkInstruction}

At the very top write:
[Worksheet title about ${topic || chapter || subject}]
Name: ___________________________ Date: ___________________________

Then generate 12-15 activities. Separate each with ---. No page numbers or page headings.

${pageStructure}

RULES FOR EVERY ACTIVITY:
- Creative topic-specific title
- Clear 1-2 sentence instructions
- 1 worked example with the answer shown
- 4-8 questions with blanks written as ___ (underscores only, never backslashes)
- NEVER write [Image: ...] or (Image of ...) — use text, symbols O [] /\, or "(Draw your answer in the box below)"
- Matching tasks: write both sides as text lists, student draws connecting lines
- All content strictly about "${topic || chapter || subject}" for ${classLabel} students
- No individual student names

After all activities write "COMPLETE ANSWER KEY" with answers for every question.

CRITICAL: Output ONLY worksheet content. No lesson plan, no objectives, no VARK analysis, no BBL checklist. Stop after COMPLETE ANSWER KEY.`;
};
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

// --- Utility to extract and detect period count ----------------------
const extractPeriodsCount = (selectedPeriodsValue: string, lessonContent: string): number => {
  // First, try to use the selected periods value
  const selectedCount = parseInt(selectedPeriodsValue) || 1;
  
  // Then, verify by parsing the content to auto-detect periods
  const periodMatches = lessonContent.match(/## [^\w\n]* PERIOD (\d+)/g);
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

// --- Extract all periods from lesson content ---------------------------
const extractPeriods = (lessonContent: string): Array<{ periodNumber: number; title: string }> => {
  const periods: Array<{ periodNumber: number; title: string }> = [];
  
  // Remove intro text 
  const cleanContent = lessonContent.replace(/^[\s\S]*?(##|[^\w\n])/m, '$1');
  
  // Pattern 1: Multi-period format "## 📚 PERIOD 1 — Title"
  let periodRegex = /##\s*[^\w\n]*\s*PERIOD\s+(\d+)\s*[—-]\s*([^(\n]+)/gi;
  let match;
  
  while ((match = periodRegex.exec(cleanContent)) !== null) {
    const periodNumber = parseInt(match[1]);
    const title = match[2].trim();
    
    if (!periods.find(p => p.periodNumber === periodNumber)) {
      periods.push({ periodNumber, title });
    }
  }
  
  // Pattern 2: If no periods found, check for single-period format
  // (sections numbered like ?? 1. Learning Objectives, ?? 7. Assessment)
  if (periods.length === 0) {
    const hasAssessmentSection = /[^\w\n]*\s*\d+\.\s*Assessment|###\s*Assessment/i.test(cleanContent);
    if (hasAssessmentSection) {
      periods.push({ periodNumber: 1, title: 'Main Content' });
    }
  }
  
  return periods.sort((a, b) => a.periodNumber - b.periodNumber);
};

// --- Extract exit ticket for a specific period ------------------------
const extractExitTicket = (lessonContent: string, periodNumber: number): string => {
  if (!lessonContent) {
    console.log("No lesson content provided");
    return "";
  }

  const cleanContent = lessonContent.replace(/^[\s\S]*?(##|[^\w\n])/m, '$1');
  console.log("Extracting exit ticket for period:", periodNumber);
  console.log("Lesson content length:", cleanContent.length);
  
  // Check if multi-period or single-period format
  const isMultiPeriod = /##\s*[^\w\n]*\s*PERIOD\s+\d+/i.test(cleanContent);
  console.log("Is multi-period format:", isMultiPeriod);
  
  if (isMultiPeriod) {
    // Multi-period: Extract from "## ?? PERIOD X" section - be more flexible with the ending
    let periodRegex = new RegExp(
      `##\\s*[^\\w\\n]*\\s*PERIOD\\s+${periodNumber}[\\s\\S]*?(?=##\\s*[^\\w\\n]*|$)`,
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
    
    // First try: Look for "7. Assessment — Exit Ticket" or "?? 7." section (Evaluate Phase)
    let exitTicketMatch = null;
    
    // Try with various patterns for section 7
    const evaluatePatterns = [
      /###\s*[^\w\n]*\s*7\.?\s*Assessment[\s\S]*?(?=###|$)/i,
      /###\s*[^\w\n]*\s*7\.?\s*(?:Assessment|Evaluate)[\s\S]*?(?=###|$)/i,
      /###\s*[^\w\n]*\s*Assessment.*?Evaluate.*?Phase[\s\S]*?(?=###|$)/i,
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
      /[^\w\n]*\s*\d+\.\s*Assessment[\s\S]*?(?=[^\w\n]*\s*\d+\.|##|$)/i,
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

// --- Extract questions from exit ticket content -----------------------
const extractQuestionsFromExitTicket = (exitTicketContent: string): string[] => {
  if (!exitTicketContent) return [];
  
  // Remove markdown headers and metadata lines
  let cleanContent = exitTicketContent
    .replace(/^###\s*Assessment[\s\S]*?\n/i, '') // Remove header
    .replace(/^([^\w\n]*\s*\d+\.\s*)?Assessment[^\n]*\n/i, '') // Remove Assessment title
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

// --- Extract period title and topic ------------------------------------
const extractPeriodInfo = (lessonContent: string, periodNumber: number): { title: string; topic: string } => {
  const cleanContent = lessonContent.replace(/^[\s\S]*?(##|[^\w\n])/m, '$1');
  
  // Check if multi-period or single-period format
  const isMultiPeriod = /##\s*[^\w\n]*\s*PERIOD\s+\d+/i.test(cleanContent);
  
  if (isMultiPeriod) {
    // Extract from "## ?? PERIOD X — Title" or "## ?? PERIOD X: Title"
    const periodRegex = new RegExp(
      `##\\s*[^\\w\\n]*\\s*PERIOD\\s+${periodNumber}\\s*(?:[—:-]\\s*)?([^\\n]+)`,
      "i"
    );
    const matches = cleanContent.match(periodRegex);
    let title = matches ? matches[1].trim() : `Period ${periodNumber}`;
    
    // Clean up title - remove extra formatting
    title = title.replace(/\s*\(\d+\s*min(?:utes?)?\s*\).*/i, '').trim();
    
    return { title, topic: title };
  } else {
    // Single-period: Extract main topic from title or first section
    const titleRegex = /###\s*([^\n]+)|[^\w\n]*\s*\d+\.\s*([^\n]+)/i;
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

const stripEmojiForPdf = (text: string): string => {
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/gu, "").replace(/[ \t]+/g, " ").trim();
};
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
    body: JSON.stringify({ selectedClass, section, subject, prompt, mode, chatHistory, schoolId, isWorksheet: mode === "generate" && prompt.includes("COMPLETE ANSWER KEY") }),
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
  const [selectedVarkType, setSelectedVarkType] = useState<string>("general");
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

  // --- Chat history persistence (localStorage) --------------------------
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
    queryKey: ["curative-textbooks", selectedClass, profile?.school_id],
    queryFn: async () => {
      if (!selectedClass || !profile?.school_id) return [];
      const classLabel = selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1);
      const { data, error } = await supabase
        .from("books")
        .select("subject, book_name")
        .eq("class_name", classLabel)
        .eq("school_id", profile.school_id)
        .eq("is_active", true)
        .order("subject", { ascending: true });
      if (error || !data) return [];
      return data.map((b) => ({ fileName: b.book_name, subject: b.subject, chapter: "" }));
    },
    enabled: !!selectedClass && !!profile?.school_id,
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
    queryKey: ["chapters-by-class-subject", selectedClass, selectedSubject, profile?.school_id],
    queryFn: async () => {
      if (!selectedClass || !selectedSubject || !profile?.school_id) return [];
      const classLabel = selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1);
      const { data: books } = await supabase
        .from("books")
        .select("id")
        .eq("class_name", classLabel)
        .eq("subject", selectedSubject)
        .eq("school_id", profile.school_id)
        .eq("is_active", true);
      if (!books || books.length === 0) return [];
      const bookIds = books.map((b: any) => b.id);
      const { data: units } = await supabase
        .from("units")
        .select("id, unit_name, book_id")
        .in("book_id", bookIds)
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
    enabled: !!selectedClass && !!selectedSubject && !!profile?.school_id,
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
    const currentVarkType = selectedVarkType ?? "general";

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

            // Detect if this is a worksheet (worksheet prompts produce PAGE 1..5 + ANSWER KEY)
            const isWorksheet = assistantSoFar.includes("COMPLETE ANSWER KEY") && assistantSoFar.includes("ANSWER KEY") && !assistantSoFar.includes("Exit Ticket") && !assistantSoFar.includes("BBL Compliance");

            if (isWorksheet) {
              // Save worksheet to worksheets table
              try {
                const { data: wsInsertData } = await supabase.from("worksheets").insert({
                  teacher_id: user?.id || null,
                  school_id: profile?.school_id || null,
                  class_level: selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1),
                  section: selectedSection,
                  subject: currentSubject,
                  chapter: selectedChapter || null,
                  topic: currentTopic || null,
                  subtopic: selectedSubtopic || null,
                  academic_year: academicYear,
                  worksheet_content: assistantSoFar,
                  page_count: (assistantSoFar.match(/PAGE \d+/g) || []).length || 5,
                  ai_generated: true,
                  vark_type: currentVarkType,
                } as any).select("id").single();

                // Trigger image generation in background (non-blocking)
                if (wsInsertData?.id) {
                  supabase.functions.invoke("generate-worksheet-image", {
                    body: {
                      worksheet_id: wsInsertData.id,
                      worksheet_content: assistantSoFar,
                      topic: currentTopic || currentSubject,
                      vark_type: currentVarkType,
                    },
                  }).catch((err: any) => console.warn("Image generation failed:", err));
                }
              } catch (err) {
                console.error("Failed to save worksheet:", err);
              }
            } else {
              // Save as lesson plan
              try {
                const classLabel = getClassLabel(selectedClass);
                const title = `${classLabel}-${selectedSection} ${currentSubject}${currentTopic ? ` ${currentTopic}` : ""}`;
                const periodsCount = extractPeriodsCount(selectedPeriods, assistantSoFar);
                await supabase.from("lessons").insert({
                  title,
                  subject: currentSubject,
                  curriculum: selectedCurriculum || "",
                  class_level: selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1),
                  section: selectedSection,
                  lesson_content: assistantSoFar,
                  ai_generated: true,
                  vark_type: currentVarkType,
                  topic: currentTopic,
                  teacher_id: user?.id || null,
                  periods_count: periodsCount,
                } as any);
              } catch (err) {
                console.error("Failed to save lesson plan:", err);
              }
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
  }, [selectedClass, selectedSection, selectedSubject, selectedChapter, selectedCurriculum, topicValue, chatMessages, isStreaming, user?.id, persistCurrentSession, selectedVarkType]);

  const getPeriodBreakdown = (periods: number) => {
    if (periods === 1) return "a single period";
    return `${periods} periods (spread across ${periods} teaching sessions)`;
  };

  const handleGenerateWorksheet = async () => {
    const subjectLabel = selectedSubject ? extractSubjectName(selectedSubject) : "General";
    const chapterLabel = selectedChapter || "";
    const topicLabel = topicValue.trim() || "";
    const subtopicLabel = selectedSubtopic || "";
    const classLevelLabel = selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1);

    // Duplicate check: prevent regenerating an identical worksheet
    try {
      let dupQuery = supabase
        .from("worksheets")
        .select("id, worksheet_content, created_at")
        .eq("class_level", classLevelLabel)
        .eq("section", selectedSection)
        .eq("subject", subjectLabel)
        .eq("vark_type", selectedVarkType || "general");

      dupQuery = chapterLabel ? dupQuery.eq("chapter", chapterLabel) : dupQuery.is("chapter", null);
      dupQuery = topicLabel ? dupQuery.eq("topic", topicLabel) : dupQuery.is("topic", null);
      dupQuery = subtopicLabel ? dupQuery.eq("subtopic", subtopicLabel) : dupQuery.is("subtopic", null);

      if (user?.id) dupQuery = dupQuery.eq("teacher_id", user.id);

      const { data: existing, error: dupErr } = await dupQuery
        .order("created_at", { ascending: false })
        .limit(1);

      if (!dupErr && existing && existing.length > 0) {
        const existingWs = existing[0] as any;
        const hasContent = typeof existingWs.worksheet_content === "string" && existingWs.worksheet_content.trim().length > 0;

        if (hasContent) {
          const labelParts = [subjectLabel, chapterLabel, topicLabel, subtopicLabel].filter(Boolean).join(" - ");
          const userPrompt = `Generate a worksheet for ${getClassLabel(selectedClass)}-${selectedSection} - ${labelParts}`;
          setChatMessages([
            { role: "user", content: userPrompt },
            { role: "assistant", content: existingWs.worksheet_content },
          ]);
          setHasGeneratedContent(true);
          toast.success(
            `Worksheet already generated for this topic${subtopicLabel ? ` (Subtopic: ${subtopicLabel})` : topicLabel ? ` (Topic: ${topicLabel})` : ""}. Loaded the existing worksheet.`,
            { duration: 6000 }
          );
          return;
        } else {
          await supabase.from("worksheets").delete().eq("id", existingWs.id);
          toast.info("Found an incomplete previous worksheet - regenerating now.");
        }
      }
    } catch (err) {
      console.error("Duplicate worksheet check failed:", err);
    }

    const contextLine = [
      subjectLabel,
      chapterLabel && `Chapter: ${chapterLabel}`,
      topicLabel && `Topic: ${topicLabel}`,
      subtopicLabel && `Subtopic: ${subtopicLabel}`,
    ].filter(Boolean).join(" | ");

    const prompt = buildWorksheetPrompt({
      classLabel: getClassLabel(selectedClass),
      section: selectedSection,
      varkType: selectedVarkType,
      subject: subjectLabel,
      chapter: chapterLabel,
      topic: topicLabel,
      subtopic: subtopicLabel,
      studentCount,
      contextLine,
    });

    sendMessage(prompt, "generate");
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
        .select("id, title, lesson_content, created_at, section")
        .eq("class_level", selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1))
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
          const sourceSection = existingLesson.section && existingLesson.section !== selectedSection
            ? ` (originally generated for Section ${existingLesson.section})`
            : "";
          toast.success(
            `Loaded existing lesson plan for ${getClassLabel(selectedClass)} • ${subjectName}${topicTrimmed ? ` • "${topicTrimmed}"` : ""}${sourceSection}. Change topic, periods, or curriculum to generate a new one.`,
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
    const subjectLower2 = (selectedSubject ? extractSubjectName(selectedSubject) : "").toLowerCase();
    const isTelugu = /telugu/.test(subjectLower2);
    const isHindi = /hindi/.test(subjectLower2);
    const languageInstruction = isTelugu
      ? "\nIMPORTANT: This is a Telugu language subject. Generate the ENTIRE lesson plan content in Telugu language only."
      : isHindi
      ? "\nIMPORTANT: This is a Hindi language subject. Generate the ENTIRE lesson plan content in Hindi language only."
      : "";

    sendMessage(
      `Generate a COMPLETE LESSON PLAN for ${getClassLabel(selectedClass)} Section ${selectedSection}${subjectText}${chapterText}${topicText}${curriculumText} with ${studentCount} students.${languageInstruction}

TOTAL PERIODS: ${periods}
PERIOD DURATION: ${periodDurationMin} minutes each

CRITICAL TIME BUDGET: The Entry Ticket, Hook Activity, Main Teaching, Activities, Quick Check, Closure, and Exit Ticket sections in EACH period MUST sum to EXACTLY ${periodDurationMin} minutes total - not one minute more or less. Suggested proportional split (scale for the actual duration): Entry Ticket ~8%, Hook Activity ~12%, Main Teaching ~45%, Activities ~20%, Quick Check ~5%, Closure ~5%, Exit Ticket ~5%. State the actual rounded minutes for each section in its heading, and double-check the sum equals ${periodDurationMin} minutes before finishing.

${periods > 1 ? `CRITICAL STRUCTURE REQUIREMENT: This lesson plan MUST be divided into exactly ${periods} PERIODS. Each period is ${periodDurationMin} minutes. 

MANDATORY SECTION STRUCTURE FOR EVERY PERIOD (do NOT deviate):
Each period MUST have EXACTLY these 8 sections in this order:

### 🎯 1. Learning Objectives
- Clear, measurable objectives for THIS period using Bloom's taxonomy

### Entry Ticket - Prior Knowledge Check (Period 1 ONLY - 3-5 minutes)
- Exactly 5 NUMBERED basic questions (1. 2. 3. 4. 5.) checking students' prior/basic knowledge of this topic BEFORE teaching begins
- Questions must be simple, quick-answer (yes/no, one word, or one line), testing only foundational understanding - NOT the new content about to be taught
- Include this section ONLY in Period 1. Skip it entirely for Period 2 onward.

### 🧠 2. Introduction — Hook Activity (First [X] minutes — PRIMACY EFFECT)
- Engaging opening that captures attention
- X = approximately 20% of period duration

### 📚 3. Main Teaching — Chunked Delivery (10-2-10 Rule)
- Chunk 1: Input ? 2-min Processing ? Application (with 3-tier differentiation)
- Chunk 2: Input ? 2-min Processing ? Application (with 3-tier differentiation)
- Chunk 3: (if time permits) Input ? 2-min Processing ? Application
- Include VARK-aligned activities for Visual, Auditory, Read/Write, Kinesthetic learners

### 🤝 4. Activities — Differentiated Group Work ([X] minutes)
- Group-based collaborative activities
- 3-tier tasks: Support/Core/Extension for mixed ability groups
- X = approximately 30-40% of period duration

### ✅ 5. Assessment — Quick Check ([X] minutes)
- Formative assessment to check understanding
- Quick quiz, observation checklist, or interactive check
- X = approximately 10% of period duration

### 🔁 6. Closure — Revision Activity (Last [X] minutes — RECENCY EFFECT)
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

### ✅ 8. BBL Compliance Checklist
- Primacy Effect applied: ?
- Recency Effect applied: ?
- Cognitive Load managed: ?
- Social Brain activated: ?
- VARK differentiation: ?
- 3-tier scaffolding: ?

---

NOW APPLY THIS STRUCTURE TO ALL ${periods} PERIODS:

## 🎯 Overall Learning Objectives (for the complete unit across all periods)
(3-5 cumulative objectives for the entire ${periods}-period lesson)

---
## 📚 PERIOD 1 — [Sub-topic Title]
[Apply the 8-section structure above]

---
## 📚 PERIOD 2 — [Sub-topic Title]
[Apply the 8-section structure above, building on Period 1]

... repeat for ALL ${periods} periods ...

---
## 📚 PERIOD ${periods} — [Sub-topic Title]
[Apply the 8-section structure above with comprehensive review]

---
## Learning Outcomes
(What students can do after completing all ${periods} periods)

---

CRITICAL REQUIREMENTS:
✅ EVERY period (1 through ${periods}) MUST have ALL 8 sections
✅ Section 7 (Evaluate Phase Exit Ticket) MUST have numbered questions (1. 2. 3. etc.)
✅ Period timings MUST total exactly ${periodDurationMin} minutes per period
✅ Content must be distributed evenly across ${periods} periods with progressive complexity
✅ Each period builds on previous learning
✅ Exit tickets must assess THAT period's specific learning objectives
` : `Cover the complete topic within a single ${periodDurationMin}-minute period with full detail.

Auto-generate 3-5 clear, measurable learning objectives using simple Bloom's taxonomy action verbs.

Apply the same 8-section structure for the single period:
### 🎯 1. Learning Objectives
### Entry Ticket - Prior Knowledge Check (3-5 minutes)
- Exactly 5 NUMBERED basic questions (1. 2. 3. 4. 5.) checking students' prior/basic knowledge of this topic BEFORE teaching begins
- Questions must be simple, quick-answer (yes/no, one word, or one line), testing only foundational understanding - NOT the new content about to be taught
### 🧠 2. Introduction — Hook Activity
### 📚 3. Main Teaching — Chunked Delivery
### 🤝 4. Activities — Differentiated Group Work
### ✅ 5. Assessment — Quick Check
### 🔁 6. Closure — Revision Activity
### 📝 7. Assessment — Exit Ticket (5 minutes — Evaluate Phase)
[Include 3-5 NUMBERED exit ticket questions]
### ✅ 8. BBL Compliance Checklist`}

Generate ONLY the lesson plan (do NOT generate a diagnostic report). Include:
- Differentiated activities for each of the 4 VARK groups with 3-tier task cards (Support/Core/Extension)
- Mismatch alerts for at-risk groups
- ONE numbered Exit Ticket (Section 7 - Evaluate Phase) per period with 3-5 clear questions
- Read the textbook content for this chapter/unit and align all activities to the curriculum
${selectedCurriculum === "ib" ? "- Use Inquiry-Based methodology: K-W-L structure, Socratic questioning, transdisciplinary themes" : ""}${selectedCurriculum === "cbse" ? "- Use CBSE pedagogical approach with NCERT alignment" : ""}${selectedCurriculum === "cambridge" ? "- Use Project-Based Learning: real-world tasks, success criteria, practical experiments" : ""}${selectedCurriculum === "ai" ? "- Auto-detect the best pedagogical approach based on the subject, class level, and assessment data" : ""}

IMPORTANT: For each VARK learning style group (Visual, Auditory, Read/Write, Kinesthetic), LIST the actual student names that belong to that group based on their assessment data.

IMPORTANT: You MUST complete the ENTIRE lesson plan. Do NOT stop early or truncate. The plan MUST end with the "Learning Outcomes" section.

IMPORTANT: At the VERY END of the lesson plan, after Learning Outcomes, include a "📖 Word Decoder" section. This section MUST define every advanced/technical term used in the plan in simple, kid-friendly language. Format each term as:
🔍 **Term Name** = Simple explanation in 1-2 sentences that a parent or student can understand.
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
    
    const isWS = messageContent.includes("COMPLETE ANSWER KEY") && !messageContent.includes("Exit Ticket") && !messageContent.includes("BBL Compliance");
    const filename = isWS
      ? `APAS-Worksheet-${getClassLabel(selectedClass)}-Section${selectedSection}-${timestamp}.pdf`
      : `APAS-LessonPlan-${getClassLabel(selectedClass)}-Section${selectedSection}-${timestamp}.pdf`;
    
    // Convert markdown to structured HTML
    let html = messageContent;

    // Helper: friendly label for a YouTube link
    const makeYoutubeLabel = (url: string, fallback?: string): string => {
      try {
        const u = new URL(url);
        const q = u.searchParams.get('search_query') || u.searchParams.get('q');
        if (q) {
          const topic = decodeURIComponent(q.replace(/\+/g, ' ')).trim();
          return `? Watch on YouTube: ${topic}`;
        }
      } catch { /* ignore */ }
      if (fallback && !/^https?:/i.test(fallback)) return `? ${fallback}`;
      return '? Watch on YouTube';
    };

    // 1) Markdown links [text](url) — replace YouTube ones with friendly labels, all open in new tab
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => {
      const isYT = /youtube\.com|youtu\.be/i.test(url);
      const label = isYT ? makeYoutubeLabel(url, text) : text;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    // 2) Bare YouTube URLs ? friendly anchor
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
            <div class="brand">APAS <span>${isWS ? "Worksheet" : "Lesson Plan"}</span></div>
            <div class="report-label">${isWS ? "Practice Worksheet" : "Differentiated Lesson Plan"}</div>
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
            <value>${isWS ? "Worksheet" : "Lesson Plan"}</value>
            <small>${isWS ? "Practice Activities" : "Differentiated"}</small>
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
      .content ul li::before { content: '?'; position: absolute; left: 0; color: #0e9a7b; font-weight: 600; }
      
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

// Browser
if (!Capacitor.isNativePlatform()) {
  html2pdf().set(opt).from(tempDiv).save();
  toast.success("PDF downloaded successfully!");
  return;
}

// Android App
const worker = html2pdf().set(opt).from(tempDiv);

// Generate PDF as base64
const pdfBase64 = await worker.outputPdf("datauristring");

// Remove the prefix
const base64Data = pdfBase64.split(",")[1];

const permission = await Filesystem.checkPermissions();
if (permission.publicStorage !== "granted") {
  await Filesystem.requestPermissions();
}
const result = await Filesystem.writeFile({
  path: filename,
  data: base64Data,
  directory: Directory.Documents,
});
console.log("PDF SAVED:", result.uri);
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
      <div className="relative mb-6 md:mb-8 rounded-2xl overflow-hidden bg-gradient-to-br from-blue-700 via-sky-600 to-sky-700 p-5 md:p-8 shadow-xl animate-fade-in">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-10 w-16 h-16 bg-white/10 rounded-full" />
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
        <div className="overflow-x-auto scrollbar-hide pb-2">
          <TabsList className="flex w-max md:w-full md:max-w-4xl gap-3 bg-transparent p-0 h-auto">
                  <TabsTrigger value="lesson-plan" className="min-w-[140px] md:min-w-0 h-10 md:h-12 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-medium transition-all duration-300 hover:bg-slate-100 hover:shadow-md data-[state=active]:bg-gradient-to-r data-[state=active]:from-sky-500 data-[state=active]:to-sky-400 data-[state=active]:text-white data-[state=active]:border-transparent data-[state=active]:shadow-lg flex items-center justify-center gap-1.5 md:gap-2">
            <Wand2 className="h-4 w-4 md:h-6 md:w-6" /> Lesson Plan
          </TabsTrigger>
          <TabsTrigger value="assign-homework" className="min-w-[140px] md:min-w-0 h-10 md:h-12 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-medium transition-all duration-300 hover:bg-slate-100 hover:shadow-md data-[state=active]:bg-gradient-to-r data-[state=active]:from-sky-500 data-[state=active]:to-sky-400 data-[state=active]:text-white data-[state=active]:border-transparent data-[state=active]:shadow-lg flex items-center justify-center gap-1.5 md:gap-2">
            <Briefcase className="h-4 w-4 md:h-6 md:w-6" /> Assign Homework
          </TabsTrigger>
          <TabsTrigger value="worksheets" className="min-w-[140px] md:min-w-0 h-10 md:h-12 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-medium transition-all duration-300 hover:bg-slate-100 hover:shadow-md data-[state=active]:bg-gradient-to-r data-[state=active]:from-sky-500 data-[state=active]:to-sky-400 data-[state=active]:text-white data-[state=active]:border-transparent data-[state=active]:shadow-lg flex items-center justify-center gap-1.5 md:gap-2">
            <FileText className="h-4 w-4 md:h-6 md:w-6" /> Worksheets
            </TabsTrigger>
          <TabsTrigger value="generated-lessons" className="min-w-[140px] md:min-w-0 h-10 md:h-12 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-medium transition-all duration-300 hover:bg-slate-100 hover:shadow-md data-[state=active]:bg-gradient-to-r data-[state=active]:from-sky-500 data-[state=active]:to-sky-400 data-[state=active]:text-white data-[state=active]:border-transparent data-[state=active]:shadow-lg flex items-center justify-center gap-1.5 md:gap-2">
            <History className="h-4 w-4 md:h-6 md:w-6" /> My Lessons
            </TabsTrigger>
        </TabsList>
</div>
        <TabsContent value="lesson-plan" className="space-y-6 mt-0">
          {/* Configuration Card */}
          <Card className="border-2 border-blue-100 shadow-lg hover:shadow-xl transition-all duration-500 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-blue-600 via-sky-500 to-blue-500" />
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm md:text-base flex items-center gap-2 text-blue-700">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                <BookMarked className="h-5 w-5 md:h-7 md:w-7 text-blue-600" />
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
                  className="w-full sm:w-auto shrink-0 bg-gradient-to-r from-sky-500 to-sky-500 hover:from-sky-600 hover:to-sky-700 shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-sm md:text-base px-6 md:px-8 py-2.5 md:py-3 rounded-xl"
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
        <div className="relative rounded-t-2xl overflow-hidden bg-gradient-to-r from-indigo-700 via-blue-600 to-blue-600 p-4 md:p-5">
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
                  <>
                  {/* VARK Worksheet Type Selector */}
                  <div className="w-full max-w-2xl mb-3">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Worksheet type (for Worksheets button below)
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { id: "general",     label: "General",      bg: "bg-gray-100 dark:bg-gray-800",     ring: "ring-gray-400",   text: "text-gray-700 dark:text-gray-300" },
                        { id: "visual",      label: "Visual",       bg: "bg-purple-100 dark:bg-purple-900/40", ring: "ring-purple-400", text: "text-purple-800 dark:text-purple-300" },
                        { id: "auditory",    label: "Auditory",     bg: "bg-teal-100 dark:bg-teal-900/40",  ring: "ring-teal-400",   text: "text-teal-800 dark:text-teal-300" },
                        { id: "readwrite",   label: "Read / Write", bg: "bg-blue-100 dark:bg-blue-900/40",  ring: "ring-blue-400",   text: "text-blue-800 dark:text-blue-300" },
                        { id: "kinesthetic", label: "Kinesthetic",  bg: "bg-amber-100 dark:bg-amber-900/40", ring: "ring-amber-400",  text: "text-amber-800 dark:text-amber-300" },
                      ].map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelectedVarkType(v.id)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${v.bg} ${v.text} ${
                            selectedVarkType === v.id
                              ? `ring-2 ${v.ring} border-transparent`
                              : "border-border opacity-60 hover:opacity-100"
                          }`}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
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
                      onClick={handleGenerateWorksheet}
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
                  </>
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
                  <div className={`rounded-2xl px-4 md:px-5 py-3 md:py-4 max-w-[90%] sm:max-w-[85%] shadow-sm ${
  msg.role === "user" 
    ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white text-sm rounded-br-md" 
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
                    <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center mt-1 shadow-sm">
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
                className="h-10 w-10 md:h-11 md:w-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg hover:scale-[1.05] active:scale-[0.95] transition-all duration-300 shrink-0"
              >
                <Send className="h-4.5 w-4.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
        </TabsContent>

        {/* --- Assign Homework Tab --- */}
        <TabsContent value="assign-homework" className="space-y-6 mt-0">
          <AssignHomeworkTab user={user} profile={profile} getClassLabel={getClassLabel} />
        </TabsContent>

        {/* --- Worksheets Tab --- */}
        <TabsContent value="worksheets" className="space-y-6 mt-0">
          <WorksheetsTab user={user} profile={profile} getClassLabel={getClassLabel} />
        </TabsContent>
        {/* --- Generated Lesson Plans Tab --- */}
        <TabsContent value="generated-lessons" className="space-y-6 mt-0">
          <GeneratedLessonsTab user={user} profile={profile} getClassLabel={getClassLabel} />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
};

// --- Assign Homework Component ---------------------------------------
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
        .eq("class_level", getClassLabel(homeworkClass))
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
        .eq("class_level", getClassLabel(homeworkClass))
        .eq("section", homeworkSection)
        .eq("assignment_type", "in-class")
        .eq("school_id", profile?.school_id ?? "")
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
        .eq("class_level", getClassLabel(homeworkClass))
        .eq("section", homeworkSection)
        .eq("assignment_type", "at-home")
        .eq("school_id", profile?.school_id ?? "")
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
        class_level: getClassLabel(homeworkClass),
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
        school_id: profile?.school_id ?? null,
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

      toast.success(`? Assignment created for Period ${selectedPeriod} (In Class)\n? Class Performance Score: ${score}%\n? This will be used for analytics and performance tracking.`);
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
        class_level: getClassLabel(homeworkClass),
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
        school_id: profile?.school_id ?? null,
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
      
      toast.success(`? Homework assigned to ${studentNames.length} student${studentNames.length !== 1 ? 's' : ''} in ${homeworkClass} - Section ${homeworkSection}`);
      setShowAssignmentConfirmation(true);
      // Send push notification to students
try {
  await fetch(
    "https://qkclzrscyhzrbixajaiw.supabase.co/functions/v1/send-push-notification",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "homework_with_parents",
        payload: {
          school_id: profile?.school_id,
          class_level: getClassLabel(homeworkClass),
          section: (homeworkSection || "").toUpperCase().trim(),
          title: "📚 New Homework Assigned",
          body: `${assignmentData.subject}: ${selectedPeriodInfo.title}`,
          homework_id: assignment[0].id,
        },
      }),
    }
  );
} catch (notifError) {
  console.error("Notification failed:", notifError);
  // Don't block homework assignment if notification fails
}

toast.success(`✓ Homework assigned to ${studentNames.length} student...`);
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
      .content ul li::before { content: '?'; position: absolute; left: 0; color: #0e9a7b; font-weight: 600; }
      
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
if (!Capacitor.isNativePlatform()) {
  html2pdf().set(opt).from(tempDiv).save();
  toast.success("PDF downloaded successfully!");
} else {
  const worker = html2pdf().set(opt).from(tempDiv);

  const pdfBase64 = await worker.outputPdf("datauristring");
  const base64Data = pdfBase64.split(",")[1];

  await Filesystem.writeFile({
    path: filename,
    data: base64Data,
    directory: Directory.Documents,
  });

  toast.success("PDF downloaded successfully!");
}
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
                            "Assessment Questions / Exit Ticket Questions"
                          ) : (
                            `Period ${selectedPeriod} — Assessment Questions / Exit Ticket Questions`
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
                                        <div className="flex gap-2">
                                          <Textarea
                                            value={question}
                                            onChange={(e) => {
                                              const updated = [...editedQuestions];
                                              updated[idx] = e.target.value;
                                              setEditedQuestions(updated);
                                            }}
                                            className="text-sm flex-1"
                                            rows={2}
                                          />
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              const updated = editedQuestions.filter((_, i) => i !== idx);
                                              setEditedQuestions(updated);
                                            }}
                                            className="h-fit text-destructive hover:bg-destructive/10"
                                          >
                                            <X className="h-4 w-4" />
                                          </Button>
                                        </div>
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
                                {existingAtHomeAssignment ? 'Already Assigned At Home ?' : 'Assign At Home'}
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
              ?
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
                  ? These questions will appear in each student's homework with full details (Topic, Period, Subject)
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
                toast.success("? Homework assignment complete!");
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

// --- Worksheets Tab Component ---------------------------------------
interface WorksheetsTabProps {
  user: any;
  profile: any;
  getClassLabel: (value: string) => string;
}

interface WorksheetRow {
  id: string;
  teacher_id: string | null;
  school_id: string | null;
  class_level: string;
  section: string;
  subject: string;
  chapter: string | null;
  topic: string | null;
  subtopic: string | null;
  academic_year: string;
  worksheet_content: string;
  page_count: number;
  ai_generated: boolean;
  vark_type: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

const WorksheetsTab = ({ user, profile, getClassLabel }: WorksheetsTabProps) => {
  const [worksheetClass, setWorksheetClass] = useState("");
  const [worksheetSection, setWorksheetSection] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [varkFilter, setVarkFilter] = useState<string>("all");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const VARK_OPTIONS = [
    { id: "all",         label: "All Types",   color: "bg-gray-100 text-gray-700 border-gray-300" },
    { id: "visual",      label: "Visual",       color: "bg-purple-100 text-purple-800 border-purple-300" },
    { id: "auditory",    label: "Auditory",     color: "bg-teal-100 text-teal-800 border-teal-300" },
    { id: "readwrite",   label: "Read / Write", color: "bg-blue-100 text-blue-800 border-blue-300" },
    { id: "kinesthetic", label: "Kinesthetic",  color: "bg-amber-100 text-amber-800 border-amber-300" },
    { id: "general",     label: "General",      color: "bg-gray-100 text-gray-700 border-gray-300" },
  ];

  const { data: worksheetSections = [] } = useQuery({
    queryKey: ["worksheet-sections", worksheetClass, user?.id],
    queryFn: async () => {
      if (!worksheetClass || !user?.id) return DEFAULT_SECTIONS;
      const { data } = await supabase
        .from("student_assessments")
        .select("section")
        .eq("student_class", worksheetClass)
        .eq("teacher_id", user.id);
      if (!data || data.length === 0) return DEFAULT_SECTIONS;
      const unique = [...new Set(data.map((d) => (d.section || "").toUpperCase()).filter(Boolean))] as string[];
      return [...new Set([...unique, ...DEFAULT_SECTIONS])].sort();
    },
    enabled: !!worksheetClass && !!user?.id,
  });

  const { data: worksheetsList = [], isLoading: isLoadingWorksheets } = useQuery<WorksheetRow[]>({
    queryKey: ["worksheets-list", worksheetClass, worksheetSection, user?.id],
    queryFn: async () => {
      if (!worksheetClass || !worksheetSection || !user?.id) return [];
      const { data, error } = await supabase
        .from("worksheets")
        .select("*")
        .eq("class_level", getClassLabel(worksheetClass))
        .eq("section", worksheetSection)
        .eq("teacher_id", user.id)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Error fetching worksheets:", error);
        return [];
      }
      return (data as WorksheetRow[]) || [];
    },
    enabled: !!worksheetClass && !!worksheetSection && !!user?.id,
  });

  const handleDownloadWorksheetPDF = async (ws: WorksheetRow) => {
    const timestamp = new Date().toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).replace(/[\/:]/g, '-');
    const filename = `APAS-Worksheet-${ws.class_level}-Section${ws.section}-${timestamp}.pdf`;

    let html = ws.worksheet_content;

    html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((\|.+\|\n?)*)/gm, (match, header, sep, body) => {
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
    html = html.replace(/(^|[\s(])\*([^\*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
    html = html.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^[ \t]*[-*][ \t]+(.*?)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.*?)$/gm, '<li>$1. $2</li>');
    html = html.replace(/((?: <li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');
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
            <div class="brand">APAS <span>Worksheet</span></div>
            <div class="report-label">Practice Worksheet</div>
          </div>
          <div class="header-right">
            <div class="report-date">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            <div class="status-badge">AI Generated</div>
          </div>
        </div>
        <div class="learner-card">
          <div class="lc-field">
            <label>Class</label>
            <value>${ws.class_level}</value>
            <small>Section ${ws.section}</small>
          </div>
          <div class="lc-field">
            <label>Subject</label>
            <value>${ws.subject}</value>
            <small>${ws.topic || ws.chapter || 'Worksheet'}</small>
          </div>
          <div class="lc-field">
            <label>Report Type</label>
            <value>Worksheet</value>
            <small>Practice Activities</small>
          </div>
        </div>
        <div class="content">${html}</div>
        <div class="footer">
          <div class="footer-note">This worksheet is auto-generated by the APAS AI engine. For academic use only.</div>
          <div class="footer-apas">APAS · ${new Date().getFullYear()}</div>
        </div>
      </div>
    `;

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
      .content h1 { font-family: 'DM Serif Display', Georgia, serif; font-size: 18px; color: #1a1a2e; margin: 24px 0 10px 0; padding-bottom: 6px; border-bottom: 2px solid #0e9a7b; }
      .content h2 { font-family: 'DM Serif Display', Georgia, serif; font-size: 15px; color: #1a1a2e; margin: 20px 0 8px 0; padding-left: 12px; border-left: 4px solid #0e9a7b; }
      .content h3 { font-size: 13px; font-weight: 600; color: #3a3a5c; margin: 16px 0 6px 0; }
      .content h4 { font-size: 12px; font-weight: 600; color: #6b6b8a; margin: 12px 0 4px 0; }
      .content p { margin: 6px 0; text-align: justify; color: #3a3a5c; }
      .content strong { color: #1a1a2e; font-weight: 600; }
      .content em { font-style: italic; color: #6b6b8a; }
      .content ul { list-style: none; margin: 6px 0 6px 0; padding: 0; }
      .content ul li { position: relative; padding: 3px 0 3px 18px; color: #3a3a5c; }
      .content ul li::before { content: '?'; position: absolute; left: 0; color: #0e9a7b; font-weight: 600; }
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
if (!Capacitor.isNativePlatform()) {
  html2pdf().set(opt).from(tempDiv).save();
  toast.success("Worksheet PDF downloaded successfully!");
} else {
  const worker = html2pdf().set(opt).from(tempDiv);

  const pdfBase64 = await worker.outputPdf("datauristring");
  const base64Data = pdfBase64.split(",")[1];

  await Filesystem.writeFile({
    path: filename,
    data: base64Data,
    directory: Directory.Documents,
  });

  toast.success("Worksheet PDF downloaded successfully!");
}
  };

  const handleDownloadIllustratedPDF = async (ws: WorksheetRow) => {
    if (!ws.image_url) {
      toast.error("Illustrated image is still being generated. Please try again in a moment.");
      return;
    }
    try {
      toast.info("Downloading illustrated worksheet...");
      const ext = ws.image_url.split(".").pop()?.split("?")[0] ?? "jpg";
      const filename = `illustrated-worksheet-${ws.subject}-${ws.class_level}-${ws.section}.${ext}`;
      const response = await fetch(ws.image_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Illustrated worksheet downloaded!");
    } catch (err: any) {
      toast.error("Failed to download: " + err.message);
    }
  };
  const handleAssignWorksheet = async (ws: WorksheetRow) => {
    if (!user?.id || !profile?.school_id) { toast.error("Missing user or school info"); return; }
    setAssigningId(ws.id);
    try {
      const classNum = ws.class_level.replace("Class ", "");
      const { data: students } = await supabase
        .from("student_assessments").select("student_name")
        .eq("student_class", classNum).eq("section", ws.section)
        .eq("teacher_id", user.id).eq("school_id", profile.school_id);
      if (!students || students.length === 0) { toast.error("No students found"); return; }
      const uniqueNames = [...new Set(students.map((s: any) => s.student_name).filter(Boolean))];
      let targetStudents: string[] = uniqueNames as string[];
      if (ws.vark_type && ws.vark_type !== "general") {
        const { data: vs } = await supabase.from("student_assessments").select("student_name, vark_type")
          .eq("student_class", classNum).eq("section", ws.section)
          .eq("teacher_id", user.id).eq("school_id", profile.school_id).eq("vark_type", ws.vark_type);
        if (vs && vs.length > 0) {
          const vn = [...new Set(vs.map((s: any) => s.student_name).filter(Boolean))] as string[];
          if (vn.length > 0) targetStudents = vn;
        }
      }
const { error } = await supabase.from("worksheet_assignments").insert([{
  worksheet_id: ws.id,
  teacher_id: user.id,
  school_id: profile.school_id,
  class_level: ws.class_level,
  section: ws.section.toUpperCase().trim(),
  status: "active",
}] as any);
if (error) throw new Error(error.message);

// Send push notification to students
try {
  await fetch(
    "https://qkclzrscyhzrbixajaiw.supabase.co/functions/v1/send-push-notification",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "homework_with_parents",
        payload: {
          school_id: profile.school_id,
          class_level: ws.class_level,
          section: ws.section.toUpperCase().trim(),
          title: "New Worksheet Assigned",
          body: `${ws.subject}${ws.topic ? ": " + ws.topic : ""} - Practice worksheet is ready`,
          homework_id: ws.id,
        },
      }),
    }
  );
} catch (notifError) {
  console.error("Worksheet notification failed:", notifError);
}

const label = ws.vark_type && ws.vark_type !== "general" ? ws.vark_type + " learners" : "all students";
toast.success(`Worksheet assigned to ${targetStudents.length} ${label} in ${ws.class_level} Section ${ws.section}`);
    } catch (err: any) {
      toast.error(`Failed to assign: ${err.message || 'Unknown error'}`);
    } finally { setAssigningId(null); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="group">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Select Class</label>
          <Select value={worksheetClass} onValueChange={(val) => { setWorksheetClass(val); setWorksheetSection(""); }}>
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
          <Select value={worksheetSection} onValueChange={setWorksheetSection} disabled={!worksheetClass}>
            <SelectTrigger className="transition-all duration-300"><SelectValue placeholder={!worksheetClass ? "Select a class first..." : "Choose a section..."} /></SelectTrigger>
            <SelectContent>
              {worksheetSections.map((s) => (
                <SelectItem key={s} value={s}>Section {s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {worksheetClass && worksheetSection && (
        <>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Learning Style</label>
            <div className="flex flex-wrap gap-2">
              {VARK_OPTIONS.map((v) => (
                <button key={v.id} onClick={() => setVarkFilter(v.id)}
                  className={'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 ' + (varkFilter === v.id
                    ? (v.id === 'visual' ? 'bg-purple-600 text-white border-purple-600'
                      : v.id === 'auditory' ? 'bg-teal-600 text-white border-teal-600'
                      : v.id === 'readwrite' ? 'bg-blue-600 text-white border-blue-600'
                      : v.id === 'kinesthetic' ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-gray-800 text-white border-gray-800')
                    : v.color + ' opacity-70 hover:opacity-100')}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          {isLoadingWorksheets ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading worksheets...
            </div>
          ) : worksheetsList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-border rounded-xl">
              <FileText className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium text-foreground">No worksheets found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Generate a worksheet from the Lesson Plan tab for {getClassLabel(worksheetClass)} Section {worksheetSection} and it will show up here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {worksheetsList.filter(ws => varkFilter === "all" || (ws.vark_type ?? "general") === varkFilter).map((ws) => (
                <Card key={ws.id} className="border border-border/60 overflow-hidden">
                  <div className="p-4 flex items-start justify-between gap-3 flex-wrap">
                    {ws.vark_type && ws.vark_type !== "general" && (
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border mr-auto
                        ${ ws.vark_type === "visual"      ? "bg-purple-100 text-purple-800 border-purple-300"
                         : ws.vark_type === "auditory"    ? "bg-teal-100 text-teal-800 border-teal-300"
                         : ws.vark_type === "readwrite"   ? "bg-blue-100 text-blue-800 border-blue-300"
                         : ws.vark_type === "kinesthetic" ? "bg-amber-100 text-amber-800 border-amber-300"
                         : "bg-gray-100 text-gray-700 border-gray-300" }`}>
                        {ws.vark_type}
                      </span>
                    )}
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-xs gap-1">
                          <BookOpen className="h-3 w-3" /> {ws.subject}
                        </Badge>
                        {ws.chapter && <Badge variant="outline" className="text-xs">{ws.chapter}</Badge>}
                        {ws.topic && <Badge variant="outline" className="text-xs">{ws.topic}</Badge>}
                        {ws.subtopic && <Badge variant="outline" className="text-xs">{ws.subtopic}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {ws.page_count} page{ws.page_count !== 1 ? "s" : ""} · {ws.academic_year} · {new Date(ws.created_at).toLocaleDateString()} {new Date(ws.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setExpandedId(expandedId === ws.id ? null : ws.id)}
                      >
                        <Eye className="h-3.5 w-3.5" /> {expandedId === ws.id ? "Hide" : "View"}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700">
                            <Download className="h-3.5 w-3.5" /> Download
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[210px]">
                          <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => handleDownloadWorksheetPDF(ws)}>
                            <FileText className="h-3.5 w-3.5 text-green-600" />
                            <span>Download PDF of Activities</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => handleDownloadIllustratedPDF(ws)}>
                            <ImageIcon className="h-3.5 w-3.5 text-purple-600" />
                            <span>Download Image Worksheet</span>
                            {!ws.image_url && <span className="ml-auto text-[10px] text-amber-500">generating...</span>}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button size="sm" disabled={assigningId === ws.id} onClick={() => handleAssignWorksheet(ws)}
                        className={'gap-1.5 text-white ' + (ws.vark_type && ws.vark_type !== 'general'
                          ? (ws.vark_type === 'visual' ? 'bg-purple-600 hover:bg-purple-700'
                          : ws.vark_type === 'auditory' ? 'bg-teal-600 hover:bg-teal-700'
                          : ws.vark_type === 'readwrite' ? 'bg-blue-600 hover:bg-blue-700'
                          : 'bg-amber-500 hover:bg-amber-600')
                          : 'bg-indigo-600 hover:bg-indigo-700')}>
                        {assigningId === ws.id
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Assigning...</>
                          : ws.vark_type && ws.vark_type !== 'general'
                            ? <><Users className="h-3.5 w-3.5" /> Assign to {ws.vark_type} students</>
                            : <><Users className="h-3.5 w-3.5" /> Assign to Class</>}
                      </Button>
                    </div>
                  </div>
                  {expandedId === ws.id && (
                    <div className="border-t border-border/50 p-5 max-h-[500px] overflow-y-auto">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                          {ws.worksheet_content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};


// --- Generated Lesson Plans Tab Component ----------------------------
interface GeneratedLessonsTabProps {
  user: any;
  profile: any;
  getClassLabel: (value: string) => string;
}

interface GeneratedLessonRow {
  id: string;
  title: string;
  subject: string;
  topic: string | null;
  class_level: string;
  section: string;
  curriculum: string | null;
  periods_count: number | null;
  duration_minutes: number | null;
  completed: boolean;
  created_at: string;
  lesson_content: string | null;
}

const GeneratedLessonsTab = ({ user, getClassLabel }: GeneratedLessonsTabProps) => {
  const [filterClass, setFilterClass] = useState("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const queryClient = useQueryClient();

  const handleDownloadLessonPDF = async (lesson: GeneratedLessonRow) => {
    if (!lesson.lesson_content) {
      toast.error("No content available to download for this lesson");
      return;
    }
    const timestamp = new Date().toLocaleString("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).replace(/[/:]/g, "-");

    const filename = `APAS-LessonPlan-${lesson.title}-${timestamp}.pdf`;

    let html = lesson.lesson_content;

    html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (match, header, sep, body) => {
      const headerCells = header.split("|").filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join("");
      const rows = body.trim().split("\n").map((row: string) => {
        const cells = row.split("|").filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join("");
        return `<tr>${cells}</tr>`;
      }).join("");
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
    });

    html = html.replace(/^#### (.*?)$/gm, "<h4>$1</h4>");
    html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
    html = html.replace(/^> (.*?)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/^---$/gm, "<hr>");
    html = html.replace(/^- (.*?)$/gm, "<li>$1</li>");
    html = html.replace(/^(\d+)\. (.*?)$/gm, "<li>$1. $2</li>");
    html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, "<ul>$1</ul>");
    html = html.split("\n\n").map((para) => {
      const trimmed = para.trim();
      if (!trimmed || trimmed.startsWith("<h") || trimmed.startsWith("<ul") || trimmed.startsWith("<ol") || trimmed.startsWith("<table") || trimmed.startsWith("<blockquote") || trimmed.startsWith("<hr")) return trimmed;
      return "<p>" + trimmed.replace(/\n/g, "<br>") + "</p>";
    }).join("\n");

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = `
      <div class="report">
        <div class="header">
          <div class="header-left">
            <div class="brand">APAS <span>Lesson Plan</span></div>
            <div class="report-label">Differentiated Lesson Plan</div>
          </div>
          <div class="header-right">
            <div class="report-date">${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
            <div class="status-badge">AI Generated</div>
          </div>
        </div>
        <div class="learner-card">
          <div class="lc-field">
            <label>Class</label>
            <value>${getClassLabel(lesson.class_level)}</value>
            <small>Section ${lesson.section}</small>
          </div>
          <div class="lc-field">
            <label>Subject</label>
            <value>${lesson.subject || "General"}</value>
            <small>${lesson.topic || "Lesson Plan"}</small>
          </div>
          <div class="lc-field">
            <label>Report Type</label>
            <value>Lesson Plan</value>
            <small>Differentiated</small>
          </div>
        </div>
        <div class="content">${html}</div>
        <div class="footer">
          <div class="footer-note">This report is auto-generated by the APAS AI engine. For academic use only.</div>
          <div class="footer-apas">APAS · ${new Date().getFullYear()}</div>
        </div>
      </div>
    `;

    const metaCharset = document.createElement("meta");
    metaCharset.setAttribute("charset", "utf-8");
    tempDiv.prepend(metaCharset);

    const style = document.createElement("style");
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
      .content h1 { font-family: 'DM Serif Display', Georgia, serif; font-size: 18px; color: #1a1a2e; margin: 24px 0 10px 0; padding-bottom: 6px; border-bottom: 2px solid #0e9a7b; }
      .content h2 { font-family: 'DM Serif Display', Georgia, serif; font-size: 15px; color: #1a1a2e; margin: 20px 0 8px 0; padding-left: 12px; border-left: 4px solid #0e9a7b; }
      .content h3 { font-size: 13px; font-weight: 600; color: #3a3a5c; margin: 16px 0 6px 0; }
      .content h4 { font-size: 12px; font-weight: 600; color: #6b6b8a; margin: 12px 0 4px 0; }
      .content p { margin: 6px 0; text-align: justify; color: #3a3a5c; }
      .content strong { color: #1a1a2e; font-weight: 600; }
      .content em { font-style: italic; color: #6b6b8a; }
      .content ul { list-style: none; margin: 6px 0 6px 0; padding: 0; }
      .content ul li { position: relative; padding: 3px 0 3px 18px; color: #3a3a5c; }
      .content ul li::before { content: '•'; position: absolute; left: 0; color: #0e9a7b; font-weight: 600; }
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
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#f7f5f0" },
      jsPDF: { orientation: "portrait" as const, unit: "mm" as const, format: "a4" as const, compress: true },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    };

    const html2pdf = (await import("html2pdf.js")).default;

// Browser
if (!Capacitor.isNativePlatform()) {
  html2pdf().set(opt).from(tempDiv).save();
  toast.success("Lesson plan PDF downloaded successfully!");
  return;
}

try {
  // Android App
  const worker = html2pdf().set(opt).from(tempDiv);

  // Generate PDF as Base64
  const pdfData = await worker.outputPdf("datauristring");
  const base64Data = pdfData.split(",")[1];

  // Save into phone storage
  const result = await Filesystem.writeFile({
    path: filename,
    data: base64Data,
    directory: Directory.Documents,
  });

  console.log("Lesson PDF saved:", result);

  toast.success("Lesson plan PDF downloaded successfully!");
} catch (err) {
  console.error("Lesson PDF download failed:", err);
  toast.error("Failed to download PDF");
}
  };


  const { data: lessonsList = [], isLoading } = useQuery<GeneratedLessonRow[]>({
    queryKey: ["generated-lessons-list", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title, subject, topic, class_level, section, curriculum, periods_count, duration_minutes, completed, created_at, lesson_content")
        .eq("teacher_id", user.id)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Error fetching generated lessons:", error);
        return [];
      }
      return (data as GeneratedLessonRow[]) || [];
    },
    enabled: !!user?.id,
  });

  const filteredLessons = filterClass === "all"
    ? lessonsList
    : lessonsList.filter((l) => l.class_level === filterClass);

  const handleToggleCompleted = async (lesson: GeneratedLessonRow) => {
    setUpdatingId(lesson.id);
    try {
      const { error } = await supabase
        .from("lessons")
        .update({ completed: !lesson.completed })
        .eq("id", lesson.id);
      if (error) throw new Error(error.message);
      queryClient.invalidateQueries({ queryKey: ["generated-lessons-list", user?.id] });
      toast.success(!lesson.completed ? "Marked as completed" : "Marked as not completed");
    } catch (err: any) {
      toast.error(`Failed to update: ${err.message || "Unknown error"}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStartEdit = (lesson: GeneratedLessonRow) => {
    setEditingId(lesson.id);
    setEditedContent(lesson.lesson_content || "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditedContent("");
  };

  const handleSaveEdit = async (lesson: GeneratedLessonRow) => {
    setIsSavingEdit(true);
    try {
      const { error } = await supabase
        .from("lessons")
        .update({ lesson_content: editedContent })
        .eq("id", lesson.id);
      if (error) throw new Error(error.message);
      queryClient.invalidateQueries({ queryKey: ["generated-lessons-list", user?.id] });
      toast.success("Lesson plan updated");
      setEditingId(null);
    } catch (err: any) {
      toast.error(`Failed to save changes: ${err.message || "Unknown error"}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const uniqueClasses = [...new Set(lessonsList.map((l) => l.class_level).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Your Generated Lesson Plans</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track what you've covered in class by marking lessons as completed.
          </p>
        </div>
        {uniqueClasses.length > 0 && (
          <Select value={filterClass} onValueChange={setFilterClass}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {uniqueClasses.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading lesson plans...
        </div>
      ) : filteredLessons.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-border rounded-xl">
          <History className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-foreground">No lesson plans generated yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Generate a lesson plan from the Lesson Plan tab and it will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLessons.map((lesson) => (
            <Card
              key={lesson.id}
              className={`border overflow-hidden transition-colors ${
                lesson.completed ? "border-emerald-200 bg-emerald-50/40 dark:bg-emerald-900/10" : "border-border/60"
              }`}
            >
              <div
                className="p-4 flex items-start justify-between gap-3 flex-wrap cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expandedId === lesson.id ? null : lesson.id)}
              >
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs gap-1">
                      <BookOpen className="h-3 w-3" /> {lesson.subject}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {lesson.class_level} · Section {lesson.section}
                    </Badge>
                    {lesson.topic && <Badge variant="outline" className="text-xs">{lesson.topic}</Badge>}
                    {lesson.completed && (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs gap-1">
                        <Check className="h-3 w-3" /> Completed
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground">{lesson.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lesson.periods_count ? `${lesson.periods_count} period${lesson.periods_count > 1 ? "s" : ""}` : ""}
                    {lesson.duration_minutes ? ` · ${lesson.duration_minutes} min` : ""}
                    {" · "}
                    {new Date(lesson.created_at).toLocaleDateString()}{" "}
                    {new Date(lesson.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => { setExpandedId(lesson.id); setEditingId(lesson.id); setEditedContent(lesson.lesson_content || ""); }}
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => setExpandedId(expandedId === lesson.id ? null : lesson.id)}
                  >
                    <Eye className="h-3.5 w-3.5" /> {expandedId === lesson.id ? "Hide" : "View"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => handleDownloadLessonPDF(lesson)}
                  >
                    <Download className="h-3.5 w-3.5" /> Download PDF
                  </Button>
                  <Button
                    size="sm"
                    variant={lesson.completed ? "outline" : "default"}
                    disabled={updatingId === lesson.id}
                    onClick={() => handleToggleCompleted(lesson)}
                    className="gap-1.5 bg-cyan-500 text-white"
                  >
                    {updatingId === lesson.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : lesson.completed ? (
                      <X className="h-4 w-4 text-white" />
                    ) : (
                      <Check className="h-4 w-4 text-white" />
                    )}
                    {lesson.completed ? "Mark Incomplete" : "Mark Completed"}
                  </Button>
                </div>
              </div>
              {expandedId === lesson.id && (
                <div className="border-t border-border/50 p-5 max-h-[500px] overflow-y-auto">
                  {editingId === lesson.id ? (
                    <div className="space-y-3">
                      <Textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="min-h-[400px] font-mono text-xs leading-relaxed"
                      />
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={handleCancelEdit} disabled={isSavingEdit}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={() => handleSaveEdit(lesson)} disabled={isSavingEdit} className="gap-1.5">
                          {isSavingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save Changes
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-end mb-3">
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleStartEdit(lesson)}>
                          <Wand2 className="h-3.5 w-3.5" /> Edit Lesson Plan
                        </Button>
                      </div>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                          {lesson.lesson_content || "No content available for this lesson."}
                        </ReactMarkdown>
                      </div>
                    </>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Curative;

























