import type { AgeGroupReport, DimensionScore } from "@/data/reportTheories";
import type { VarkScores } from "@/data/varkMapping";

interface ReportContentProps {
  studentName: string;
  studentAge: number;
  ageGroup: number;
  submittedAt: string;
  reportConfig: AgeGroupReport;
  scores: DimensionScore[];
  varkScores: VarkScores;
  studentClass?: string;
  teacherName?: string;
}

export const ReportContent = ({
  studentName,
  studentAge,
  ageGroup,
  submittedAt,
  reportConfig,
  scores,
  varkScores,
  studentClass,
  teacherName,
}: ReportContentProps) => {
  const highCount = scores.filter((s) => s.level === "High").length;
  const moderateCount = scores.filter((s) => s.level === "Moderate").length;
  const developingCount = scores.filter((s) => s.level === "Developing").length;
  const totalNotSure = scores.reduce((sum, s) => sum + s.notSureCount, 0);
  const totalDiagnosticQuestions = scores.reduce((sum, s) => sum + s.totalQuestions, 0);
  const varkNotSure = varkScores.notSureCount;
  const varkTotal = varkScores.totalQuestions;

  const formattedDate = new Date(submittedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const reportId = `APD-${new Date(submittedAt).getFullYear()}-${String(new Date(submittedAt).getMonth() + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;

  const varkEntries = [
    { letter: "V", name: "Visual", score: varkScores.visual },
    { letter: "A", name: "Auditory", score: varkScores.auditory },
    { letter: "R", name: "Read / Write", score: varkScores.readWrite },
    { letter: "K", name: "Kinesthetic", score: varkScores.kinesthetic },
  ];

  const varkDescription = (() => {
    const dominant = varkEntries.reduce((a, b) => (a.score >= b.score ? a : b));
    const weakest = varkEntries.reduce((a, b) => (a.score <= b.score ? a : b));
    return `${studentName} shows a strong preference for ${dominant.name.toLowerCase()} processing. ${dominant.name}-oriented activities will yield the highest retention. ${weakest.name} formats may need additional scaffolding.`;
  })();

  return (
    <div className="space-y-6 font-sans">
      {/* HEADER */}
      <div className="flex justify-between items-start pb-5 border-b-2 border-[#1a1a2e]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1a1a2e]" style={{ fontFamily: "'DM Serif Display', serif" }}>
            APAS <span className="text-[#0e9a7b] italic">Diagnostic</span> Report
          </h1>
          <p className="text-[10px] font-semibold tracking-[2px] uppercase text-[#8282a8] mt-1">
            Phase 1 · Diagnostic Assessment
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[#6b6b8a] font-light">{reportId}</p>
          <p className="text-sm font-medium text-[#3a3a5c] mt-0.5">{formattedDate}</p>
          <span className="inline-block bg-[#0e9a7b] text-white text-[10px] font-semibold tracking-[1.5px] uppercase px-2.5 py-1 rounded-full mt-1.5">
            Assessment Complete
          </span>
        </div>
      </div>

      {/* LEARNER CARD - Name, Class, Teacher */}
      <div className="bg-[#1a1a2e] text-white rounded-2xl px-7 py-5 grid grid-cols-3 gap-5">
        <LearnerField label="Learner" value={studentName} sub={`Age ${studentAge}`} />
        <LearnerField label="Class" value={studentClass || "N/A"} />
        <LearnerField label="Class Teacher" value={teacherName || "N/A"} />
      </div>

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard count={highCount} label="Strong Areas" bgClass="bg-[#dff0d8]" textClass="text-[#2d6a2d]" borderClass="border-[#2d6a2d]/20" />
        <SummaryCard count={moderateCount} label="Moderate Areas" bgClass="bg-[#fef3c7]" textClass="text-[#92400e]" borderClass="border-[#92400e]/20" />
        <SummaryCard count={developingCount} label="Needs Attention" bgClass="bg-[#fee2e2]" textClass="text-[#991b1b]" borderClass="border-[#991b1b]/20" />
        <SummaryCard count={totalNotSure + varkNotSure} label='"Not Sure" Responses' bgClass="bg-[#f0f0ff]" textClass="text-[#4338ca]" borderClass="border-[#4338ca]/20" />
      </div>

      {/* VARK LEARNING STYLE PROFILE */}
      <div>
        <SectionTitle>VARK Learning Style Profile</SectionTitle>
        <div className="grid grid-cols-4 gap-3 mb-3">
          {varkEntries.map((v) => {
            const isDominant = v.score === Math.max(...varkEntries.map(e => e.score));
            return (
              <div
                key={v.letter}
                className={`relative bg-white border rounded-xl p-4 text-center overflow-hidden ${isDominant ? "border-[#0e9a7b] bg-[#e1f5ee]" : "border-[#e2e0d8]"}`}
              >
                {isDominant && (
                  <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-[1px] text-[#0e9a7b]">DOMINANT</span>
                )}
                <div className={`text-4xl mb-1 ${isDominant ? "text-[#0e9a7b]" : "text-[#1a1a2e]"}`} style={{ fontFamily: "'DM Serif Display', serif" }}>
                  {v.letter}
                </div>
                <div className="text-[11px] font-medium text-[#6b6b8a] mb-2.5">{v.name}</div>
                <div className="h-2 bg-[#e2e0d8] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isDominant ? "bg-[#0e9a7b]" : "bg-[#6b6b8a]"}`}
                    style={{ width: `${v.score}%` }}
                  />
                </div>
                <div className="text-sm font-semibold text-[#3a3a5c] mt-1.5">{v.score}%</div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[#6b6b8a] mt-4 leading-relaxed">{varkDescription}</p>
        {varkNotSure > 0 && (
          <p className="text-xs text-[#4338ca] mt-2 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[#4338ca]/30" />
            {varkNotSure} of {varkTotal} VARK questions answered "Not Sure" — learning style preference may need further observation.
          </p>
        )}
      </div>

      {/* DIMENSION SCORES */}
      <div>
        <SectionTitle>Dimension Analysis</SectionTitle>
        <div className="space-y-3">
          {scores.map((score, i) => (
            <DimensionRow key={i} score={score} />
          ))}
        </div>
      </div>

      {/* SCORE TABLE */}
      <div>
        <SectionTitle>Assessment Score Breakdown</SectionTitle>
        <div className="bg-white border border-[#e2e0d8] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-[#e2e0d8]">
                <th className="text-left text-[10px] font-semibold tracking-[1.5px] uppercase text-[#6b6b8a] px-4 py-3">Dimension</th>
                <th className="text-left text-[10px] font-semibold tracking-[1.5px] uppercase text-[#6b6b8a] px-4 py-3">Theory</th>
                <th className="text-center text-[10px] font-semibold tracking-[1.5px] uppercase text-[#6b6b8a] px-4 py-3">Score</th>
                <th className="text-center text-[10px] font-semibold tracking-[1.5px] uppercase text-[#6b6b8a] px-4 py-3">Level</th>
                <th className="text-center text-[10px] font-semibold tracking-[1.5px] uppercase text-[#6b6b8a] px-4 py-3">Not Sure</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((score, i) => (
                <tr key={i} className="border-b border-[#e2e0d8] last:border-b-0">
                  <td className="px-4 py-2.5 font-medium text-[#3a3a5c]">{score.dimension}</td>
                  <td className="px-4 py-2.5 text-[#6b6b8a] text-xs">{score.theory}</td>
                  <td className="px-4 py-2.5 text-center font-semibold text-[#3a3a5c]">{score.percentage}%</td>
                  <td className="px-4 py-2.5 text-center">
                    <ScorePill level={score.level} />
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs">
                    {score.notSureCount > 0 ? (
                      <span className="text-[#4338ca] font-medium">{score.notSureCount}/{score.totalQuestions}</span>
                    ) : (
                      <span className="text-[#6b6b8a]">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* NOT SURE INSIGHT */}
      {(totalNotSure + varkNotSure) > 0 && (
        <NotSureInsight
          studentName={studentName}
          scores={scores}
          varkNotSure={varkNotSure}
          totalNotSure={totalNotSure}
          totalDiagnosticQuestions={totalDiagnosticQuestions}
          varkTotal={varkTotal}
        />
      )}

      {/* AI RECOMMENDATIONS */}
      <div className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] rounded-2xl px-7 py-6 text-white">
        <h3 className="text-lg font-bold mb-1" style={{ fontFamily: "'DM Serif Display', serif" }}>
          AI Instructional Recommendations
        </h3>
        <p className="text-[11px] text-white/40 tracking-[1px] uppercase mb-5">
          Generated by APAS Engine · Curative Phase Inputs
        </p>
        <ul className="space-y-3">
          {scores.filter(s => s.level === "Developing").length > 0 ? (
            scores.filter(s => s.level === "Developing").map((s, i) => (
              <AiRecItem key={i}>
                <strong>{s.dimension}</strong> needs focused attention. {s.interpretation}
              </AiRecItem>
            ))
          ) : scores.filter(s => s.level === "Moderate").length > 0 ? (
            scores.filter(s => s.level === "Moderate").slice(0, 3).map((s, i) => (
              <AiRecItem key={i}>
                <strong>{s.dimension}</strong> is at a moderate level. {s.interpretation}
              </AiRecItem>
            ))
          ) : (
            <AiRecItem>
              All dimensions are performing at a <strong>high level</strong>. Continue with enrichment activities and advanced challenges.
            </AiRecItem>
          )}
          {scores.filter(s => s.level === "High").length > 0 && (
            <AiRecItem>
              Leverage strengths in <strong>{scores.filter(s => s.level === "High").map(s => s.dimension).join(", ")}</strong> to scaffold weaker areas.
            </AiRecItem>
          )}
        </ul>
        <div className="flex flex-wrap gap-2 mt-5">
          {reportConfig.theories.map((t) => (
            <span key={t} className="bg-white/[0.08] text-white/60 text-[11px] font-medium px-3 py-1 rounded-full border border-white/10">
              {t}
            </span>
          ))}
          <span className="bg-white/[0.08] text-white/60 text-[11px] font-medium px-3 py-1 rounded-full border border-white/10">
            Age Group: {ageGroup}+
          </span>
        </div>
      </div>

      {/* FOOTER */}
      <div className="border-t border-[#e2e0d8] pt-4 flex justify-between items-center">
        <p className="text-[11px] text-[#6b6b8a]">
          This report is auto-generated by the APAS AI engine. For academic use only.
        </p>
        <p className="text-sm text-[#3a3a5c] italic" style={{ fontFamily: "'DM Serif Display', serif" }}>
          APAS · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
};

/* ─── Sub-components ─── */

const LearnerField = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div>
    <p className="text-[10px] font-semibold tracking-[1.5px] uppercase text-white/40 mb-1">{label}</p>
    <p className="text-lg font-bold" style={{ fontFamily: "'DM Serif Display', serif" }}>{value}</p>
    {sub && <p className="text-xs text-white/50 mt-0.5">{sub}</p>}
  </div>
);

const SummaryCard = ({ count, label, bgClass, textClass, borderClass }: { count: number; label: string; bgClass: string; textClass: string; borderClass: string }) => (
  <div className={`${bgClass} border ${borderClass} rounded-xl py-4 text-center`}>
    <div className={`text-3xl font-bold ${textClass}`}>{count}</div>
    <div className={`text-xs font-medium ${textClass}`}>{label}</div>
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-lg font-bold text-[#1a1a2e] mb-4 flex items-center gap-2.5" style={{ fontFamily: "'DM Serif Display', serif" }}>
    <span className="block w-1 h-5 rounded-sm bg-[#0e9a7b]" />
    {children}
  </h2>
);

const DimensionRow = ({ score }: { score: DimensionScore }) => {
  const barColor = score.level === "High" ? "#0e9a7b" : score.level === "Moderate" ? "#d97706" : "#e55a3c";
  const isTop = score.level === "High";

  return (
    <div className={`bg-white border rounded-xl px-5 py-4 ${isTop ? "border-[#7c3aed] bg-[#f5f3ff]" : "border-[#e2e0d8]"}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-semibold text-[#1a1a2e]">{score.dimension}</p>
          <p className="text-xs text-[#6b6b8a]">{score.theory}</p>
        </div>
        <ScorePill level={score.level} />
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-2 bg-[#e2e0d8] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${score.percentage}%`, background: barColor }}
          />
        </div>
        <span className="text-sm font-bold text-[#3a3a5c] w-12 text-right">{score.percentage}%</span>
      </div>
      <p className="text-xs text-[#6b6b8a] mb-1">{score.description}</p>
      <p className="text-xs text-[#3a3a5c] leading-relaxed">{score.interpretation}</p>
      {score.notSureCount > 0 && (
        <p className="text-xs text-[#4338ca] mt-1.5 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-[#4338ca]/30" />
          {score.notSureCount} of {score.totalQuestions} questions answered "Not Sure" — indicates cognitive uncertainty in this area.
        </p>
      )}
    </div>
  );
};

const ScorePill = ({ level }: { level: string }) => {
  const cls =
    level === "High"
      ? "bg-[#dff0d8] text-[#2d6a2d]"
      : level === "Moderate"
        ? "bg-[#fef3c7] text-[#92400e]"
        : "bg-[#fee2e2] text-[#991b1b]";

  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {level}
    </span>
  );
};

const AiRecItem = ({ children }: { children: React.ReactNode }) => (
  <li className="flex gap-3 items-start text-sm text-white/80 leading-relaxed">
    <span className="text-[#0e9a7b] font-bold shrink-0 mt-0.5">→</span>
    <span>{children}</span>
  </li>
);

const NotSureInsight = ({
  studentName,
  scores,
  varkNotSure,
  totalNotSure,
  totalDiagnosticQuestions,
  varkTotal,
}: {
  studentName: string;
  scores: DimensionScore[];
  varkNotSure: number;
  totalNotSure: number;
  totalDiagnosticQuestions: number;
  varkTotal: number;
}) => {
  const allNotSure = totalNotSure + varkNotSure;
  const allTotal = totalDiagnosticQuestions + varkTotal;
  const percentage = allTotal > 0 ? Math.round((allNotSure / allTotal) * 100) : 0;

  const unsureDimensions = scores.filter(s => s.notSureCount > 0);

  let severityLabel = "Low";
  let severityColor = "#0e9a7b";
  let severityBg = "#e1f5ee";
  if (percentage >= 40) { severityLabel = "High"; severityColor = "#991b1b"; severityBg = "#fee2e2"; }
  else if (percentage >= 20) { severityLabel = "Moderate"; severityColor = "#92400e"; severityBg = "#fef3c7"; }

  return (
    <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
      <div className="bg-[#f0f0ff] px-6 py-4 border-b border-[#e2e0d8]">
        <h3 className="text-lg font-bold text-[#1a1a2e] flex items-center gap-2.5" style={{ fontFamily: "'DM Serif Display', serif" }}>
          <span className="block w-1 h-5 rounded-sm bg-[#4338ca]" />
          "Not Sure" Response Analysis
        </h3>
        <p className="text-xs text-[#6b6b8a] mt-1">
          Why this matters: The "Not Sure" option is provided so students can honestly indicate when they are unsure about a question rather than guessing randomly. This helps identify genuine areas of cognitive uncertainty.
        </p>
      </div>
      <div className="px-6 py-5 space-y-4">
        {/* Overview */}
        <div className="flex items-center gap-4">
          <div className="text-center px-4 py-2 rounded-xl" style={{ background: severityBg }}>
            <div className="text-2xl font-bold" style={{ color: severityColor }}>{allNotSure}</div>
            <div className="text-[10px] font-semibold tracking-[1px] uppercase" style={{ color: severityColor }}>{severityLabel} Uncertainty</div>
          </div>
          <p className="text-sm text-[#3a3a5c] leading-relaxed flex-1">
            {studentName} selected "Not Sure" for <strong>{allNotSure} out of {allTotal}</strong> questions ({percentage}%).
            {percentage >= 40
              ? " This is a significant number, suggesting the student may lack confidence or familiarity in several areas. The teacher should provide additional support and one-on-one guidance."
              : percentage >= 20
                ? " This indicates moderate uncertainty. The student may benefit from revisiting foundational concepts in the affected areas with guided practice."
                : " This is within a normal range. The student shows reasonable confidence across most areas."}
          </p>
        </div>

        {/* Per-dimension breakdown */}
        {unsureDimensions.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-[1px] uppercase text-[#6b6b8a] mb-2">Dimensions with uncertainty</p>
            <div className="space-y-2">
              {unsureDimensions.map((s, i) => {
                const dimPct = s.totalQuestions > 0 ? Math.round((s.notSureCount / s.totalQuestions) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-3 bg-[#f8f8ff] rounded-lg px-4 py-2.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#4338ca]/40 shrink-0" />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-[#3a3a5c]">{s.dimension}</span>
                      <span className="text-xs text-[#6b6b8a] ml-2">({s.notSureCount} of {s.totalQuestions} questions — {dimPct}%)</span>
                    </div>
                    <div className="w-24 h-1.5 bg-[#e2e0d8] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-[#4338ca]" style={{ width: `${dimPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {varkNotSure > 0 && (
          <div className="flex items-center gap-3 bg-[#f8f8ff] rounded-lg px-4 py-2.5">
            <span className="inline-block w-2 h-2 rounded-full bg-[#4338ca]/40 shrink-0" />
            <span className="text-sm text-[#3a3a5c]">
              <strong>VARK Learning Style:</strong> {varkNotSure} of {varkTotal} questions answered "Not Sure" — the student's learning style preference may need further classroom observation.
            </span>
          </div>
        )}

        {/* Teacher guidance */}
        <div className="bg-[#faf9f6] border border-dashed border-[#d4d0c8] rounded-xl px-5 py-4">
          <p className="text-xs font-semibold tracking-[1px] uppercase text-[#6b6b8a] mb-2">🧑‍🏫 Teacher Guidance</p>
          <ul className="space-y-1.5 text-xs text-[#3a3a5c] leading-relaxed">
            <li>• "Not Sure" does not mean wrong — it means the student chose not to guess and honestly expressed uncertainty.</li>
            <li>• High "Not Sure" in a specific dimension suggests the student needs more exposure and confidence-building in that topic area.</li>
            <li>• Consider using formative check-ins and low-stakes activities to help the student engage with uncertain areas without pressure.</li>
            <li>• Re-assessment after targeted intervention can reveal if uncertainty has converted to understanding.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
