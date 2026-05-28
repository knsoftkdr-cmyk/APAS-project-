import { useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
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

interface ClassReportViewProps {
  assessments: StudentAssessment[];
  classLabel: string;
  filterSection: string;
  teacherName: string;
  reportDate: string;
  reportId: string;
}

/* ─── Colours ─── */
const VARK_COLORS: Record<string, string> = {
  Visual: "#2563eb",
  Auditory: "#d97706",
  "Read/Write": "#7c3aed",
  Kinesthetic: "#e55a3c",
};

const VARK_BG: Record<string, { bg: string; border: string; light: string }> = {
  Visual:       { bg: "#eff6ff", border: "#93c5fd", light: "#1e40af" },
  Auditory:     { bg: "#fffbeb", border: "#fcd34d", light: "#92400e" },
  "Read/Write": { bg: "#f5f3ff", border: "#c4b5fd", light: "#4c1d95" },
  Kinesthetic:  { bg: "#fff1ee", border: "#fca5a5", light: "#9a3412" },
};

const GROUP_META = [
  { key: "Visual",      label: "Group A — Visual achievers",      bg: "#eff6ff", border: "#93c5fd", labelColor: "#1e40af", countBg: "#bfdbfe", strategy: "Diagram-first lesson templates. Colour-coded diagrams, labelled visual explainers, mind-map summaries." },
  { key: "Read/Write",  label: "Group B — Read/Write processors",  bg: "#e1f5ee", border: "#6ee7c4", labelColor: "#085041", countBg: "#99f6e4", strategy: "Structured note templates, written case studies, definition-first explanations." },
  { key: "Auditory",    label: "Group C — Auditory learners",      bg: "#fffbeb", border: "#fcd34d", labelColor: "#92400e", countBg: "#fde68a", strategy: "Discussion-based discovery, think-aloud protocols, podcast-style lesson summaries." },
  { key: "Kinesthetic", label: "Group D — Kinesthetic learners",   bg: "#fff1ee", border: "#fca5a5", labelColor: "#9a3412", countBg: "#fecaca", strategy: "Model-building tasks, hands-on activities, drag-and-drop digital simulations." },
];

/* ─── Helpers ─── */
function scoreColor(s: number) {
  return s >= 70 ? "#16a34a" : s >= 50 ? "#d97706" : "#e55a3c";
}

/* ─── Main Component ─── */
export const ClassReportView = ({
  assessments, classLabel, filterSection, teacherName, reportDate, reportId,
}: ClassReportViewProps) => {
  const data = useMemo(() => {
    const allScores: {
      studentName: string;
      avgScore: number;
      varkDominant: string;
      strongAreas: number;
      needsAttention: number;
      notSureCount: number;
      totalQuestions: number;
      varkNotSure: number;
    }[] = [];

    const varkCounts: Record<string, number> = { Visual: 0, Auditory: 0, "Read/Write": 0, Kinesthetic: 0 };
    const varkGroups: Record<string, string[]> = { Visual: [], Auditory: [], "Read/Write": [], Kinesthetic: [] };
    const dimensionMap: Record<string, { total: number; count: number; notSureTotal: number }> = {};

    assessments.forEach(a => {
      const scores = analyzeResponses(a.age_group, a.responses as Record<string, number>);
      const varkR = (a.responses as any)?.vark as Record<string, string> | undefined;
      const vark = deriveVarkScores(a.age_group, a.responses as Record<string, number>, varkR);
      if (!scores) return;

      const avgScore = Math.round(scores.reduce((s, d) => s + d.percentage, 0) / scores.length);
      const strong = scores.filter(s => s.level === "High").length;
      const needs = scores.filter(s => s.level === "Developing").length;
      const notSureCount = scores.reduce((sum, s) => sum + s.notSureCount, 0);
      const totalQuestions = scores.reduce((sum, s) => sum + s.totalQuestions, 0);

      allScores.push({ studentName: a.student_name, avgScore, varkDominant: vark.dominant, strongAreas: strong, needsAttention: needs, notSureCount, totalQuestions, varkNotSure: vark.notSureCount });
      varkCounts[vark.dominant]++;
      varkGroups[vark.dominant]?.push(a.student_name);

      scores.forEach(dim => {
        if (!dimensionMap[dim.dimension]) dimensionMap[dim.dimension] = { total: 0, count: 0, notSureTotal: 0 };
        dimensionMap[dim.dimension].total += dim.percentage;
        dimensionMap[dim.dimension].count += 1;
        dimensionMap[dim.dimension].notSureTotal += dim.notSureCount;
      });
    });

    const dimensionAverages = Object.entries(dimensionMap).map(([dimension, d]) => ({
      dimension, average: Math.round(d.total / d.count), notSureTotal: d.notSureTotal,
    }));

    const classAvg = allScores.length > 0
      ? Math.round(allScores.reduce((s, a) => s + a.avgScore, 0) / allScores.length) : 0;
    const dominantVark = Object.entries(varkCounts).reduce((a, b) => a[1] >= b[1] ? a : b);

    // Score distribution buckets
    const buckets = [
      { range: "0–39%", count: 0, color: "#e55a3c" },
      { range: "40–54%", count: 0, color: "#e55a3c" },
      { range: "55–69%", count: 0, color: "#d97706" },
      { range: "70–84%", count: 0, color: "#0e9a7b" },
      { range: "85%+", count: 0, color: "#0e9a7b" },
    ];
    allScores.forEach(s => {
      if (s.avgScore < 40) buckets[0].count++;
      else if (s.avgScore < 55) buckets[1].count++;
      else if (s.avgScore < 70) buckets[2].count++;
      else if (s.avgScore < 85) buckets[3].count++;
      else buckets[4].count++;
    });

    const totalNotSure = allScores.reduce((sum, s) => sum + s.notSureCount + s.varkNotSure, 0);

    return { allScores, varkCounts, varkGroups, dimensionAverages, classAvg, dominantVark, buckets, totalStudents: assessments.length, totalNotSure };
  }, [assessments]);

  // VARK pie data
  const varkPieData = Object.entries(data.varkCounts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  // Per-student bar data
  const studentBarData = data.allScores.map(s => ({
    name: s.studentName.split(" ")[0],
    score: s.avgScore,
    fill: VARK_COLORS[s.varkDominant] || "#6b6b8a",
  }));

  // Weakest group for alert
  const weakestGroup = GROUP_META
    .map(g => {
      const names = data.varkGroups[g.key] || [];
      const avg = names.length > 0
        ? Math.round(data.allScores.filter(s => names.includes(s.studentName)).reduce((a, b) => a + b.avgScore, 0) / names.length)
        : 0;
      return { ...g, names, avg };
    })
    .filter(g => g.names.length > 0)
    .sort((a, b) => a.avg - b.avg)[0];

  return (
    <div className="space-y-7 bg-[#f6f5f2] p-5 rounded-xl" style={{ fontFamily: "'Sora', 'DM Sans', sans-serif" }}>
      {/* HEADER */}
      <div className="flex justify-between items-start pb-5 border-b-2 border-[#1c1c2e]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#1c1c2e]" style={{ fontFamily: "'Playfair Display', 'DM Serif Display', serif" }}>
            APAS <em className="text-[#0e9a7b] italic">Class Diagnostic</em>
          </h1>
        </div>
        <div className="text-right">
          <p className="text-xs text-[#8282a8]">Report ID: {reportId}</p>
          <p className="text-[13px] font-medium text-[#3d3d5c] mt-0.5">{reportDate}</p>
          <span className="inline-block bg-[#0e9a7b] text-white text-[10px] font-semibold tracking-[1.5px] uppercase px-2.5 py-1 rounded-full mt-1.5">
            {data.totalStudents} Learners Assessed
          </span>
        </div>
      </div>

      {/* META BAR */}
      <div className="grid grid-cols-5 gap-2.5">
        {[
          { label: "Class", value: `${classLabel}${filterSection !== "all" ? `-${filterSection}` : ""}` },
          { label: "Class Avg Score", value: `${data.classAvg}%` },
          { label: "Dominant VARK", value: data.dominantVark[0], color: VARK_COLORS[data.dominantVark[0]], sub: `${data.dominantVark[1]} of ${data.totalStudents} learners` },
          { label: "Class Teacher", value: teacherName },
          { label: "Students", value: `${data.totalStudents}` },
        ].map((m, i) => (
          <div key={i} className="bg-white border border-[#e4e2dc] rounded-[10px] p-3">
            <p className="text-[10px] font-semibold tracking-[1.5px] uppercase text-[#8282a8] mb-1">{m.label}</p>
            <p className="text-xl font-bold" style={{ fontFamily: "'Playfair Display', serif", color: m.color || "#1c1c2e" }}>{m.value}</p>
            {m.sub && <p className="text-[11px] text-[#8282a8] mt-0.5">{m.sub}</p>}
          </div>
        ))}
      </div>

      {/* LEARNER ROSTER */}
      <div>
        <SectionTitle>Full learner roster — diagnostic snapshot</SectionTitle>
        <div className="overflow-x-auto bg-white border border-[#e4e2dc] rounded-xl">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-[1.5px] border-[#e4e2dc]">
                {["#", "Learner", "Avg Score", "VARK", "Strong Areas", "Needs Attention", "Not Sure"].map(h => (
                  <th key={h} className="text-left text-[10px] font-semibold tracking-[1.2px] uppercase text-[#8282a8] px-2.5 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.allScores.map((s, i) => (
                <tr key={i} className="border-b border-[#e4e2dc] last:border-b-0 hover:bg-[#fafaf8]">
                  <td className="px-2.5 py-[7px] text-[#8282a8]">{i + 1}</td>
                  <td className="px-2.5 py-[7px] font-medium text-[#1c1c2e]">{s.studentName}</td>
                  <td className="px-2.5 py-[7px] font-semibold" style={{ color: scoreColor(s.avgScore) }}>{s.avgScore}%</td>
                  <td className="px-2.5 py-[7px]">
                    <span
                      className="inline-block px-2 py-0.5 rounded-xl text-[10px] font-semibold"
                      style={{ background: VARK_BG[s.varkDominant]?.bg, color: VARK_BG[s.varkDominant]?.light }}
                    >
                      {s.varkDominant}
                    </span>
                  </td>
                  <td className="px-2.5 py-[7px] text-emerald-600 font-medium">{s.strongAreas}</td>
                  <td className="px-2.5 py-[7px] text-red-500 font-medium">{s.needsAttention}</td>
                  <td className="px-2.5 py-[7px] font-medium" style={{ color: (s.notSureCount + s.varkNotSure) > 0 ? '#4338ca' : '#8282a8' }}>
                    {s.notSureCount + s.varkNotSure}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CHARTS ROW */}
      <div className="grid grid-cols-2 gap-4">
        {/* VARK Doughnut */}
        <div className="bg-white border border-[#e4e2dc] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#3d3d5c] uppercase tracking-[1px] mb-3">VARK Distribution — Class of {data.totalStudents}</p>
          <div className="flex gap-2 flex-wrap mb-2">
            {Object.entries(data.varkCounts).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1 text-[11px] text-[#8282a8]">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: VARK_COLORS[k] }} />
                {k} {v as number}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={varkPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="value">
                {varkPieData.map((entry) => (
                  <Cell key={entry.name} fill={VARK_COLORS[entry.name]} stroke="#fff" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number, name: string) => [`${value} students`, name]} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Score Distribution Bar */}
        <div className="bg-white border border-[#e4e2dc] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#3d3d5c] uppercase tracking-[1px] mb-3">Score Distribution</p>
          <div className="flex gap-3 flex-wrap mb-2">
            <span className="flex items-center gap-1 text-[11px] text-[#8282a8]"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#e55a3c" }} />Below 55%</span>
            <span className="flex items-center gap-1 text-[11px] text-[#8282a8]"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#d97706" }} />55–69%</span>
            <span className="flex items-center gap-1 text-[11px] text-[#8282a8]"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#0e9a7b" }} />70%+</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.buckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e2dc" vertical={false} />
              <XAxis dataKey="range" tick={{ fontSize: 11, fill: "#8282a8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#8282a8" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {data.buckets.map((b: any, i: number) => (
                  <Cell key={i} fill={b.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* INSTRUCTIONAL CLUSTERS */}
      <div>
        <SectionTitle>Instructional clusters — curative grouping</SectionTitle>
        <div className="grid grid-cols-2 gap-3.5">
          {GROUP_META.map(g => {
            const names = data.varkGroups[g.key] || [];
            if (names.length === 0) {
              return (
                <div key={g.key} className="rounded-xl p-4 opacity-60" style={{ background: g.bg, border: `1.5px dashed ${g.border}` }}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[13px] font-semibold" style={{ color: g.labelColor }}>{g.label}</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[10px]" style={{ background: g.countBg, color: g.labelColor }}>0 learners</span>
                  </div>
                  <p className="text-[12px] text-[#8282a8] italic">No {g.key.toLowerCase()} learners identified in this class.</p>
                </div>
              );
            }
            const groupAvg = Math.round(
              data.allScores.filter(s => names.includes(s.studentName)).reduce((a, b) => a + b.avgScore, 0) / names.length
            );
            return (
              <div key={g.key} className="rounded-xl p-4" style={{ background: g.bg, border: `1.5px solid ${g.border}` }}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[13px] font-semibold" style={{ color: g.labelColor }}>{g.label}</span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[10px]" style={{ background: g.countBg, color: g.labelColor }}>{names.length} learners</span>
                </div>
                <p className="text-[11px] text-[#3d3d5c] mb-2 leading-relaxed">{names.join(", ")}</p>
                <div className="border-t border-black/[0.08] pt-2">
                  <p className="text-[10px] font-semibold tracking-[1px] uppercase text-[#3d3d5c] mb-1">Curative Strategy</p>
                  <p className="text-[11px] text-[#8282a8] leading-relaxed">{g.strategy} Avg score: {groupAvg}%.</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PER-STUDENT BAR CHART */}
      <div>
        <SectionTitle>Score spread — class readiness map</SectionTitle>
        <div className="bg-white border border-[#e4e2dc] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={studentBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e2dc" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#8282a8" }} axisLine={false} tickLine={false} interval={0} angle={-45} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11, fill: "#8282a8" }} axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip formatter={(value: number, _: string, props: any) => {
                const idx = props?.payload ? studentBarData.indexOf(props.payload) : -1;
                const full = idx >= 0 ? data.allScores[idx] : null;
                return [`${value}% (${full?.varkDominant || ''})`, full?.studentName || ''];
              }} />
              <Bar dataKey="score" radius={[3, 3, 0, 0]}>
                {studentBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-3 flex-wrap mt-2">
            {Object.entries(VARK_COLORS).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1 text-[11px] text-[#8282a8]">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />{k}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* CLASS DIMENSION AVERAGES */}
      <div>
        <SectionTitle>Class dimension averages</SectionTitle>
        <div className="space-y-2">
          {data.dimensionAverages.map((d: any) => {
            const barColor = d.average >= 70 ? "#0e9a7b" : d.average >= 40 ? "#d97706" : "#e55a3c";
            return (
              <div key={d.dimension} className="flex items-center gap-3">
                <span className="text-[13px] text-[#1c1c2e] min-w-[180px] truncate">{d.dimension}</span>
                <div className="flex-1 h-2 bg-[#e4e2dc] rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${d.average}%`, background: barColor }} />
                </div>
                <span className="text-[13px] font-semibold text-[#3d3d5c] w-10 text-right">{d.average}%</span>
                {d.notSureTotal > 0 && (
                  <span className="text-[11px] font-medium text-[#4338ca] min-w-[60px]">🤷 {d.notSureTotal}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* CURATIVE LESSON PLAN DIRECTIVES */}
      <div>
        <SectionTitle>Curative phase lesson plan directives</SectionTitle>
        <div className="bg-[#1c1c2e] text-white rounded-2xl px-6 py-5">
          <h3 className="text-[17px] font-bold mb-0.5" style={{ fontFamily: "'Playfair Display', serif" }}>
            AI-generated lesson plan parameters
          </h3>
          <p className="text-[10px] tracking-[1.5px] uppercase text-white/40 mb-5">
            Inputs for Phase 2 curative engine · {classLabel}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Lesson Opener", val: `${data.dominantVark[0]}-anchor approach. Whole-class observation using dominant modality before instruction begins.` },
              { label: "Core Delivery", val: `Dual-channel: teacher narration + ${data.dominantVark[0].toLowerCase()} aids. Addresses ${data.dominantVark[0]} (${Math.round((data.dominantVark[1] as number / data.totalStudents) * 100)}%) simultaneously.` },
              { label: "Group Activity", val: GROUP_META.filter(g => (data.varkGroups[g.key]?.length || 0) > 0).map(g => `${g.label.split(" — ")[0]}: ${g.strategy.split(".")[0]}`).join(". ") + "." },
              { label: "Scaffolding Level", val: `Class avg ${data.classAvg}%. 3-tier task cards: support / core / extension per VARK group.` },
              { label: "Assessment Check", val: "Exit ticket: 3-question formative. Auto-scored. Feeds Phase 3 analytics immediately." },
              { label: "Teacher Tools", val: "VARK-aligned question bank, collaborative project boards, case study card sets per group." },
            ].map((c, i) => (
              <div key={i} className="bg-white/[0.06] rounded-lg p-3 border border-white/10">
                <p className="text-[9px] font-semibold tracking-[1.5px] uppercase text-white/40 mb-1.5">{c.label}</p>
                <p className="text-xs text-white/[0.88] leading-relaxed">{c.val}</p>
              </div>
            ))}
          </div>
          {weakestGroup && weakestGroup.avg < 50 && (
            <div className="mt-4 bg-[#e55a3c]/15 border border-[#e55a3c]/40 rounded-lg px-3.5 py-2.5 flex gap-2 items-start text-xs text-[#fca5a5]">
              <span className="text-sm shrink-0 mt-0.5">⚠</span>
              <span>
                {weakestGroup.names.length} {weakestGroup.key.toLowerCase()} learners ({weakestGroup.label.split(" — ")[1]}) scored below {weakestGroup.avg}% avg.
                APAS flags risk of delivery mismatch if only {data.dominantVark[0].toLowerCase()}-based instruction is used whole-class.
                Hands-on / modality-specific activity is mandatory for this cohort.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* FOOTER */}
      <div className="border-t border-[#e4e2dc] pt-4 flex justify-between items-center">
        <p className="text-[11px] text-[#8282a8]">
          Generated by APAS AI · Teacher: {teacherName} · {classLabel}{filterSection !== "all" ? ` Section ${filterSection}` : ""} · For instructional planning use only
        </p>
        <p className="text-[13px] text-[#3d3d5c] italic" style={{ fontFamily: "'Playfair Display', serif" }}>
          APAS · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
};

/* ─── Sub-components ─── */
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2
    className="text-lg font-bold text-[#1c1c2e] mb-4 flex items-center gap-2"
    style={{ fontFamily: "'Playfair Display', 'DM Serif Display', serif" }}
  >
    <span className="block w-[3px] h-5 rounded-sm bg-[#0e9a7b]" />
    {children}
  </h2>
);
