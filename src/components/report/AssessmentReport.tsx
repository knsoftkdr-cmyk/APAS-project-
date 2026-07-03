import { forwardRef } from "react";

export interface ReportPerActivity {
  activity_index: number;
  is_correct: boolean;
  partial_credit?: boolean;
  student_score: number;
  correct_answer?: string;
  what_student_got_right?: string;
  reason_for_wrong?: string;
  topic?: string;
  question_type?: string;
}

export interface ReportTopicAnalysis {
  topic: string;
  proficiency_percent: number;
  status: "strong" | "weak" | "critical_gap";
}

export interface ReportStudyPlanItem {
  priority: number;
  title: string;
  description: string;
}

export interface AssessmentReportProps {
  schoolName?: string;
  studentName: string;
  classLevel: string;
  section: string;
  subject?: string | null;
  topic?: string | null;
  submittedAt: string;
  aiScore: number;
  aiFeedback: string;
  perActivity: ReportPerActivity[];
  topicAnalysis: ReportTopicAnalysis[];
  studyPlan: ReportStudyPlanItem[];
}

function gradeFor(score: number): { label: string; color: string } {
  if (score >= 90) return { label: "A+", color: "#059669" };
  if (score >= 80) return { label: "A", color: "#10b981" };
  if (score >= 70) return { label: "B", color: "#2563eb" };
  if (score >= 60) return { label: "C", color: "#d97706" };
  if (score >= 40) return { label: "D", color: "#ea580c" };
  return { label: "E", color: "#e11d48" };
}

const STATUS_STYLES: Record<string, { bar: string; badge: string; label: string }> = {
  strong: { bar: "bg-emerald-500", badge: "text-emerald-700", label: "STRONG" },
  weak: { bar: "bg-amber-500", badge: "text-amber-700", label: "WEAK" },
  critical_gap: { bar: "bg-rose-500", badge: "text-rose-700", label: "CRITICAL GAP" },
};

const QUESTION_TYPE_LABELS: Record<string, string> = {
  recall: "Recall",
  conceptual: "Conceptual",
  application: "Application",
  assertion_reason: "Assertion & Reason",
  numerical: "Numerical",
  derivation: "Derivation",
};
const QUESTION_TYPES = Object.keys(QUESTION_TYPE_LABELS);

// Simple SVG progress ring - the report's signature element, standing in for
// a flat grade box. Kept to plain circles/text since html2canvas renders
// basic SVG reliably but can struggle with gradients/filters.
function ScoreRing({ score }: { score: number }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;
  const grade = gradeFor(clamped);

  return (
    <div className="flex flex-col items-center shrink-0">
      <svg width="108" height="108" viewBox="0 0 108 108">
        <circle cx="54" cy="54" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="9" />
        <circle
          cx="54"
          cy="54"
          r={radius}
          fill="none"
          stroke={grade.color}
          strokeWidth="9"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 54 54)"
        />
        <text x="54" y="50" textAnchor="middle" fontSize="22" fontWeight="700" fill="#1e293b">
          {Math.round(clamped)}
        </text>
        <text x="54" y="66" textAnchor="middle" fontSize="9" fill="#64748b">
          / 100
        </text>
      </svg>
      <div
        className="mt-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full text-white leading-none"
        style={{ backgroundColor: grade.color }}
      >
        GRADE {grade.label}
      </div>
    </div>
  );
}

/**
 * Printable assessment report, rendered off-screen and captured by html2pdf.js.
 * Fixed pixel width (794px = A4 at 96dpi) so html2canvas produces a clean single-column page.
 * Uses explicit Tailwind palette classes (bg-emerald-500, not bg-primary) since html2canvas
 * can render CSS-variable/oklch-based shadcn tokens incorrectly.
 * Colors: navy blue (#1e3a8a family) + green, matching the APAS logo.
 */
export const AssessmentReport = forwardRef<HTMLDivElement, AssessmentReportProps>(function AssessmentReport(
  {
    schoolName = "APAS",
    studentName,
    classLevel,
    section,
    subject,
    topic,
    submittedAt,
    aiScore,
    aiFeedback,
    perActivity,
    topicAnalysis,
    studyPlan,
  },
  ref
) {
  const totalActivities = perActivity.length;
  const correctCount = perActivity.filter((a) => a.is_correct).length;

  // Gemini's own activity_index numbering isn't reliably 0-based across
  // calls (sometimes it mirrors the worksheet's own "Activity 1, 2, 3..."
  // labels). Rather than trust that value for display, sort by it to
  // preserve worksheet order, then label sequentially by array position -
  // this guarantees Q1..Qn with no gaps or offsets regardless of what
  // Gemini returned.
  const orderedActivities = [...perActivity].sort((a, b) => a.activity_index - b.activity_index);

  const matrixCells: Record<string, Record<string, "correct" | "partial" | "wrong" | null>> = {};
  topicAnalysis.forEach((t) => {
    matrixCells[t.topic] = {};
  });
  perActivity.forEach((a) => {
    if (!a.topic) return;
    if (!matrixCells[a.topic]) matrixCells[a.topic] = {};
    const qt = a.question_type || "recall";
    const verdict = a.is_correct ? "correct" : a.partial_credit ? "partial" : "wrong";
    matrixCells[a.topic][qt] = verdict;
  });

  const sortedStudyPlan = [...studyPlan].sort((a, b) => a.priority - b.priority);

  return (
    <div ref={ref} style={{ width: "794px", fontFamily: "Inter, system-ui, sans-serif" }} className="bg-white text-slate-900">
      {/* Header */}
      <div className="bg-blue-900 text-white px-8 pt-6 pb-8">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-blue-200 mb-1 leading-none">
          <span>Assessment Report</span>
          <span>Powered by APAS AI</span>
        </div>
        <h1 className="text-2xl font-bold mb-4 leading-tight">{schoolName}</h1>
        <div className="flex gap-2 flex-wrap mb-4">
          {subject && (
            <span className="bg-blue-700 px-3 py-1.5 rounded-md text-xs font-medium leading-none inline-flex items-center">
              {subject}
            </span>
          )}
          <span className="bg-blue-700 px-3 py-1.5 rounded-md text-xs font-medium leading-none inline-flex items-center">
            {classLevel} · Sec {section}
          </span>
          {topic && (
            <span className="bg-blue-700 px-3 py-1.5 rounded-md text-xs font-medium leading-none inline-flex items-center">
              {topic}
            </span>
          )}
          <span className="bg-blue-700 px-3 py-1.5 rounded-md text-xs font-medium leading-none inline-flex items-center">
            {new Date(submittedAt).toLocaleDateString()}
          </span>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-blue-200 mb-1 leading-none">Student</div>
        <div className="text-lg font-semibold leading-tight">{studentName}</div>
      </div>

      {/* Score summary */}
      <div className="px-8 -mt-5 break-inside-avoid">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-5 flex-wrap">
            <ScoreRing score={aiScore} />
            <div className="flex-1 min-w-[240px]">
              <div className="text-sm text-slate-700 leading-relaxed">{aiFeedback}</div>
              {totalActivities > 0 && (
                <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 rounded-full px-3 py-1.5 leading-none">
                  {correctCount}/{totalActivities} questions correct
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Marks Breakdown - pill chips with a fixed-size circular score badge,
          so the badge stays vertically centered regardless of digit count */}
      {orderedActivities.length > 0 && (
        <div className="px-8 pt-6">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 leading-none">Marks Breakdown</div>
          <div className="flex flex-wrap gap-2">
            {orderedActivities.map((a, i) => {
              const verdict = a.is_correct ? "correct" : a.partial_credit ? "partial" : "wrong";
              const bg = verdict === "correct" ? "bg-emerald-500" : verdict === "partial" ? "bg-amber-500" : "bg-rose-500";
              return (
                <div
                  key={`${a.activity_index}-${i}`}
                  className={`inline-flex items-center gap-1.5 rounded-full ${bg} text-white pl-3 pr-1 py-1 text-[11px] font-semibold leading-none break-inside-avoid`}
                >
                  <span className="leading-none">Q{i + 1}</span>
                  <span className="text-[10px] leading-none">{a.student_score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Topic Proficiency - two-column card grid, room for full topic names */}
      {topicAnalysis.length > 0 && (
        <div className="px-8 pt-8">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 leading-none">Topic Proficiency</div>
          <div className="grid grid-cols-2 gap-3">
            {topicAnalysis.map((t, i) => {
              const style = STATUS_STYLES[t.status] || STATUS_STYLES.weak;
              return (
                <div key={i} className="rounded-lg border border-slate-200 p-3 bg-white break-inside-avoid">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold text-slate-700 leading-snug">{t.topic}</div>
                    <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide leading-none ${style.badge}`}>
                      {style.label}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${style.bar}`} style={{ width: `${Math.max(4, t.proficiency_percent)}%` }} />
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1.5 text-right leading-none">{t.proficiency_percent}% proficiency</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Topic x Question-Type Evidence Matrix */}
      {topicAnalysis.length > 0 && (
        <div className="px-8 pt-8">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 leading-none">
            Topic × Question-Type Evidence Matrix
          </div>
          <table className="w-full text-xs border-collapse" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "22%" }} />
              {QUESTION_TYPES.map((qt) => (
                <col key={qt} style={{ width: `${58 / QUESTION_TYPES.length}%` }} />
              ))}
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr className="bg-blue-900 text-white">
                <th className="text-left align-middle px-2 py-2 font-semibold leading-tight">Topic</th>
                {QUESTION_TYPES.map((qt) => (
                  <th key={qt} className="align-middle px-1 py-2 font-semibold uppercase text-[8px] leading-tight">
                    {QUESTION_TYPE_LABELS[qt]}
                  </th>
                ))}
                <th className="align-middle px-2 py-2 font-semibold leading-tight">Overall</th>
              </tr>
            </thead>
            <tbody>
              {topicAnalysis.map((t, i) => {
                const style = STATUS_STYLES[t.status] || STATUS_STYLES.weak;
                return (
                  <tr key={i} className={`break-inside-avoid ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                    <td className="align-middle px-2 py-2 font-medium text-slate-700 border-t border-slate-100 leading-snug">
                      {t.topic}
                    </td>
                    {QUESTION_TYPES.map((qt) => {
                      const cell = matrixCells[t.topic]?.[qt];
                      return (
                        <td key={qt} className="align-middle text-center px-1 py-2 border-t border-slate-100">
                          {cell === "correct" && <span className="text-emerald-600 font-bold">✓</span>}
                          {cell === "partial" && <span className="text-amber-600 font-bold">~</span>}
                          {cell === "wrong" && <span className="text-rose-500 font-bold">✕</span>}
                          {!cell && <span className="text-slate-300">–</span>}
                        </td>
                      );
                    })}
                    <td className="align-middle text-center border-t border-slate-100 py-2">
                      <span className={`text-[9px] font-bold uppercase tracking-wide leading-none ${style.badge}`}>
                        {style.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Study Plan */}
      {sortedStudyPlan.length > 0 && (
        <div className="px-8 pt-8 pb-8">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 leading-none">Study Plan</div>
          <div className="space-y-2.5">
            {sortedStudyPlan.map((item, i) => (
              <div key={i} className="flex gap-3 border-l-4 border-emerald-600 rounded-r-lg p-3 bg-emerald-50/50 break-inside-avoid">
                <div className="w-6 h-6 rounded-full bg-blue-900 text-white text-xs font-bold flex items-center justify-center shrink-0 leading-none">
                  {item.priority}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-800 leading-snug">{item.title}</div>
                  <div className="text-xs text-slate-600 mt-1 leading-relaxed">{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-8 py-3 bg-slate-800 text-slate-300 text-[9px] flex items-center justify-between leading-none">
        <span>Confidential — For Student &amp; Parent Use Only</span>
        <span>APAS AI · {new Date().toLocaleDateString()}</span>
      </div>
    </div>
  );
});