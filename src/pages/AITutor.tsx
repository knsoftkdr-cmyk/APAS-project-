import { useState, useRef, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Bot, Send, User, Loader2, Sparkles, GraduationCap, Compass, Zap, Globe2, Rocket, Lightbulb, Trash2, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";
import landingairobot from "@/assets/landing-ai-robot.png"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdaptivePracticeWidget } from "@/components/AdaptivePracticeWidget";
import { useLanguage } from "@/i18n/LanguageContext";
import { TUTOR_LANGUAGES, normaliseTutorLanguage } from "@/lib/tutorLanguages";
import { getAiAccessibilityFlags } from "@/lib/accessibility";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type ChatMode = "tutor" | "career";
type TutorStyle = "explain" | "socratic" | "hint";

const STYLE_CONFIG: Record<TutorStyle, { label: string; help: string }> = {
  explain: { label: "Explain", help: "Clear explanations and examples" },
  socratic: { label: "Socratic", help: "I'll guide you with questions instead of giving the answer" },
  hint: { label: "Hints", help: "Stuck on a problem? Get one small hint at a time" },
};
const MAX_HINT_LEVEL = 4;
type GradeBand = "pre_primary" | "early" | "upper_primary" | "middle" | "secondary";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/student-tutor-chat`;

// Maps raw `grade` values from the students table (e.g. "Class 7", "LKG", null)
// into an age band the Career Coach prompt can use to adjust tone.
function getGradeBand(grade: string | null | undefined): GradeBand | null {
  if (!grade) return "pre_primary";
  const normalized = grade.trim().toLowerCase();
  if (["lkg", "nursery", "ukg"].includes(normalized)) return "pre_primary";

  const match = normalized.match(/(\d+)/);
  if (!match) return null; // unrecognized format — treat as unknown, not pre_primary
  const num = parseInt(match[1], 10);

  if (num >= 1 && num <= 3) return "early";
  if (num >= 4 && num <= 6) return "upper_primary";
  if (num >= 7 && num <= 8) return "middle";
  if (num >= 9 && num <= 10) return "secondary";
  return null;
}

// Hardcoded intro shown instantly when Career Coach mode opens, so the
// student doesn't need to type anything first to see the discovery questions.
function getCareerIntroMessages(name?: string): Message[] {
  const who = name || "there";
  return [
    {
      role: "assistant",
      content: `Hi ${who}! I'm your AI Career Coach. Before I suggest anything, I'd love to get to know you a bit.`,
    },
    {
      role: "assistant",
      content: `What are some of your **favorite subjects** in school?`,
    },
  ];
}

const MODE_CONFIG: Record<ChatMode, {
  label: string;
  icon: typeof GraduationCap;
  greeting: string;
  description: string;
  placeholder: string;
  starterQuestions: string[];
}> = {
  tutor: {
    label: "AI Tutor",
    icon: GraduationCap,
    greeting: "I'm your AI Tutor.",
    description: "Ask me anything about your subjects — I know your learning style and can help with topics you find challenging!",
    placeholder: "Ask me anything...",
    starterQuestions: [
      "Explain photosynthesis simply",
      "Help me with fractions",
      "What are Newton's laws?",
      "Grammar tips for essays",
    ],
  },
  career: {
    label: "Career Coach",
    icon: Compass,
    greeting: "I'm your AI Career Coach.",
    description: "Let's explore career paths, subject choices, and skills to build — tailored to your interests and strengths!",
    placeholder: "Ask about careers, subjects, or your future path...",
    starterQuestions: [
      "What careers suit someone who likes science?",
      "Which subjects should I focus on?",
      "What skills should I build now?",
      "I don't know what I want to be",
    ],
  },
};

const AITutor = () => {
  const { user, profile } = useAuth();
  const { language: appLanguage } = useLanguage();
  const [searchParams] = useSearchParams();
  // Teaching language: follows the student's app language unless they pick another one here.
  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
  const teachingLanguage = languageOverride ?? normaliseTutorLanguage(appLanguage);
  // Tutor style (Explain / Socratic / Hints) and the current rung of the hint ladder.
  const [style, setStyle] = useState<TutorStyle>("explain");
  const [hintLevel, setHintLevel] = useState(1);
  // Guards for restoring saved chat history (ignore a stale/late load if the student already moved on).
  const loadSeq = useRef(0);
  const interacted = useRef(false);
  const [mode, setMode] = useState<ChatMode>(() =>
    searchParams.get("mode") === "career" ? "career" : "tutor"
  );
  const [messages, setMessages] = useState<Message[]>(() =>
    searchParams.get("mode") === "career" ? getCareerIntroMessages(profile?.full_name) : []
  );
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [gradeBand, setGradeBand] = useState<GradeBand | null>(null);
  const [gradeLoading, setGradeLoading] = useState(true);
  const [practicePickerOpen, setPracticePickerOpen] = useState(false);
  const [practiceBooks, setPracticeBooks] = useState<Array<{ id: number; subject: string; class_name: string | null }>>([]);
  const [practiceChapters, setPracticeChapters] = useState<Array<{ id: number; chapter_name: string }>>([]);
  const [practiceBookId, setPracticeBookId] = useState("");
  const [practiceScope, setPracticeScope] = useState<{ id: number; label: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConfig = MODE_CONFIG[mode];
  const ModeIcon = activeConfig.icon;

  // Career Coach is disabled for pre-primary students (LKG/Nursery/UKG/no grade on file)
  // and while we haven't finished checking yet, to avoid a flash of an enabled button.
  const isCareerDisabled = gradeLoading || gradeBand === "pre_primary" || gradeBand === null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Tutor memory: restore this student's saved conversation for the active mode. Saving is done by the
  // student-tutor-chat function; RLS lets a student read only their own rows.
  useEffect(() => {
    if (!user?.id) return;
    const seq = ++loadSeq.current;
    interacted.current = false;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("tutor_chat_messages")
        .select("role, content")
        .eq("student_id", user.id)
        .eq("mode", mode)
        .order("id", { ascending: false })
        .limit(40);
      if (error || seq !== loadSeq.current || interacted.current || !data?.length) return;
      setMessages((data as Message[]).slice().reverse());
    })();
  }, [user?.id, mode]);

  // Keep mode in sync if the sidebar link is clicked while already on this page
  // (React Router doesn't remount the component, so the initial useState alone won't catch it).
  useEffect(() => {
    const paramMode: ChatMode = searchParams.get("mode") === "career" ? "career" : "tutor";
    setMode(prev => {
      if (paramMode === prev) return prev;
      setMessages(paramMode === "career" ? getCareerIntroMessages(profile?.full_name) : []);
      return paramMode;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("mode")]);

  useEffect(() => {
    const fetchGrade = async () => {
      if (!user?.id) {
        setGradeLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("students")
        .select("grade")
        .eq("profile_id", user.id)
        .single();

      if (error) {
        console.error("Failed to fetch student grade:", error);
        setGradeBand(null);
      } else {
        setGradeBand(getGradeBand(data?.grade));
      }
      setGradeLoading(false);
    };
    fetchGrade();
  }, [user?.id]);

  // Safety net: if grade info arrives after the student already selected Career mode
  // and turns out to be pre-primary, drop back to Tutor mode automatically.
  useEffect(() => {
    if (mode === "career" && isCareerDisabled) {
      setMode("tutor");
      setMessages([]);
    }
  }, [isCareerDisabled]);

  const handleModeChange = (newMode: ChatMode) => {
    if (newMode === mode || isLoading) return;
    if (newMode === "career" && isCareerDisabled) return;
    setMode(newMode);
    setMessages(newMode === "career" ? getCareerIntroMessages(profile?.full_name) : []);
    setInput("");
  };

  const clearHistory = async () => {
    if (isLoading || !user?.id) return;
    if (!window.confirm("Clear your saved chat history with the tutor? This can't be undone.")) return;
    const { error } = await (supabase as any)
      .from("tutor_chat_messages").delete().eq("student_id", user.id).eq("mode", mode);
    if (error) { console.error("Failed to clear tutor history:", error); return; }
    interacted.current = true;
    setMessages(mode === "career" ? getCareerIntroMessages(profile?.full_name) : []);
    setHintLevel(1);
  };

  const changeStyle = (next: TutorStyle) => {
    if (next === style || isLoading) return;
    setStyle(next);
    setHintLevel(1);
  };

  // `override` lets the "Next hint" button send a canned message without touching the text box.
  const sendMessage = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || isLoading) return;
    const userMsg: Message = { role: "user", content: text };
    if (override === undefined) setInput("");
    interacted.current = true;
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    const activeStyle: TutorStyle = mode === "tutor" ? style : "explain";
    const levelForThisMessage = hintLevel;
    if (activeStyle === "hint") setHintLevel(l => Math.min(MAX_HINT_LEVEL, l + 1));

    let assistantSoFar = "";

    try {
      // Send the student's own session token so the server can verify who is chatting and save the history;
      // falls back to the publishable key (old behaviour, no saving) if there is no session.
      const { data: sessionData } = await supabase.auth.getSession();
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          message: userMsg.content,
          student_id: user?.id,
          conversation_history: messages.slice(-10),
          mode,
          grade_band: gradeBand,
          language: teachingLanguage,
          style: activeStyle,
          hint_level: levelForThisMessage,
          accessibility: getAiAccessibilityFlags(),
        }),
      });

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) throw new Error("Rate limit exceeded. Please wait a moment.");
        if (resp.status === 402) throw new Error("AI credits exhausted. Please contact your administrator.");
        let detail = "";
        try { detail = (await resp.json())?.error ?? ""; } catch { /* non-JSON body */ }
        console.error("Tutor chat failed:", resp.status, detail);
        throw new Error(detail || `The tutor is unavailable right now (error ${resp.status}). Please try again.`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantSoFar += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
                }
                return [...prev, { role: "assistant", content: assistantSoFar }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `Sorry, I couldn't answer just now. ${e.message || "Please try again."}` }]);
    }
    setIsLoading(false);
  };

  return (
    <AppLayout>
       <div className="relative flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto p-4 overflow-hidden">
        <PageHeader
          title={activeConfig.label}
          subtitle="Your personal 24/7 AI study companion"
          action={
            <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/enrichment"><Rocket className="h-4 w-4" /> Enrichment</Link>
            </Button>
            <Button
              variant="outline" size="sm" className="gap-1.5"
              onClick={async () => {
                setPracticePickerOpen(true);
                if (practiceBooks.length === 0) {
                  const { data } = await supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("subject");
                  setPracticeBooks(data ?? []);
                }
              }}
            >
              <Zap className="h-4 w-4" /> Adaptive Practice
            </Button>
            </div>
          }
        />

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-4">
          {(Object.keys(MODE_CONFIG) as ChatMode[]).map((key) => {
            const cfg = MODE_CONFIG[key];
            const Icon = cfg.icon;
            const active = mode === key;
            const disabled = isLoading || (key === "career" && isCareerDisabled);
            return (
              <span
                key={key}
                title={key === "career" && isCareerDisabled ? "Career Coach is available from Class 1 onward" : undefined}
              >
                <Button
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleModeChange(key)}
                  disabled={disabled}
                  className="gap-2"
                >
                  <Icon className="h-4 w-4" />
                  {cfg.label}
                </Button>
              </span>
            );
          })}
          <div className="ml-auto">
            <Select value={teachingLanguage} onValueChange={setLanguageOverride} disabled={isLoading}>
              <SelectTrigger className="h-9 w-[170px] gap-1" aria-label="Tutor language">
                <Globe2 className="h-4 w-4 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TUTOR_LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>{l.native}{l.code !== "en" ? ` (${l.name})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Teaching style (tutor mode only) + clear history */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {mode === "tutor" && (
            <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Teaching style">
              {(Object.keys(STYLE_CONFIG) as TutorStyle[]).map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant={style === key ? "default" : "ghost"}
                  className="h-7 px-3 text-xs"
                  disabled={isLoading}
                  title={STYLE_CONFIG[key].help}
                  onClick={() => changeStyle(key)}
                >
                  {STYLE_CONFIG[key].label}
                </Button>
              ))}
            </div>
          )}
          {mode === "tutor" && style !== "explain" && (
            <span className="text-xs text-muted-foreground">{STYLE_CONFIG[style].help}</span>
          )}
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs text-muted-foreground" onClick={clearHistory} disabled={isLoading}>
              <Trash2 className="h-3.5 w-3.5" /> Clear chat
            </Button>
          )}
        </div>

        {/* Chat Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
          {messages.length === 0 && (
            <div className="relative flex flex-col items-center justify-center h-full text-center gap-4 py-16">
              {/* Floating AI Robot */}

<div className="relative mb-6">
  <img
    src={landingairobot}
    alt="AI Robot"
    className="relative
      w-32
      md:w-[400px]
      animate-float
      drop-shadow-2xl
      left-32
      top-[60px]
    "
  />
  {/* Glow behind robot */}
  <div className="absolute inset-0 bg-blue-300/20 blur-3xl rounded-full -z-10"/></div>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <ModeIcon className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1">Hi {profile?.full_name || "there"}! 👋</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {activeConfig.greeting} {activeConfig.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {activeConfig.starterQuestions.map(q => (
                  <Button key={q} variant="outline" size="sm" onClick={() => { setInput(q); }}>
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const isQuestion = mode === "career" && msg.role === "assistant" && msg.content.includes("?");
            return (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isQuestion ? "bg-indigo-100" : "bg-primary/10"}`}>
                    <Bot className={`h-5 w-5 ${isQuestion ? "text-indigo-600" : "text-primary"}`} />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-5 py-4 text-base leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : isQuestion
                      ? "bg-gradient-to-br from-indigo-50 to-cyan-50 border-2 border-indigo-200 text-slate-800 font-medium shadow-sm"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-2 prose-strong:text-foreground">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-base">{msg.content}</p>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                    <User className="h-5 w-5 text-secondary-foreground" />
                  </div>
                )}
              </div>
            );
          })}

          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex gap-3 justify-start">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="bg-muted rounded-2xl px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Hint ladder controls */}
        {mode === "tutor" && style === "hint" && messages.length > 0 && !isLoading && messages[messages.length - 1]?.role === "assistant" && (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => sendMessage("I'm still stuck. Please give me the next hint.")}>
              <Lightbulb className="h-4 w-4" />
              {hintLevel >= MAX_HINT_LEVEL ? "Show me the full solution" : "Give me the next hint"}
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setHintLevel(1)}>
              <RotateCcw className="h-4 w-4" /> New problem
            </Button>
            <span className="text-xs text-muted-foreground">Hint {Math.min(hintLevel, MAX_HINT_LEVEL)} of {MAX_HINT_LEVEL} next</span>
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2 items-end">
          <Textarea
            placeholder={
              mode === "tutor" && style === "hint"
                ? (hintLevel <= 1 ? "Type the problem you're stuck on…" : "Try an answer, or tap “Give me the next hint”…")
                : activeConfig.placeholder
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            rows={1}
            className="min-h-[44px] max-h-32 resize-none"
          />
          <Button onClick={() => sendMessage()} disabled={isLoading || !input.trim()} size="icon" className="shrink-0 h-11 w-11">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={practicePickerOpen} onOpenChange={setPracticePickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">Adaptive Practice</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">Pick a subject and chapter — questions get harder or easier as you answer.</p>
          <div className="space-y-3">
            <Select value={practiceBookId} onValueChange={(v) => { setPracticeBookId(v); setPracticeChapters([]); }}>
              <SelectTrigger><SelectValue placeholder="Choose a subject" /></SelectTrigger>
              <SelectContent>
                {practiceBooks.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.subject}{b.class_name ? ` (${b.class_name})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              disabled={!practiceBookId}
              onValueChange={async (v) => {
                if (v === "__load__") return;
                const chapter = practiceChapters.find((c) => String(c.id) === v);
                if (chapter) { setPracticeScope({ id: chapter.id, label: chapter.chapter_name }); setPracticePickerOpen(false); }
              }}
              onOpenChange={async (open) => {
                if (open && practiceBookId && practiceChapters.length === 0) {
                  const { data } = await supabase
                    .from("curriculum_chapters").select("id, chapter_name, unit_id, units!inner(book_id)")
                    .eq("units.book_id", Number(practiceBookId));
                  setPracticeChapters((data as unknown as Array<{ id: number; chapter_name: string }>) ?? []);
                }
              }}
            >
              <SelectTrigger><SelectValue placeholder="Choose a chapter" /></SelectTrigger>
              <SelectContent>
                {practiceChapters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.chapter_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </DialogContent>
      </Dialog>

      {practiceScope && (
        <AdaptivePracticeWidget
          open={!!practiceScope}
          onOpenChange={(open) => !open && setPracticeScope(null)}
          scopeType="chapter"
          scopeId={practiceScope.id}
          scopeLabel={practiceScope.label}
          source="ai_tutor"
        />
      )}
    </AppLayout>
  );
};

export default AITutor;