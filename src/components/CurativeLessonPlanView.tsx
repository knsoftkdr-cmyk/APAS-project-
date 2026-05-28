import { useState, useMemo } from "react";
import { analyzeResponses } from "@/data/reportTheories";
import { deriveVarkScores } from "@/data/varkMapping";

/* ─── Types ─── */
interface StudentAssessment {
  id: string;
  student_name: string;
  student_age: number;
  age_group: number;
  responses: Record<string, any>;
  created_at: string;
  student_class: string | null;
  section: string | null;
}

interface CurativeLessonPlanViewProps {
  assessments: StudentAssessment[];
  classLabel: string;
  filterSection: string;
  teacherName: string;
  subject?: string;
  topic?: string;
}

/* ─── Constants ─── */
const VARK_KEYS = ["Visual", "Read/Write", "Auditory", "Kinesthetic"] as const;
type VarkKey = typeof VARK_KEYS[number];

const GROUP_CONFIG: Record<VarkKey, {
  code: string; group: string; label: string; color: string; colorD: string; colorL: string; badgeBg: string; borderColor: string;
  strategies: string[]; badges: string[];
  activityTitle: string; activityDesc: string; resources: string[];
  objective: string; objectiveDetail: string;
  supportTitle: string; supportDesc: string;
  coreTitle: string; coreDesc: string;
  extTitle: string; extDesc: string;
  teacherNote: string;
}> = {
  Visual: {
    code: "V", group: "Group A", label: "Visual learners",
    color: "#2563eb", colorD: "#1e40af", colorL: "#eff6ff", badgeBg: "#bfdbfe", borderColor: "#93c5fd",
    strategies: ["Diagram-first", "Colour-coded visuals", "Mind-map summaries"],
    badges: ["Structured Mastery", "Diagram-first", "Bloom L2–L3"],
    activityTitle: "Annotated diagram labelling exercise",
    activityDesc: "Learners receive a printed half-labelled diagram. Task: complete the missing labels using colour-coding. Each label must be paired with a 5-word function note. A visual reference card is provided face-down — learners turn it over only after their first attempt.",
    resources: ["Diagram set", "Colour pencils / digital annotation", "Visual reference card", "Mind-map template (extension)"],
    objective: "Identify and describe key concepts using labelled diagrams",
    objectiveDetail: "Learners can correctly label a blank diagram and write a one-line description for each component by end of session.",
    supportTitle: "Guided labelling", supportDesc: "Key terms provided in a word bank. Match term → blank arrow on diagram. Write one-word description.",
    coreTitle: "Label + describe", coreDesc: "Blank diagram, no word bank. Label all components. Write a full-sentence description for each.",
    extTitle: "Compare + connect", extDesc: "Draw a comparison diagram. Add two real-world analogies connecting concepts to everyday objects.",
    teacherNote: "This group is largely self-directed. Circulate once at minute 20 to check label accuracy. Prompt learners showing systematic errors to connect visual shapes to functions before writing.",
  },
  "Read/Write": {
    code: "R", group: "Group B", label: "Read/Write learners",
    color: "#7c3aed", colorD: "#4c1d95", colorL: "#f5f3ff", badgeBg: "#ddd6fe", borderColor: "#c4b5fd",
    strategies: ["Written case studies", "Structured notes", "PEEL writing scaffold"],
    badges: ["Written scaffolding", "Case study format", "Bloom L2–L3"],
    activityTitle: "Mini case study — structured written explanation",
    activityDesc: "Learners read a 200-word scenario describing a real-world situation. They annotate the text, identifying key elements. Then write a structured paragraph using the PEEL format (Point, Evidence, Explain, Link) describing how multiple concepts connect.",
    resources: ["Case study card", "PEEL writing scaffold", "Terminology bank", "Structured question format"],
    objective: "Explain structure and function of key concepts in structured written form",
    objectiveDetail: "Learners produce a structured written explanation using correct terminology, connecting at least 3 related concepts.",
    supportTitle: "Sentence starters", supportDesc: "PEEL paragraph with sentence starters provided. Learner fills in the key terms and specific actions.",
    coreTitle: "Full PEEL paragraph", coreDesc: "Write complete PEEL paragraph independently. Terminology bank available as reference only.",
    extTitle: "Extended analysis", extDesc: "Write a second PEEL paragraph comparing two related concepts. Include real-world implications.",
    teacherNote: "Check that written explanations distinguish structure from function (common confusion). The written format should expose whether errors are language gaps or conceptual gaps.",
  },
  Auditory: {
    code: "A", group: "Group C", label: "Auditory learners",
    color: "#d97706", colorD: "#92400e", colorL: "#fffbeb", badgeBg: "#fde68a", borderColor: "#fcd34d",
    strategies: ["Discussion protocols", "Think-aloud", "Peer teaching"],
    badges: ["Inquiry-Based", "Discussion protocol", "Bloom L1–L2"],
    activityTitle: "Jigsaw discussion — 'Expert' protocol",
    activityDesc: "Each learner is assigned one concept as their 'expertise'. They have 5 minutes to read a short fact card. Then in two rounds of pair rotation, each learner explains their concept to a partner — the listener must ask at least one follow-up question. A final 3-minute whole-group debrief: each learner states the most surprising thing they learned.",
    resources: ["Fact cards", "Discussion prompt strip", "Inquiry question stems", "Collaborative project board"],
    objective: "Verbally articulate key concepts through structured peer discussion",
    objectiveDetail: "Learners can explain in their own spoken words what core concepts mean — and can respond to a peer's explanation with a follow-up question.",
    supportTitle: "Scripted explanation", supportDesc: "Fact card includes a sentence frame: 'This concept is ___ and it works like a ___ because it ___.' Learner reads aloud, then adapts.",
    coreTitle: "Free explanation", coreDesc: "Fact card for reference only. Learner explains in own words. Must use one analogy to describe the concept.",
    extTitle: "Challenge question", extDesc: "After explaining, answer: 'What would happen if this concept didn't exist?' Justify with 2 consequences.",
    teacherNote: "Learners with systematic error patterns and below ZPD should be assigned the most-tested concepts. Teacher should join this group's debrief at minute 32 to correct verbal misconceptions before they solidify.",
  },
  Kinesthetic: {
    code: "K", group: "Group D", label: "Kinesthetic learners",
    color: "#e55a3c", colorD: "#9a3412", colorL: "#fff1ee", badgeBg: "#fecaca", borderColor: "#fca5a5",
    strategies: ["Model-building", "Hands-on activities", "Physical simulations"],
    badges: ["Hands-on", "Model construction", "Bloom L1–L2"],
    activityTitle: "Model construction / physical build activity",
    activityDesc: "Learners receive colour-coded materials and a laminated placement guide. They build a physical model by shaping and positioning each component. As each piece is placed, the learner states its name and one function aloud to their pair partner. A label flag is inserted into each component. At minute 30, the model is photographed as the physical exit artefact.",
    resources: ["Colour-coded materials", "Laminated placement guide", "Label flag kit", "Digital builder (tablet fallback)"],
    objective: "Physically construct a model and correctly place + name key components",
    objectiveDetail: "Learners can physically identify and name core components — and explain one function for each by physically pointing to their model.",
    supportTitle: "Guided build", supportDesc: "Step-by-step instruction card with each step naming the component and telling the learner what to say aloud.",
    coreTitle: "Build from guide", coreDesc: "Placement guide shows location only — no names. Learner identifies each component from a reference and builds independently.",
    extTitle: "Extended adaptation", extDesc: "After completing the base model, modify it to create a variation. Explain the differences to their partner.",
    teacherNote: "Begin with the lowest-scoring learners on the guided build tier and move up only if they correctly name components unprompted. Photograph each completed model — this serves as their physical pre-assessment artefact for Phase 3.",
  },
};

/* ─── Component ─── */
export const CurativeLessonPlanView = ({
  assessments, classLabel, filterSection, teacherName, subject, topic,
}: CurativeLessonPlanViewProps) => {
  const [activeTab, setActiveTab] = useState<VarkKey>("Visual");

  const data = useMemo(() => {
    const varkCounts: Record<string, number> = { Visual: 0, Auditory: 0, "Read/Write": 0, Kinesthetic: 0 };
    const varkGroups: Record<string, string[]> = { Visual: [], Auditory: [], "Read/Write": [], Kinesthetic: [] };
    const allScores: { name: string; avg: number; vark: string }[] = [];

    assessments.forEach(a => {
      const scores = analyzeResponses(a.age_group, a.responses as Record<string, number>);
      const varkR = (a.responses as any)?.vark as Record<string, string> | undefined;
      const vark = deriveVarkScores(a.age_group, a.responses as Record<string, number>, varkR);
      if (!scores) return;
      const avg = Math.round(scores.reduce((s, d) => s + d.percentage, 0) / scores.length);
      allScores.push({ name: a.student_name, avg, vark: vark.dominant });
      varkCounts[vark.dominant]++;
      varkGroups[vark.dominant]?.push(a.student_name);
    });

    const classAvg = allScores.length > 0 ? Math.round(allScores.reduce((s, a) => s + a.avg, 0) / allScores.length) : 0;
    const dominantVark = Object.entries(varkCounts).reduce((a, b) => a[1] >= b[1] ? a : b);

    // Per-group averages
    const groupAvgs: Record<string, number> = {};
    VARK_KEYS.forEach(k => {
      const names = varkGroups[k];
      if (names.length > 0) {
        groupAvgs[k] = Math.round(allScores.filter(s => names.includes(s.name)).reduce((a, b) => a + b.avg, 0) / names.length);
      }
    });

    // Weakest group for alert
    const weakest = VARK_KEYS
      .filter(k => (varkGroups[k]?.length || 0) > 0)
      .map(k => ({ key: k, avg: groupAvgs[k] || 0, count: varkGroups[k].length }))
      .sort((a, b) => a.avg - b.avg)[0];

    return { varkCounts, varkGroups, allScores, classAvg, dominantVark, groupAvgs, weakest, total: assessments.length };
  }, [assessments]);

  const planId = `APC-CLS-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;
  const planDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const activeGroups = VARK_KEYS.filter(k => (data.varkGroups[k]?.length || 0) > 0);
  const displaySubject = subject || "General";
  const displayTopic = topic || "Curative Review";
  const sectionLabel = filterSection !== "all" ? `-${filterSection}` : "";

  return (
    <div className="space-y-6" style={{ fontFamily: "'Sora', sans-serif", color: "#1c1c2e", background: "#f6f5f2", padding: "28px 20px", borderRadius: "12px" }}>

      {/* ─── HEADER ─── */}
      <div className="flex justify-between items-start pb-4" style={{ borderBottom: "2px solid #1c1c2e" }}>
        <div>
          <h1 className="text-[26px] font-bold tracking-tight" style={{ fontFamily: "'Playfair Display', serif", letterSpacing: "-0.5px" }}>
            APAS <em style={{ color: "#0e9a7b", fontStyle: "italic" }}>Lesson Plan</em>
          </h1>
          <p className="text-[10px] font-semibold tracking-[2px] uppercase mt-1" style={{ color: "#8282a8" }}>
            Differentiated Lesson Plan · {classLabel}{sectionLabel}
          </p>
        </div>
        <div className="text-right text-xs" style={{ color: "#8282a8" }}>
          <div>Plan ID: {planId}</div>
          <strong className="block text-[13px] font-medium mt-0.5" style={{ color: "#3d3d5c" }}>{planDate}</strong>
          <span className="inline-block text-[10px] font-semibold tracking-[1.5px] uppercase px-2.5 py-1 rounded-full mt-1.5" style={{ background: "#0e9a7b", color: "#fff" }}>AI Generated</span>
          <span className="inline-block text-[10px] font-semibold tracking-[1.5px] uppercase px-2.5 py-1 rounded-full mt-1.5 ml-1" style={{ background: "#d97706", color: "#fff" }}>
            {activeGroups.length} Groups · 45 min
          </span>
        </div>
      </div>

      {/* ─── META STRIP ─── */}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {[
          { lbl: "Subject", val: displaySubject, sub: displayTopic },
          { lbl: "Topic", val: displayTopic, sub: "Curative Focus" },
          { lbl: "Class", val: `${classLabel}${sectionLabel}`, sub: `${data.total} learners` },
          { lbl: "Curriculum", val: "CBSE", sub: "Aligned" },
          { lbl: "Duration", val: "45 min", sub: "+ 10 min exit" },
          { lbl: "Bloom's Level", val: "L2–L3", sub: "Understand → Apply" },
        ].map((m, i) => (
          <div key={i} className="rounded-[10px] p-2.5" style={{ background: "#fff", border: "0.5px solid #e4e2dc" }}>
            <p className="text-[9px] font-semibold tracking-[1.5px] uppercase mb-1" style={{ color: "#8282a8" }}>{m.lbl}</p>
            <p className="text-[16px]" style={{ fontFamily: "'Playfair Display', serif", color: "#1c1c2e" }}>{m.val}</p>
            {m.sub && <p className="text-[10px] mt-0.5" style={{ color: "#8282a8" }}>{m.sub}</p>}
          </div>
        ))}
      </div>

      {/* ─── WHOLE-CLASS LESSON ARC ─── */}
      <div>
        <SectionTitle>Whole-class lesson arc — 45 minutes</SectionTitle>
        <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "0.5px solid #e4e2dc" }}>
          <div className="flex justify-between items-center px-5 py-3.5" style={{ background: "#1c1c2e" }}>
            <div>
              <p className="text-[15px] font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Shared instructional sequence</p>
              <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>All groups move through this arc together — differentiation happens within each phase</p>
            </div>
          </div>
          <div className="px-5 py-3">
            {[
              { time: "0–5 min", phase: "Hook (whole class)", desc: `Teacher displays a large, unlabelled visual on the board. Learners write down 3 things they notice — no instruction given yet. ${data.dominantVark[0]} learners anchor immediately; other groups engage through their dominant modality.` },
              { time: "5–15 min", phase: "Direct instruction (whole class)", desc: `Teacher narrates key concepts while building visual aids live. Dual-channel delivery — spoken explanation + simultaneous visual build — serves ${data.dominantVark[0]} (${Math.round((data.dominantVark[1] as number / data.total) * 100)}%) and Auditory learners simultaneously. New concept introduced every 90 seconds; pauses built in for note-taking.` },
              { time: "15–35 min", phase: "Differentiated group activity", desc: `Groups split to their assigned tasks (see templates below). Teacher circulates — priority ${data.weakest ? GROUP_CONFIG[data.weakest.key].group : "Group D"} (${data.weakest?.key || "lowest"}) for first 10 minutes. Self-directed groups work with task cards.` },
              { time: "35–40 min", phase: "Share-back (whole class)", desc: "One representative from each group shares their output — Visual group shows labelled diagram, Read/Write group reads one written explanation, Auditory group presents their discussion conclusion, Kinesthetic group shows their model. Cross-pollination of learning styles." },
              { time: "40–45 min", phase: "Consolidation + exit ticket", desc: "Teacher summarises 3 key learning points. Learners complete 3-question digital exit ticket. APAS auto-scores and feeds Phase 3 analytics in real time." },
            ].map((step, i) => (
              <div key={i} className="flex gap-3 items-start py-2" style={{ borderBottom: i < 4 ? "0.5px solid #e4e2dc" : "none" }}>
                <div className="flex-shrink-0 w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5" style={{ background: "#e1f5ee", color: "#085041" }}>{i + 1}</div>
                <div className="text-xs leading-relaxed" style={{ color: "#3d3d5c" }}>
                  <strong style={{ color: "#1c1c2e", fontWeight: 500 }}>{step.time} · {step.phase}:</strong> {step.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── DIFFERENTIATED GROUP LESSON TEMPLATES ─── */}
      <div>
        <SectionTitle>Differentiated group lesson templates</SectionTitle>

        {/* Tabs */}
        <div className="flex rounded-[10px] overflow-hidden mb-4" style={{ border: "0.5px solid #e4e2dc" }}>
          {VARK_KEYS.map(k => {
            const cfg = GROUP_CONFIG[k];
            const count = data.varkGroups[k]?.length || 0;
            const isActive = activeTab === k;
            const needsAlert = k === data.weakest?.key && (data.weakest?.avg || 100) < 50;
            return (
              <button
                key={k}
                onClick={() => setActiveTab(k)}
                className="flex-1 py-2.5 px-2 text-center text-[11px] font-semibold transition-all"
                style={{
                  background: isActive ? cfg.colorL : "#fff",
                  color: isActive ? cfg.colorD : "#8282a8",
                  borderRight: k !== "Kinesthetic" ? "0.5px solid #e4e2dc" : "none",
                  cursor: "pointer",
                  border: "none",
                  borderBottom: isActive ? `2px solid ${cfg.color}` : "2px solid transparent",
                }}
              >
                {cfg.group} · {cfg.label.split(" ")[0]} ({count}){needsAlert ? " ⚠" : ""}
              </button>
            );
          })}
        </div>

        {/* Active Panel */}
        {VARK_KEYS.map(k => {
          if (k !== activeTab) return null;
          const cfg = GROUP_CONFIG[k];
          const names = data.varkGroups[k] || [];
          const count = names.length;
          const groupAvg = data.groupAvgs[k] || 0;
          const isWeakest = k === data.weakest?.key && (data.weakest?.avg || 100) < 50;

          if (count === 0) {
            return (
              <div key={k} className="rounded-xl p-6 text-center" style={{ background: cfg.colorL, border: `1.5px dashed ${cfg.borderColor}`, opacity: 0.7 }}>
                <p className="text-[14px] font-semibold mb-1" style={{ color: cfg.colorD }}>No {k.toLowerCase()} learners identified</p>
                <p className="text-[12px]" style={{ color: "#8282a8" }}>This group has no learners in the current class. No differentiated activity is required.</p>
              </div>
            );
          }

          return (
            <div key={k}>
              {/* Alert for weakest group */}
              {isWeakest && (
                <div className="flex gap-2.5 items-start rounded-[10px] px-4 py-3 mb-4 text-xs leading-relaxed" style={{ background: "rgba(229,90,60,0.08)", border: "0.5px solid rgba(229,90,60,0.35)", color: "#9a3412" }}>
                  <span className="text-base shrink-0">⚠</span>
                  <span><strong>Priority intervention group.</strong> All {count} learners scored below {groupAvg}% with systematic error patterns. Delivery mismatch risk is high if this group is given mismatched modality tasks. {cfg.strategies[0]} is mandatory, not optional. Teacher should begin circulation here.</span>
                </div>
              )}

              {/* Group Header */}
              <div className="rounded-t-xl px-5 py-4" style={{ background: cfg.colorL, border: `1.5px solid ${cfg.borderColor}` }}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[18px]" style={{ fontFamily: "'Playfair Display', serif", color: cfg.colorD }}>{cfg.group} — {cfg.label}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: cfg.colorD, opacity: 0.7 }}>{count} learners · Avg pre-test {groupAvg}%</p>
                  </div>
                </div>
                <div className="flex gap-1.5 flex-wrap mt-2.5">
                  {cfg.badges.map((b, i) => (
                    <span key={i} className="text-[10px] font-semibold px-2.5 py-1 rounded-xl" style={{ background: cfg.badgeBg, color: cfg.colorD }}>{b}</span>
                  ))}
                  {names.length > 0 && (
                    <span className="text-[10px] font-semibold px-2.5 py-1 rounded-xl" style={{ background: cfg.badgeBg, color: cfg.colorD }}>
                      ZPD: {groupAvg >= 60 ? "On-level + Advanced" : "Below + On-level"}
                    </span>
                  )}
                </div>
              </div>

              {/* Group Body */}
              <div className="rounded-b-xl" style={{ border: `1.5px solid ${cfg.borderColor}`, borderTop: "none", background: "#fff" }}>
                {/* Learning Objective */}
                <PhaseRow label="Learning objective">
                  <p className="text-[13px] font-medium mb-1" style={{ color: "#1c1c2e" }}>{cfg.objective}</p>
                  <p className="text-xs leading-relaxed" style={{ color: "#3d3d5c" }}>{cfg.objectiveDetail}</p>
                </PhaseRow>

                {/* Core Activity */}
                <PhaseRow label="Core activity">
                  <p className="text-[13px] font-medium mb-1" style={{ color: "#1c1c2e" }}>{cfg.activityTitle}</p>
                  <p className="text-xs leading-relaxed mb-2" style={{ color: "#3d3d5c" }}>{cfg.activityDesc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cfg.resources.map((r, i) => (
                      <span key={i} className="text-[10px] font-medium px-2.5 py-1 rounded-[10px]" style={{ background: "#f6f5f2", border: "0.5px solid #e4e2dc", color: "#3d3d5c" }}>{r}</span>
                    ))}
                  </div>
                </PhaseRow>

                {/* Scaffolding */}
                <PhaseRow label="Scaffolding">
                  <p className="text-[13px] font-medium" style={{ color: "#1c1c2e" }}>3-tier task cards</p>
                </PhaseRow>

                {/* Task Cards */}
                <div className="grid grid-cols-3 gap-2.5 px-4 py-3.5">
                  <TaskCard tier="support" title={cfg.supportTitle} desc={cfg.supportDesc} />
                  <TaskCard tier="core" title={cfg.coreTitle} desc={cfg.coreDesc} />
                  <TaskCard tier="extension" title={cfg.extTitle} desc={cfg.extDesc} />
                </div>

                {/* Teacher Note */}
                <PhaseRow label="Teacher note" isLast>
                  <p className="text-xs leading-relaxed" style={{ color: "#3d3d5c" }}>{cfg.teacherNote}</p>
                </PhaseRow>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── EXIT TICKET ─── */}
      <div>
        <SectionTitle>Exit ticket — 3-question formative assessment</SectionTitle>
        <div className="rounded-xl px-5 py-4" style={{ background: "#1c1c2e" }}>
          <p className="text-[16px] font-bold text-white mb-3" style={{ fontFamily: "'Playfair Display', serif" }}>
            Whole-class exit ticket · Auto-scored by APAS · Feeds Phase 3 directly
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { num: "Question 1 · Recall", q: "Name the key concept discussed today and give one reason why it is important in everyday life.", type: "Short answer · Bloom L1 · All groups" },
              { num: "Question 2 · Understanding", q: "A system is unable to perform its primary function. Which component is most likely not working correctly? Explain your reasoning.", type: "Reasoning · Bloom L2 · Core + Extension" },
              { num: "Question 3 · Application", q: "Compare two variations of the system discussed. Which one is more resilient and why? Use specific knowledge from today's lesson in your answer.", type: "Applied · Bloom L3 · Extension tier" },
            ].map((eq, i) => (
              <div key={i} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.07)", border: "0.5px solid rgba(255,255,255,0.12)" }}>
                <p className="text-[9px] font-bold tracking-[1.5px] uppercase mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>{eq.num}</p>
                <p className="text-xs leading-relaxed mb-1.5" style={{ color: "rgba(255,255,255,0.9)" }}>{eq.q}</p>
                <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>{eq.type}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── FOOTER ─── */}
      <div className="flex justify-between items-center pt-3.5" style={{ borderTop: "0.5px solid #e4e2dc" }}>
        <p className="text-[11px]" style={{ color: "#8282a8" }}>
          APAS AI · {classLabel}{sectionLabel} Curative Plan · Teacher: {teacherName} · For instructional planning use only
        </p>
        <p className="text-[13px] italic" style={{ fontFamily: "'Playfair Display', serif", color: "#3d3d5c" }}>
          APAS · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
};

/* ─── Sub-components ─── */
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-lg font-bold mb-3.5 flex items-center gap-2" style={{ fontFamily: "'Playfair Display', serif", color: "#1c1c2e" }}>
    <span className="block w-[3px] h-5 rounded-sm" style={{ background: "#0e9a7b" }} />
    {children}
  </h2>
);

const PhaseRow = ({ label, children, isLast }: { label: string; children: React.ReactNode; isLast?: boolean }) => (
  <div className="grid" style={{ gridTemplateColumns: "120px 1fr", borderBottom: isLast ? "none" : "0.5px solid #e4e2dc" }}>
    <div className="flex items-start pt-4 px-4 text-[10px] font-semibold tracking-[1.2px] uppercase" style={{ color: "#8282a8", borderRight: "0.5px solid #e4e2dc" }}>
      {label}
    </div>
    <div className="px-4 py-3.5">{children}</div>
  </div>
);

const TIER_STYLES: Record<string, { bg: string; labelColor: string; label: string }> = {
  support: { bg: "#f0fdf4", labelColor: "#14532d", label: "Support tier" },
  core: { bg: "#eff6ff", labelColor: "#1e40af", label: "Core tier" },
  extension: { bg: "#f5f3ff", labelColor: "#4c1d95", label: "Extension tier" },
};

const TaskCard = ({ tier, title, desc }: { tier: string; title: string; desc: string }) => {
  const s = TIER_STYLES[tier];
  return (
    <div className="rounded-lg p-3" style={{ background: s.bg, border: "0.5px solid #e4e2dc" }}>
      <p className="text-[9px] font-bold tracking-[1.5px] uppercase mb-1.5" style={{ color: s.labelColor }}>{s.label}</p>
      <p className="text-xs font-medium mb-1" style={{ color: "#1c1c2e" }}>{title}</p>
      <p className="text-[11px] leading-relaxed" style={{ color: "#8282a8" }}>{desc}</p>
    </div>
  );
};
