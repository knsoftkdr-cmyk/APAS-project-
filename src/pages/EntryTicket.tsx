import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Sparkles, Loader2, ChevronDown, ChevronUp, FileText, CheckCircle2, Upload, X, Eye, GraduationCap, User, BookOpen, BookMarked, Layers, Hash, ClipboardList, Ticket } from "lucide-react";
const CLASS_OPTIONS = [
  { value: "1", label: "Class 1" },
  { value: "2", label: "Class 2" },
  { value: "3", label: "Class 3" },
  { value: "4", label: "Class 4" },
  { value: "5", label: "Class 5" },
  { value: "6", label: "Class 6" },
  { value: "7", label: "Class 7" },
  { value: "8", label: "Class 8" },
  { value: "9", label: "Class 9" },
  { value: "10", label: "Class 10" },
];

const SECTION_OPTIONS = ["A", "B", "C", "D"];

const CLASS_LABEL = "Whole Class";

interface Question {
  q_no: number;
  question: string;
}

interface TicketSession {
  id: string;
  class_level: string;
  section: string;
  subject: string;
  topic: string;
  subtopic: string;
  questions: Question[];
  total_marks: number;
  status: string;
  created_at: string;
}

interface TicketResponse {
  id: string;
  student_name: string;
  pre_score: number | null;
  post_score: number | null;
  total_marks: number;
  normalized_gain: number | null;
  gain_level: string | null;
}

type Phase = "setup" | "pre" | "post" | "results";

export default function EntryTicket() {
  const { user } = useAuth();

  // Setup form
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [topicValue, setTopicValue] = useState("");
  const [selectedSubtopic, setSelectedSubtopic] = useState("");
  const [totalMarks, setTotalMarks] = useState(10);

  // Session state
  const [phase, setPhase] = useState<Phase>("setup");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [preScore, setPreScore] = useState("");
  const [postScore, setPostScore] = useState("");
  const [savingScores, setSavingScores] = useState(false);
  const [responses, setResponses] = useState<TicketResponse[]>([]);

  // Past sessions
  const [pastSessions, setPastSessions] = useState<TicketSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const { data: profile } = useQuery({ queryKey: ["et-profile", user?.id], queryFn: async () => { if (!user?.id) return null; const { data } = await supabase.from("profiles").select("school_id").eq("id", user.id).single(); return data; }, enabled: !!user?.id });
  const { data: subjectsList = [] } = useQuery({ queryKey: ["et-subjects", selectedClass, profile?.school_id], queryFn: async () => { if (!selectedClass || !profile?.school_id) return []; const cl = selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1); const { data } = await supabase.from("books").select("subject").eq("class_name", cl).eq("school_id", profile.school_id).eq("is_active", true).order("subject"); if (!data) return []; return [...new Map(data.map((b) => [b.subject.toLowerCase(), b.subject])).values()]; }, enabled: !!selectedClass && !!profile?.school_id });
  const { data: chaptersList = [] } = useQuery({ queryKey: ["et-chapters", selectedClass, selectedSubject, profile?.school_id], queryFn: async () => { if (!selectedClass || !selectedSubject || !profile?.school_id) return []; const cl = selectedClass.match(/^\d+$/) ? `Class ${selectedClass}` : selectedClass.charAt(0).toUpperCase() + selectedClass.slice(1); const { data: books } = await supabase.from("books").select("id").eq("class_name", cl).eq("subject", selectedSubject).eq("school_id", profile.school_id).eq("is_active", true); if (!books?.length) return []; const bookIds = books.map((b) => b.id); const { data: units } = await supabase.from("units").select("id, unit_name").in("book_id", bookIds).eq("is_active", true).order("id"); if (!units?.length) return []; const unitIds = units.map((u) => u.id); const { data: chapters } = await supabase.from("curriculum_chapters").select("id, chapter_name, unit_id").in("unit_id", unitIds).eq("is_active", true).order("id"); if (!chapters) return []; return chapters.map((ch) => { const unit = units.find((u) => u.id === ch.unit_id); return { id: ch.id, chapter_name: ch.chapter_name, label: `${unit?.unit_name ?? ""}: ${ch.chapter_name}` }; }); }, enabled: !!selectedClass && !!selectedSubject && !!profile?.school_id });
  const { data: topicsList = [] } = useQuery({ queryKey: ["et-topics", selectedChapter], queryFn: async () => { if (!selectedChapter) return []; const ch = (chaptersList).find((c) => c.label === selectedChapter); if (!ch) return []; const { data } = await supabase.from("topics").select("id, topic_name").eq("chapter_id", ch.id).order("id"); return data || []; }, enabled: !!selectedChapter && chaptersList.length > 0 });
  const { data: subtopicsList = [] } = useQuery({ queryKey: ["et-subtopics", topicValue], queryFn: async () => { if (!topicValue) return []; const t = (topicsList).find((t) => t.topic_name === topicValue); if (!t) return []; const { data } = await supabase.from("subtopics").select("id, subtopic_name").eq("topic_id", t.id).eq("is_active", true).order("id"); return data || []; }, enabled: !!topicValue && topicsList.length > 0 });

  useEffect(() => {
    if (user) fetchPastSessions();
  }, [user]);

  async function fetchPastSessions() {
    setLoadingSessions(true);
    const { data, error } = await supabase
      .from("entry_tickets")
      .select("*")
      .eq("teacher_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(10);
    if (!error && data) setPastSessions(data);
    setLoadingSessions(false);
  }

  async function generateQuestions() {
    setError("");
    if (!selectedClass || !selectedSection || !selectedSubject || !selectedChapter) {
      setError("Please fill in all fields before generating questions.");
      return;
    }
    setLoadingQuestions(true);
    try {
      const classLabel = CLASS_OPTIONS.find(c => c.value === selectedClass)?.label || selectedClass;
      const { data, error: fnError } = await supabase.functions.invoke("generate-entry-ticket", {
        body: {
          subject: selectedSubject,
          chapter: selectedChapter,
          topic: topicValue,
          subtopic: selectedSubtopic,
          class_level: classLabel,
        },
      });
      if (fnError) throw fnError;
      setQuestions(data.questions || []);

      const { data: profile } = await supabase
        .from("profiles")
        .select("school_id")
        .eq("id", user!.id)
        .single();

      const classLabel2 = CLASS_OPTIONS.find(c => c.value === selectedClass)?.label || selectedClass;
      const { data: ticket, error: insertError } = await supabase
        .from("entry_tickets")
        .insert({
          school_id: profile?.school_id,
          teacher_id: user!.id,
          class_level: classLabel2,
          section: selectedSection,
          subject: selectedSubject,
          topic: topicValue,
          subtopic: selectedSubtopic,
          questions: data.questions,
          total_marks: totalMarks,
          status: "pre",
        })
        .select()
        .single();

      if (insertError) throw insertError;
      setTicketId(ticket.id);
      setPreScore("");
      setPostScore("");
      setResponseId(null);
      setPhase("pre");
    } catch (err: any) {
      setError(err.message || "Failed to generate questions.");
    }
    setLoadingQuestions(false);
  }

  async function savePreScores() {
    setError("");
    if (preScore.trim() === "") {
      setError("Please enter the class score.");
      return;
    }
    setSavingScores(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("school_id")
        .eq("id", user!.id)
        .single();

      const { data: inserted, error: insertError } = await supabase
        .from("ticket_responses")
        .insert({
          ticket_id: ticketId,
          school_id: profile?.school_id,
          student_name: CLASS_LABEL,
          pre_score: parseFloat(preScore),
          total_marks: totalMarks,
        })
        .select()
        .single();
      if (insertError) throw insertError;
      setResponseId(inserted.id);

      await supabase
        .from("entry_tickets")
        .update({ status: "post" })
        .eq("id", ticketId);

      setSuccessMsg("Entry ticket score saved! Now teach the topic, then come back for the Exit Ticket.");
      setPhase("post");
      fetchPastSessions();
    } catch (err: any) {
      setError(err.message || "Failed to save score.");
    }
    setSavingScores(false);
  }

  async function resumePreEntry(session: TicketSession) {
    setTicketId(session.id);
    setQuestions(session.questions);
    setTotalMarks(session.total_marks);
    setSelectedSubject(session.subject);
    setTopicValue(session.topic);
    setSelectedSubtopic(session.subtopic);

    const { data } = await supabase
      .from("ticket_responses")
      .select("*")
      .eq("ticket_id", session.id)
      .limit(1)
      .maybeSingle();

    if (data) {
      setResponseId(data.id);
      setPreScore(String(data.pre_score ?? ""));
    } else {
      setResponseId(null);
      setPreScore("");
    }
    setPostScore("");
    setPhase("pre");
    setShowPast(false);
    setSuccessMsg("");
    setError("");
  }

  async function loadSessionForPost(session: TicketSession) {
    setTicketId(session.id);
    setQuestions(session.questions);
    setTotalMarks(session.total_marks);
    setSelectedSubject(session.subject);
    setTopicValue(session.topic);
    setSelectedSubtopic(session.subtopic);

    const { data } = await supabase
      .from("ticket_responses")
      .select("*")
      .eq("ticket_id", session.id)
      .limit(1)
      .maybeSingle();

    if (data) {
      setResponseId(data.id);
      setPreScore(String(data.pre_score ?? ""));
    } else {
      setResponseId(null);
      setPreScore("");
    }
    setPostScore("");
    setPhase("post");
    setShowPast(false);
    setSuccessMsg("");
    setError("");
  }

  async function savePostScores() {
    setError("");
    if (postScore.trim() === "") {
      setError("Please enter the class post-score.");
      return;
    }
    setSavingScores(true);
    try {
      const pre = parseFloat(preScore || "0");
      const post = parseFloat(postScore);
      const prePct = (pre / totalMarks) * 100;
      const postPct = (post / totalMarks) * 100;
      let gain = prePct >= 100 ? 1 : (postPct - prePct) / (100 - prePct);
      gain = Math.max(-1, Math.min(1, parseFloat(gain.toFixed(3))));
      const gainLevel = gain >= 0.7 ? "high" : gain >= 0.3 ? "medium" : "low";

      if (responseId) {
        await supabase
          .from("ticket_responses")
          .update({ post_score: post, normalized_gain: gain, gain_level: gainLevel })
          .eq("id", responseId);
      } else {
        const { data: profile } = await supabase
          .from("profiles")
          .select("school_id")
          .eq("id", user!.id)
          .single();
        await supabase
          .from("ticket_responses")
          .insert({
            ticket_id: ticketId,
            school_id: profile?.school_id,
            student_name: CLASS_LABEL,
            pre_score: pre,
            post_score: post,
            total_marks: totalMarks,
            normalized_gain: gain,
            gain_level: gainLevel,
          });
      }

      await supabase
        .from("entry_tickets")
        .update({ status: "completed" })
        .eq("id", ticketId);

      const { data: results } = await supabase
        .from("ticket_responses")
        .select("*")
        .eq("ticket_id", ticketId);

      if (results) setResponses(results);
      setPhase("results");
      fetchPastSessions();
    } catch (err: any) {
      setError(err.message || "Failed to save post score.");
    }
    setSavingScores(false);
  }

  async function viewResults(session: TicketSession) {
    const { data } = await supabase
      .from("ticket_responses")
      .select("*")
      .eq("ticket_id", session.id);
    if (data) {
      setResponses(data);
      setTicketId(session.id);
      setSelectedSubject(session.subject);
      setTopicValue(session.topic);
      setSelectedSubtopic(session.subtopic);
      setTotalMarks(session.total_marks);
      setPhase("results");
      setShowPast(false);
    }
  }

  function resetAll() {
    setPhase("setup");
    setSelectedClass("");
    setSelectedSection("");
    setSelectedSubject("");
    setSelectedChapter("");
    setTopicValue("");
    setSelectedSubtopic("");
    setTotalMarks(10);
    setQuestions([]);
    setTicketId(null);
    setResponseId(null);
    setPreScore("");
    setPostScore("");
    setResponses([]);
    setError("");
    setSuccessMsg("");
  }

  function gainBadge(level: string | null) {
    if (level === "high") return "bg-green-100 text-green-700 border border-green-300";
    if (level === "medium") return "bg-yellow-100 text-yellow-700 border border-yellow-300";
    return "bg-red-100 text-red-700 border border-red-300";
  }

  const avgGain = responses.length
    ? (responses.reduce((s, r) => s + (r.normalized_gain ?? 0), 0) / responses.length).toFixed(2)
    : null;

  return (
    <AppLayout>
<div className="min-h-screen relative overflow-hidden" style={{ background: "linear-gradient(135deg, #ffffff, #eef2ff, #faf5ff)", backgroundSize: "cover" }}>
  {/* Faint wave at top */}
  <svg className="absolute top-0 left-0 w-full h-40 opacity-[0.06]" viewBox="0 0 1440 200" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,80 C240,140 480,20 720,60 C960,100 1200,20 1440,70 L1440,0 L0,0 Z" fill="#6366f1" />
  </svg>
  <svg className="absolute top-0 left-0 w-full h-32 opacity-[0.05]" viewBox="0 0 1440 200" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,40 C320,100 720,0 1440,50 L1440,0 L0,0 Z" fill="#8b5cf6" />
  </svg>

  {/* Floating circles, barely visible */}
  <div className="absolute top-24 right-16 w-40 h-40 rounded-full bg-indigo-300 opacity-[0.05] blur-2xl" />
  <div className="absolute top-96 left-10 w-56 h-56 rounded-full bg-violet-300 opacity-[0.04] blur-2xl" />
  <div className="absolute bottom-20 right-1/3 w-32 h-32 rounded-full bg-indigo-200 opacity-[0.05] blur-xl" />

  <div className="relative z-10 p-6">
      <div className="max-w-4xl lg:max-w-7xl mx-auto">

       {/* Header */}
<div className="rounded-2xl p-6 mb-4 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg">
  <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full"></div>
  <div className="absolute right-16 top-10 w-16 h-16 bg-white/10 rounded-full"></div>
  <div className="relative flex items-center gap-4">
    <Ticket className="h-10 w-10 text-white" />
    <div>
      <h1 className="text-2xl font-bold text-white">Entry Ticket</h1>
      <p className="text-indigo-100 text-sm mt-1">Measure student learning gain before and after a topic</p>
    </div>
  </div>
</div>

<div className="flex justify-end gap-2 mb-6">
  {phase !== "setup" && (
    <button onClick={resetAll} className="px-4 py-2 text-sm bg-white border border-blue-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 shadow-sm">
      + New Ticket
    </button>
  )}
  <button
    onClick={() => { setShowPast(!showPast); fetchPastSessions(); }}
    className="px-4 py-2 text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 font-medium"
  >
    Past Sessions
  </button>
</div>

        {/* Error / Success */}
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        {successMsg && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{successMsg}</div>}

        {/* Past Sessions Panel */}
        {showPast && (
          <div className="mb-6 bg-white rounded-2xl border border-purple-300 shadow-sm overflow-hidden hover:-translate-y-2 hover:shadow-2xl hover:border-indigo-300">
            <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
              <h2 className="font-semibold text-gray-800 text-sm">Past Ticket Sessions</h2>
            </div>
            {loadingSessions ? (
              <div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
                <span className="animate-spin h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full"></span>
                Loading sessions...
              </div>
            ) : pastSessions.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No past sessions found yet. Create your first entry ticket above.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {pastSessions.map(s => {
                  const statusConfig =
                    s.status === "completed"
                      ? { label: "Completed", classes: "bg-green-100 text-green-700", dot: "bg-green-500", border: "border-l-green-400" }
                      : s.status === "post"
                      ? { label: "Awaiting Exit Ticket", classes: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500", border: "border-l-yellow-400" }
                      : { label: "Awaiting Pre-Score", classes: "bg-blue-100 text-blue-700", dot: "bg-blue-500", border: "border-l-blue-400" };
                  const focusLabel = s.subtopic || s.topic || "—";
                  return (
                    <div key={s.id} className={`flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors border-l-4 ${statusConfig.border}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-semibold text-gray-800 text-sm truncate">{focusLabel}</p>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${statusConfig.classes}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`}></span>
                            {statusConfig.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          {s.subject} {s.topic ? `· ${s.topic}` : ""} · {s.class_level} - {s.section}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0 ml-4">
                        {s.status === "pre" && (
                          <button onClick={() => resumePreEntry(s)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm">
                            Enter Pre-Score
                          </button>
                        )}
                        {s.status === "post" && (
                          <button onClick={() => loadSessionForPost(s)} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium shadow-sm">
                            Enter Exit Scores
                          </button>
                        )}
                        {s.status === "completed" && (
                          <button onClick={() => viewResults(s)} className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium shadow-sm">
                            View Results
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* PHASE: SETUP */}
        {phase === "setup" && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
  <div className="px-6 py-4 bg-gradient-to-r from-indigo-50 to-white border-b border-gray-100 flex items-center gap-2">
    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
      <ClipboardList className="h-4 w-4 text-indigo-600" />
    </div>
    <h2 className="font-semibold text-gray-800">Create Entry Ticket</h2>
  </div>
  <div className="p-4 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
  <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
    <GraduationCap className="h-3.5 w-3.5 text-indigo-500" /> Class
  </label>
  <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-colors hover:border-indigo-300">
                  <option value="">Select Class</option>
                  {CLASS_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
    <User className="h-3.5 w-3.5 text-indigo-500" /> Section
  </label>
                <select value={selectedSection} onChange={e => setSelectedSection(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-colors hover:border-indigo-300">
                  <option value="">Select Section</option>
                  {SECTION_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
    <BookOpen className="h-3.5 w-3.5 text-indigo-500" /> Subject
  </label>
                <select value={selectedSubject} onChange={e => { setSelectedSubject(e.target.value); setSelectedChapter(""); setTopicValue(""); setSelectedSubtopic(""); }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" disabled={!selectedClass}>
                  <option value="">-- Select Subject --</option>
                  {subjectsList.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="mt-2">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
    <BookMarked className="h-3.5 w-3.5 text-indigo-500" /> Chapter
  </label>
                  <select value={selectedChapter} onChange={e => { setSelectedChapter(e.target.value); setTopicValue(""); setSelectedSubtopic(""); }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" disabled={!selectedSubject}>
                    <option value="">-- Select Chapter --</option>
                    {chaptersList.map(ch => <option key={ch.id} value={ch.label}>{ch.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
    <Hash className="h-3.5 w-3.5 text-indigo-500" /> Total Marks
  </label>
                <input type="number" value={totalMarks} onChange={e => setTotalMarks(parseInt(e.target.value) || 10)} min={1} max={100} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
    <BookOpen className="h-3.5 w-3.5 text-indigo-500" /> Topic / Chapter
  </label>
                <select value={topicValue} onChange={e => { setTopicValue(e.target.value); setSelectedSubtopic(""); }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" disabled={!selectedChapter}>
                  <option value="">-- Select Topic --</option>
                  {topicsList.map(t => <option key={t.id} value={t.topic_name}>{t.topic_name}</option>)}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
    <Layers className="h-3.5 w-3.5 text-indigo-500" /> Subtopic
  </label>
                <select value={selectedSubtopic} onChange={e => setSelectedSubtopic(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" disabled={!topicValue}>
                  <option value="">-- Select Subtopic --</option>
                  {subtopicsList.map(st => <option key={st.id} value={st.subtopic_name}>{st.subtopic_name}</option>)}
                </select>
              </div>
            </div>
            <button
              onClick={generateQuestions}
              disabled={loadingQuestions}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loadingQuestions ? (
                <><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span> Generating Questions...</>
              ) : "Generate Entry Ticket Questions"}
            </button>
          </div>
          </div>
        )}

        {/* PHASE: PRE - Show questions + class score entry */}
        {phase === "pre" && (
          <div className="space-y-4 ">
            {/* Questions Card */}
            <div className="bg-white rounded-2xl border border-blue-300 shadow-sm p-6 hover:-translate-y-2 hover:shadow-2xl hover:border-indigo-300">
              <div className="flex items-center gap-2 mb-4">
                <span className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg tracking-wide">ENTRY TICKET</span>
                <span className="text-sm text-gray-500">{selectedSubject} {topicValue && `· ${topicValue}`} {selectedSubtopic && `· ${selectedSubtopic}`}</span>
              </div>
              <p className="text-xs text-gray-400 mb-4 uppercase tracking-wide font-medium">Ask these questions before teaching the topic</p>
              <ol className="space-y-3">
                {questions.map(q => (
                  <li key={q.q_no} className="flex gap-3 items-start bg-gray-50 rounded-xl p-3">
                    <span className="flex-shrink-0 w-7 h-7 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full flex items-center justify-center">{q.q_no}</span>
                    <p className="text-gray-700 text-sm leading-relaxed pt-0.5">{q.question}</p>
                  </li>
                ))}
              </ol>
            </div>

            {/* Class Score Entry */}
            <div className="bg-white rounded-xl border border-blue-300 shadow-sm p-6 hover:-translate-y-2 hover:shadow-2xl hover:border-indigo-300">
              <h3 className="font-semibold text-gray-800 mb-1">Enter Class Pre-Score</h3>
              <p className="text-xs text-gray-500 mb-4">Enter the overall class score out of {totalMarks}</p>
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="number"
                  value={preScore}
                  onChange={e => setPreScore(e.target.value)}
                  placeholder="0"
                  min={0}
                  max={totalMarks}
                  className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <span className="text-gray-400 text-sm">/ {totalMarks}</span>
              </div>
              <button
                onClick={savePreScores}
                disabled={savingScores}
                className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingScores ? (
                  <><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span> Saving...</>
                ) : "Save Entry Ticket Score"}
              </button>
            </div>
          </div>
        )}

        {/* PHASE: POST - Enter exit score */}
        {phase === "post" && (
          <div className="space-y-4 ">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:-translate-y-2 hover:shadow-2xl hover:border-indigo-300">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded">EXIT TICKET</span>
                <span className="text-sm text-gray-500">{selectedSubject} | {topicValue} | {selectedSubtopic}</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">Topic has been taught. Now enter the class post-score out of {totalMarks}</p>
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="number"
                  value={postScore}
                  onChange={e => setPostScore(e.target.value)}
                  placeholder="0"
                  min={0}
                  max={totalMarks}
                  className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
                <span className="text-gray-400 text-sm">/ {totalMarks}</span>
              </div>
              <button
                onClick={savePostScores}
                disabled={savingScores}
                className="w-full py-2.5 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingScores ? (
                  <><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span> Calculating Gain...</>
                ) : "Save Exit Score and Calculate Gain"}
              </button>
            </div>
          </div>
        )}

        {/* PHASE: RESULTS */}
        {phase === "results" && (
          <div className="space-y-4">
            {/* Summary */}
<div className="grid grid-cols-3 gap-4 ">
  <div className="bg-white rounded-xl border-l-4 border-indigo-400 border-t border-r border-b border-gray-200 shadow-sm p-4 hover:-translate-y-2 hover:shadow-2xl hover:border-indigo-300">
    <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Class Normalized Gain</p>
    <p className={`text-2xl font-bold ${parseFloat(avgGain || "0") >= 0.7 ? "text-emerald-600" : parseFloat(avgGain || "0") >= 0.3 ? "text-amber-600" : "text-red-600"}`}>
      {avgGain}
    </p>
  </div>
  <div className="bg-white rounded-xl border-l-4 border-emerald-400 border-t border-r border-b border-gray-200 shadow-sm p-4 hover:-translate-y-2 hover:shadow-2xl hover:border-indigo-300">
    <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Pre → Post</p>
    <p className="text-2xl font-bold text-emerald-600">
      {responses[0]?.pre_score}/{responses[0]?.total_marks} → {responses[0]?.post_score}/{responses[0]?.total_marks}
    </p>
  </div>
  <div className="bg-white rounded-xl border-l-4 border-amber-400 border-t border-r border-b border-gray-200 shadow-sm p-4 hover:-translate-y-2 hover:shadow-2xl hover:border-indigo-300">
    <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Gain Level</p>
    {responses[0] && (
      <span className={`inline-block text-sm px-3 py-1 rounded-full font-medium ${gainBadge(responses[0].gain_level)}`}>
        {responses[0].gain_level?.toUpperCase()}
      </span>
    )}
  </div>
</div>

            {/* Results Table */}
            <div className="bg-white rounded-xl border border-cyan-300 shadow-sm overflow-hidden hover:-translate-y-2 hover:shadow-2xl hover:border-indigo-300">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="font-semibold text-gray-700 text-sm">Normalized Gain Results</h2>
                <p className="text-xs text-gray-400">{selectedSubject} | {topicValue} | {selectedSubtopic}</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">Class / Section</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium">Pre Score</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium">Post Score</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium">Gain (g)</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium">Level</th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((r) => (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-800">{r.student_name}</td>
                      <td className="px-4 py-2.5 text-center text-gray-600">{r.pre_score}/{r.total_marks}</td>
                      <td className="px-4 py-2.5 text-center text-gray-600">{r.post_score}/{r.total_marks}</td>
                      <td className="px-4 py-2.5 text-center font-bold text-gray-800">{r.normalized_gain?.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${gainBadge(r.gain_level)}`}>
                          {r.gain_level?.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
    </AppLayout>
  );
}