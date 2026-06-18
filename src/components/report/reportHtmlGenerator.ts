import type { AgeGroupReport, DimensionScore } from "@/data/reportTheories";
import type { VarkScores } from "@/data/varkMapping";

interface ReportData {
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

export function generateReportHtml(data: ReportData): string {
  const { studentName, studentAge, ageGroup, submittedAt, reportConfig, scores, varkScores, studentClass, teacherName } = data;

  const highCount = scores.filter((s) => s.level === "High").length;
  const moderateCount = scores.filter((s) => s.level === "Moderate").length;
  const developingCount = scores.filter((s) => s.level === "Developing").length;
  const totalNotSure = scores.reduce((sum, s) => sum + s.notSureCount, 0);
  const varkNotSure = varkScores.notSureCount;
  const varkTotal = varkScores.totalQuestions;

  const formattedDate = new Date(submittedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const reportId = `APD-${new Date(submittedAt).getFullYear()}-${String(new Date(submittedAt).getMonth() + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;

  const levelPill = (level: string) => {
    if (level === "High") return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-weight:600;font-size:12px;background:#dff0d8;color:#2d6a2d;">${level}</span>`;
    if (level === "Moderate") return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-weight:600;font-size:12px;background:#fef3c7;color:#92400e;">${level}</span>`;
    return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-weight:600;font-size:12px;background:#fee2e2;color:#991b1b;">${level}</span>`;
  };

  const barColor = (s: DimensionScore) => s.level === "High" ? "#0e9a7b" : s.level === "Moderate" ? "#d97706" : "#e55a3c";

  // VARK cards
  const varkEntries = [
    { letter: "V", name: "Visual", score: varkScores.visual },
    { letter: "A", name: "Auditory", score: varkScores.auditory },
    { letter: "R", name: "Read / Write", score: varkScores.readWrite },
    { letter: "K", name: "Kinesthetic", score: varkScores.kinesthetic },
  ];
  const maxVark = Math.max(...varkEntries.map(e => e.score));

  const dominant = varkEntries.reduce((a, b) => (a.score >= b.score ? a : b));
  const weakest = varkEntries.reduce((a, b) => (a.score <= b.score ? a : b));
  const varkDescription = `${studentName} shows a strong preference for ${dominant.name.toLowerCase()} processing. ${dominant.name}-oriented activities will yield the highest retention. ${weakest.name} formats may need additional scaffolding.`;

  const varkCards = varkEntries.map(v => {
    const isDominant = v.score === maxVark;
    return `<div style="background:${isDominant ? '#e1f5ee' : '#fff'};border:1.5px solid ${isDominant ? '#0e9a7b' : '#e2e0d8'};border-radius:12px;padding:16px 12px;text-align:center;position:relative;overflow:hidden;">
      ${isDominant ? `<span style="position:absolute;top:6px;right:6px;font-size:8px;font-weight:700;letter-spacing:1px;color:#0e9a7b;">DOMINANT</span>` : ''}
      <div style="font-family:'DM Serif Display',serif;font-size:36px;color:${isDominant ? '#0e9a7b' : '#1a1a2e'};margin-bottom:4px;">${v.letter}</div>
      <div style="font-size:11px;font-weight:500;color:#6b6b8a;margin-bottom:10px;">${v.name}</div>
      <div style="background:#e2e0d8;border-radius:4px;height:8px;width:100%;"><div style="height:8px;border-radius:4px;background:${isDominant ? '#0e9a7b' : '#6b6b8a'};width:${v.score}%;"></div></div>
      <div style="font-size:13px;font-weight:600;color:#3a3a5c;margin-top:6px;">${v.score}%</div>
    </div>`;
  }).join("");

  const dimensionRows = scores.map((s) => {
    const isTop = s.level === "High";
    return `<div style="background:${isTop ? "#f5f3ff" : "#fff"};border:1.5px solid ${isTop ? "#7c3aed" : "#e2e0d8"};border-radius:12px;padding:16px 20px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
        <div><div style="font-weight:600;font-size:14px;color:#1a1a2e;">${s.dimension}</div><div style="font-size:12px;color:#6b6b8a;">${s.theory}</div></div>
        ${levelPill(s.level)}
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <div style="flex:1;height:8px;background:#e2e0d8;border-radius:4px;overflow:hidden;">
          <div style="width:${s.percentage}%;height:100%;background:${barColor(s)};border-radius:4px;"></div>
        </div>
        <span style="font-size:13px;font-weight:700;color:#3a3a5c;min-width:40px;text-align:right;">${s.percentage}%</span>
      </div>
      <p style="font-size:12px;color:#6b6b8a;margin:0 0 4px 0;">${s.description}</p>
      <p style="font-size:12px;color:#3a3a5c;margin:0;line-height:1.6;">${s.interpretation}</p>
      ${s.notSureCount > 0 ? `<p style="font-size:12px;color:#4338ca;margin:6px 0 0 0;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:rgba(67,56,202,0.3);"></span>${s.notSureCount} of ${s.totalQuestions} questions answered "Not Sure" — indicates cognitive uncertainty.</p>` : ''}
    </div>`;
  }).join("");

  const tableRows = scores.map((s) => `
    <tr style="border-bottom:1px solid #e2e0d8;">
      <td style="padding:10px 12px;font-weight:500;color:#3a3a5c;">${s.dimension}</td>
      <td style="padding:10px 12px;color:#6b6b8a;font-size:12px;">${s.theory}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:600;color:#3a3a5c;">${s.percentage}%</td>
      <td style="padding:10px 12px;text-align:center;">${levelPill(s.level)}</td>
      <td style="padding:10px 12px;text-align:center;font-size:12px;color:${s.notSureCount > 0 ? '#4338ca' : '#6b6b8a'};font-weight:${s.notSureCount > 0 ? '600' : '400'};">${s.notSureCount > 0 ? `${s.notSureCount}/${s.totalQuestions}` : '0'}</td>
    </tr>`).join("");

  // AI recommendations
  const devScores = scores.filter(s => s.level === "Developing");
  const modScores = scores.filter(s => s.level === "Moderate");
  const highScores = scores.filter(s => s.level === "High");

  let recItems = "";
  if (devScores.length > 0) {
    recItems += devScores.map(s => `<li><strong>${s.dimension}</strong> needs focused attention. ${s.interpretation}</li>`).join("");
  } else if (modScores.length > 0) {
    recItems += modScores.slice(0, 3).map(s => `<li><strong>${s.dimension}</strong> is at a moderate level. ${s.interpretation}</li>`).join("");
  } else {
    recItems += `<li>All dimensions are performing at a <strong>high level</strong>. Continue with enrichment activities and advanced challenges.</li>`;
  }
  if (highScores.length > 0) {
    recItems += `<li>Leverage strengths in <strong>${highScores.map(s => s.dimension).join(", ")}</strong> to scaffold weaker areas through cross-domain activities.</li>`;
  }

  const theoryTags = reportConfig.theories.map(t =>
    `<span class="ai-tag">${t}</span>`
  ).join(" ");

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>APAS Diagnostic Report - ${studentName}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#f7f5f0;font-family:'DM Sans',sans-serif;color:#1a1a2e;padding:0;
    -webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;}
  .report{max-width:780px;margin:0 auto;padding:32px 24px;}
  .section{margin-bottom:28px;}
  .section-title{font-family:'DM Serif Display',serif;font-size:20px;color:#1a1a2e;margin-bottom:16px;display:flex;align-items:center;gap:10px;}
  .section-title::before{content:'';display:block;width:4px;height:22px;border-radius:2px;background:#0e9a7b;}
  .vark-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px;}
  .ai-box{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:16px;padding:24px 28px;color:white;}
  .ai-box-title{font-family:'DM Serif Display',serif;font-size:18px;color:white;margin-bottom:4px;}
  .ai-box-sub{font-size:12px;color:rgba(255,255,255,0.45);margin-bottom:20px;letter-spacing:1px;text-transform:uppercase;}
  .ai-rec-list{list-style:none;display:flex;flex-direction:column;gap:10px;padding:0;}
  .ai-rec-list li{display:flex;gap:12px;align-items:flex-start;font-size:13px;color:rgba(255,255,255,0.85);line-height:1.5;}
  .ai-rec-list li::before{content:'→';color:#0e9a7b;font-weight:600;flex-shrink:0;margin-top:1px;}
  .ai-tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;}
  .ai-tag{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.65);font-size:11px;font-weight:500;padding:4px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.12);}
  @media print{
    body{padding:0;background:#fff !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;}
    .report{padding:16px;}
    .ai-box{background:#1a1a2e !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
  }
</style>
</head><body><div class="report">

  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid #1a1a2e;">
    <div>
      <div style="font-family:'DM Serif Display',serif;font-size:28px;color:#1a1a2e;letter-spacing:-0.5px;">APAS <span style="color:#0e9a7b;font-style:italic;">Diagnostic</span> Report</div>
      <div style="font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#8282a8;margin-top:3px;">Phase 1 · Diagnostic Assessment</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:12px;color:#6b6b8a;font-weight:300;">Report ID: ${reportId}</div>
      <div style="font-size:13px;font-weight:500;color:#3a3a5c;margin-top:2px;">${formattedDate}</div>
      <span style="display:inline-block;background:#0e9a7b;color:white;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;padding:4px 10px;border-radius:20px;margin-top:6px;">Assessment Complete</span>
    </div>
  </div>

  <!-- LEARNER CARD -->
  <div style="background:#1a1a2e;color:white;border-radius:16px;padding:24px 28px;margin-bottom:28px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div>
      <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:4px;">Learner</div>
      <div style="font-family:'DM Serif Display',serif;font-size:18px;">${studentName}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.55);">Age ${studentAge}</div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:4px;">Class</div>
      <div style="font-family:'DM Serif Display',serif;font-size:18px;">${studentClass || 'N/A'}</div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:4px;">Class Teacher</div>
      <div style="font-family:'DM Serif Display',serif;font-size:18px;">${teacherName || 'N/A'}</div>
    </div>
  </div>

  <!-- SUMMARY -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px;">
    <div style="background:#dff0d8;border:1px solid rgba(45,106,45,0.2);border-radius:12px;padding:16px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="font-size:28px;font-weight:700;color:#2d6a2d;">${highCount}</div>
      <div style="font-size:12px;font-weight:500;color:#2d6a2d;">Strong Areas</div>
    </div>
    <div style="background:#fef3c7;border:1px solid rgba(146,64,14,0.2);border-radius:12px;padding:16px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="font-size:28px;font-weight:700;color:#92400e;">${moderateCount}</div>
      <div style="font-size:12px;font-weight:500;color:#92400e;">Moderate Areas</div>
    </div>
    <div style="background:#fee2e2;border:1px solid rgba(153,27,27,0.2);border-radius:12px;padding:16px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="font-size:28px;font-weight:700;color:#991b1b;">${developingCount}</div>
      <div style="font-size:12px;font-weight:500;color:#991b1b;">Needs Attention</div>
    </div>
    <div style="background:#f0f0ff;border:1px solid rgba(67,56,202,0.2);border-radius:12px;padding:16px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="font-size:28px;font-weight:700;color:#4338ca;">${totalNotSure + varkNotSure}</div>
      <div style="font-size:12px;font-weight:500;color:#4338ca;">"Not Sure" Responses</div>
    </div>
  </div>

  <!-- VARK LEARNING STYLE PROFILE -->
  <div class="section">
    <div class="section-title">VARK Learning Style Profile</div>
    <div class="vark-grid">${varkCards}</div>
    <p style="font-size:12px;color:#6b6b8a;margin-top:18px;line-height:1.6;">${varkDescription}</p>
    ${varkNotSure > 0 ? `<p style="font-size:12px;color:#4338ca;margin-top:8px;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:rgba(67,56,202,0.3);"></span>${varkNotSure} of ${varkTotal} VARK questions answered "Not Sure" — learning style preference may need further observation.</p>` : ''}
  </div>

  <!-- DIMENSION ANALYSIS -->
  <div class="section">
    <div class="section-title">Dimension Analysis</div>
    ${dimensionRows}
  </div>

  <!-- SCORE TABLE -->
  <div class="section">
    <div class="section-title">Assessment Score Breakdown</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e2e0d8;border-radius:12px;overflow:hidden;">
      <thead>
        <tr style="border-bottom:2px solid #e2e0d8;">
          <th style="text-align:left;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6b6b8a;padding:10px 12px;">Dimension</th>
          <th style="text-align:left;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6b6b8a;padding:10px 12px;">Theory</th>
          <th style="text-align:center;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6b6b8a;padding:10px 12px;">Score</th>
          <th style="text-align:center;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6b6b8a;padding:10px 12px;">Level</th>
          <th style="text-align:center;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6b6b8a;padding:10px 12px;">Not Sure</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <!-- NOT SURE INSIGHT -->
  ${(() => {
    const allNotSure = totalNotSure + varkNotSure;
    const allTotal = scores.reduce((s, sc) => s + sc.totalQuestions, 0) + varkTotal;
    const pct = allTotal > 0 ? Math.round((allNotSure / allTotal) * 100) : 0;
    if (allNotSure === 0) return '';
    const unsureDims = scores.filter(s => s.notSureCount > 0);
    let sevLabel = "Low", sevColor = "#0e9a7b", sevBg = "#e1f5ee";
    if (pct >= 40) { sevLabel = "High"; sevColor = "#991b1b"; sevBg = "#fee2e2"; }
    else if (pct >= 20) { sevLabel = "Moderate"; sevColor = "#92400e"; sevBg = "#fef3c7"; }
    const interpretation = pct >= 40
      ? "This is a significant number, suggesting the student may lack confidence or familiarity in several areas. The teacher should provide additional support and one-on-one guidance."
      : pct >= 20
        ? "This indicates moderate uncertainty. The student may benefit from revisiting foundational concepts in the affected areas with guided practice."
        : "This is within a normal range. The student shows reasonable confidence across most areas.";
    const dimRows = unsureDims.map(s => {
      const dp = s.totalQuestions > 0 ? Math.round((s.notSureCount / s.totalQuestions) * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:12px;background:#f8f8ff;border-radius:8px;padding:8px 16px;margin-bottom:6px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:rgba(67,56,202,0.4);flex-shrink:0;"></span>
        <span style="flex:1;font-size:13px;color:#3a3a5c;"><strong>${s.dimension}</strong> <span style="color:#6b6b8a;font-size:12px;">(${s.notSureCount} of ${s.totalQuestions} — ${dp}%)</span></span>
        <div style="width:96px;height:6px;background:#e2e0d8;border-radius:3px;overflow:hidden;"><div style="height:100%;border-radius:3px;background:#4338ca;width:${dp}%;"></div></div>
      </div>`;
    }).join('');
    const varkRow = varkNotSure > 0 ? `<div style="display:flex;align-items:center;gap:12px;background:#f8f8ff;border-radius:8px;padding:8px 16px;margin-bottom:6px;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:rgba(67,56,202,0.4);flex-shrink:0;"></span>
      <span style="font-size:13px;color:#3a3a5c;"><strong>VARK Learning Style:</strong> ${varkNotSure} of ${varkTotal} questions answered "Not Sure" — learning style preference may need further observation.</span>
    </div>` : '';
    return `<div class="section" style="background:#fff;border:1.5px solid #e2e0d8;border-radius:16px;overflow:hidden;">
      <div style="background:#f0f0ff;padding:16px 24px;border-bottom:1px solid #e2e0d8;">
        <div style="font-family:'DM Serif Display',serif;font-size:18px;color:#1a1a2e;display:flex;align-items:center;gap:10px;">
          <span style="display:block;width:4px;height:22px;border-radius:2px;background:#4338ca;"></span>"Not Sure" Response Analysis
        </div>
        <p style="font-size:12px;color:#6b6b8a;margin-top:4px;">Why this matters: The "Not Sure" option lets students honestly indicate uncertainty rather than guessing randomly. This helps identify genuine areas of cognitive uncertainty.</p>
      </div>
      <div style="padding:20px 24px;">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
          <div style="text-align:center;padding:8px 16px;border-radius:12px;background:${sevBg};">
            <div style="font-size:24px;font-weight:700;color:${sevColor};">${allNotSure}</div>
            <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${sevColor};">${sevLabel} Uncertainty</div>
          </div>
          <p style="font-size:13px;color:#3a3a5c;line-height:1.6;flex:1;">${studentName} selected "Not Sure" for <strong>${allNotSure} out of ${allTotal}</strong> questions (${pct}%). ${interpretation}</p>
        </div>
        ${unsureDims.length > 0 ? `<p style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#6b6b8a;margin-bottom:8px;">Dimensions with uncertainty</p>${dimRows}` : ''}
        ${varkRow}
        <div style="background:#faf9f6;border:1px dashed #d4d0c8;border-radius:12px;padding:16px 20px;margin-top:12px;">
          <p style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#6b6b8a;margin-bottom:8px;">🧑‍🏫 Teacher Guidance</p>
          <ul style="list-style:none;padding:0;margin:0;font-size:12px;color:#3a3a5c;line-height:1.7;">
            <li>• "Not Sure" does not mean wrong — it means the student honestly expressed uncertainty.</li>
            <li>• High "Not Sure" in a specific dimension suggests the student needs more exposure and confidence-building.</li>
            <li>• Use formative check-ins and low-stakes activities to help the student engage without pressure.</li>
            <li>• Re-assessment after targeted intervention can reveal if uncertainty has converted to understanding.</li>
          </ul>
        </div>
      </div>
    </div>`;
  })()}

  <!-- AI RECOMMENDATIONS -->
  <div class="section">
    <div class="ai-box">
      <div class="ai-box-title">AI Instructional Recommendations</div>
      <div class="ai-box-sub">Generated by APAS Engine · Curative Phase Inputs</div>
      <ul class="ai-rec-list">${recItems}</ul>
      <div class="ai-tags">
        ${theoryTags}
        <span class="ai-tag">Age Group: ${ageGroup}+</span>
      </div>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="border-top:1px solid #e2e0d8;padding-top:16px;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:11px;color:#6b6b8a;">This report is auto-generated by the APAS AI engine. For academic use only.</div>
    <div style="font-family:'DM Serif Display',serif;font-size:14px;color:#3a3a5c;font-style:italic;">APAS · ${new Date().getFullYear()}</div>
  </div>

</div></body></html>`;
}
