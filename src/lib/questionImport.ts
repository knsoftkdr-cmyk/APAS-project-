// Bulk question import for the Item Bank. Reads a teacher's existing multiple-choice questions from a file in the
// browser and turns them into rows for generate-item-bank's "bulk_import" action, which auto-tags them.
//
//   Spreadsheet (.csv, .xlsx, .xls): one question per row, with a header row. See IMPORT_TEMPLATE_CSV.
//   Document (.docx, .pdf, .txt):    numbered questions, options A) to D), then "Answer: B" and optionally
//                                    "Explanation: ...". See the example in IMPORT_DOC_EXAMPLE.
//
// Parsing is pure (no network), so it is unit-tested and every row that can't be read is reported back with a reason.

import { extOf } from "@/lib/tutorAttachments";
import { readDocumentText } from "@/lib/documentText";

export const IMPORT_ACCEPT = ".csv,.xlsx,.xls,.docx,.pdf,.txt";
export const IMPORT_BATCH = 30; // keep in sync with MAX_PER_CALL in bulkImportItems.ts
export const IMPORT_MAX = 1000;

const LETTERS = ["A", "B", "C", "D"] as const;

export interface ImportedQuestion {
  stem: string;
  options: Record<string, string>;
  correct: string;
  explanation: string | null;
  difficulty: string | null;
  topic_hint: string | null;
  where: string; // "Row 4" / "Question 7", shown next to problems
}

export interface ImportProblem { where: string; message: string }
export interface ImportParseResult { questions: ImportedQuestion[]; problems: ImportProblem[] }

export const IMPORT_TEMPLATE_CSV =
  "question,option_a,option_b,option_c,option_d,answer,explanation,difficulty,topic\n" +
  "\"What is 1/2 + 1/4?\",1/6,2/6,3/4,1/8,C,\"Make the denominators equal: 2/4 + 1/4 = 3/4.\",easy,Fractions\n";

export const IMPORT_DOC_EXAMPLE = `1. What is 1/2 + 1/4?
A) 1/6
B) 2/6
C) 3/4
D) 1/8
Answer: C
Explanation: Make the denominators equal: 2/4 + 1/4 = 3/4.`;

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_ALIASES: Record<string, string[]> = {
  stem: ["question", "questions", "stem", "questiontext", "q"],
  A: ["optiona", "a", "opta", "option1", "choicea", "choice1"],
  B: ["optionb", "b", "optb", "option2", "choiceb", "choice2"],
  C: ["optionc", "c", "optc", "option3", "choicec", "choice3"],
  D: ["optiond", "d", "optd", "option4", "choiced", "choice4"],
  correct: ["answer", "correct", "correctanswer", "correctoption", "key", "answerkey", "ans"],
  explanation: ["explanation", "reason", "solution", "rationale"],
  difficulty: ["difficulty", "level", "difficultylevel"],
  topic: ["topic", "subtopic", "concept", "tag", "tags"],
};

const DIFFICULTY_WORDS: Record<string, string> = { easy: "easy", low: "easy", simple: "easy", medium: "medium", moderate: "medium", average: "medium", hard: "hard", high: "hard", difficult: "hard", tough: "hard" };

/** "B", "(b)", "Option B", "2" or the option's own text -> "B". */
export function answerLetter(raw: unknown, options: Record<string, string>): string | null {
  const a = norm(raw);
  if (!a) return null;
  const m = a.match(/^(?:option\s*)?\(?([A-Da-d])\)?[.)]?$/i);
  if (m) return m[1].toUpperCase();
  if (/^[1-4]$/.test(a)) return LETTERS[Number(a) - 1];
  const hit = LETTERS.find((L) => options[L] && options[L].toLowerCase() === a.toLowerCase());
  return hit ?? null;
}

function finish(where: string, stem: string, options: Record<string, string>, answer: unknown, explanation: unknown, difficulty: unknown, topic: unknown): ImportedQuestion | ImportProblem {
  const s = norm(stem);
  if (!s) return { where, message: "The question text is missing" };
  for (const L of LETTERS) if (!norm(options[L])) return { where, message: `Option ${L} is missing (every question needs 4 options)` };
  const opts = Object.fromEntries(LETTERS.map((L) => [L, norm(options[L])]));
  if (new Set(Object.values(opts).map((v) => v.toLowerCase())).size !== 4) return { where, message: "Two options are the same" };
  const correct = answerLetter(answer, opts);
  if (!correct) return { where, message: norm(answer) ? `The answer "${norm(answer)}" isn't A, B, C or D` : "The answer is missing" };
  return {
    stem: s, options: opts, correct,
    explanation: norm(explanation) || null,
    difficulty: DIFFICULTY_WORDS[key(norm(difficulty))] ?? null,
    topic_hint: norm(topic) || null,
    where,
  };
}

const isProblem = (x: ImportedQuestion | ImportProblem): x is ImportProblem => "message" in x;

/** Spreadsheet rows (first row = headers). */
export function parseQuestionRows(rows: unknown[][]): ImportParseResult {
  const questions: ImportedQuestion[] = [];
  const problems: ImportProblem[] = [];
  const headerAt = rows.findIndex((r) => r.some((c) => norm(c)));
  if (headerAt < 0) return { questions, problems: [{ where: "File", message: "The file is empty" }] };
  const header = rows[headerAt].map((h) => key(norm(h)));
  const col: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) col[field] = i;
  }
  const missing = ["stem", "A", "B", "C", "D", "correct"].filter((f) => col[f] === undefined);
  if (missing.length) {
    return { questions, problems: [{ where: "Header row", message: `Columns needed: question, option_a, option_b, option_c, option_d, answer. Not found: ${missing.map((m) => (m === "stem" ? "question" : m === "correct" ? "answer" : `option_${m.toLowerCase()}`)).join(", ")}` }] };
  }
  const cell = (r: unknown[], f: string) => (col[f] === undefined ? "" : r[col[f]]);
  for (let i = headerAt + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => norm(c))) continue;
    const where = `Row ${i + 1}`;
    const out = finish(where, String(cell(r, "stem") ?? ""), { A: String(cell(r, "A") ?? ""), B: String(cell(r, "B") ?? ""), C: String(cell(r, "C") ?? ""), D: String(cell(r, "D") ?? "") },
      cell(r, "correct"), cell(r, "explanation"), cell(r, "difficulty"), cell(r, "topic"));
    if (isProblem(out)) problems.push(out); else questions.push(out);
  }
  return { questions, problems };
}

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas/newlines inside quotes. Semicolon files work too. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const Q_START = /^\s*(?:Q(?:uestion)?\s*)?(\d{1,4})\s*[.):-]\s*(.*)$/i;
const OPT = /^\s*\(?([A-Da-d])\s*[.):]\s*(.*)$/;
const ANS = /^\s*(?:Ans(?:wer)?|Correct(?:\s+(?:answer|option))?|Key|Answer\s+key)\s*[:\-–=]\s*(.+)$/i;
const EXP = /^\s*(?:Explanation|Reason|Solution|Rationale)\s*[:\-–=]\s*(.*)$/i;
const DIF = /^\s*(?:Difficulty|Level)\s*[:\-–=]\s*(.+)$/i;
const TOP = /^\s*(?:Topic|Concept)\s*[:\-–=]\s*(.+)$/i;

/** Puts each option, answer and question number on its own line, for text that came out of a PDF as one long line. */
export function splitInlineMarkers(text: string): string {
  return text.split("\n").map((line) => {
    let l = line;
    // Long lines are PDF pages: break before each question number.
    if (l.length > 300) l = l.replace(/\s+((?:Q(?:uestion)?\s*)?\d{1,4}\s*[.)]\s+)(?=[A-Z"'(؀-ۿ])/g, "\n$1");
    l = l.replace(/\s+((?:Ans(?:wer)?|Correct answer|Explanation|Difficulty|Topic)\s*[:\-–=])/gi, "\n$1");
    // Options on one line ("A) x  B) y  C) z  D) w"): only when A and B markers are both there, so "vitamin C. It" stays.
    return l.split("\n").map((part) =>
      /(^|\s)\(?[Aa]\s*[.)]\s/.test(part) && /\s\(?[Bb]\s*[.)]\s/.test(part) ? part.replace(/\s+(\(?[A-Da-d]\s*[.)]\s+)/g, "\n$1") : part,
    ).join("\n");
  }).join("\n");
}

/** Numbered questions in a Word, PDF or text document. */
export function parseQuestionText(raw: string): ImportParseResult {
  const lines = splitInlineMarkers(raw.replace(/\r/g, "")).split("\n");
  const questions: ImportedQuestion[] = [];
  const problems: ImportProblem[] = [];
  type Block = { n: string; stem: string; options: Record<string, string>; answer: string; explanation: string; difficulty: string; topic: string; last: string };
  let cur: Block | null = null;
  const flush = () => {
    if (!cur) return;
    const out = finish(`Question ${cur.n}`, cur.stem, cur.options, cur.answer, cur.explanation, cur.difficulty, cur.topic);
    if (isProblem(out)) problems.push(out); else questions.push(out);
    cur = null;
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    let m: RegExpMatchArray | null;
    // A new number only starts a question once the current one has its options (so "1." inside a stem is safe).
    if ((m = line.match(Q_START)) && (!cur || Object.keys(cur.options).length >= 4 || cur.answer || Number(m[1]) === Number(cur.n) + 1)) {
      flush();
      cur = { n: m[1], stem: m[2], options: {}, answer: "", explanation: "", difficulty: "", topic: "", last: "stem" };
      continue;
    }
    if (!cur) continue; // text before the first question (titles, instructions)
    if ((m = line.match(ANS))) { cur.answer = m[1]; cur.last = "answer"; continue; }
    if ((m = line.match(EXP))) { cur.explanation = m[1]; cur.last = "explanation"; continue; }
    if ((m = line.match(DIF))) { cur.difficulty = m[1]; cur.last = "difficulty"; continue; }
    if ((m = line.match(TOP))) { cur.topic = m[1]; cur.last = "topic"; continue; }
    if ((m = line.match(OPT)) && !cur.answer) {
      const L = m[1].toUpperCase();
      if (!cur.options[L]) { cur.options[L] = m[2]; cur.last = L; continue; }
    }
    // Continuation of whatever came last.
    if (cur.last === "stem") cur.stem += " " + line;
    else if (cur.last === "explanation") cur.explanation += " " + line;
    else if (LETTERS.includes(cur.last as typeof LETTERS[number])) cur.options[cur.last] += " " + line;
  }
  flush();
  if (!questions.length && !problems.length) {
    problems.push({ where: "File", message: "No numbered questions were found. Number each question (1., 2., ...) and put the options on lines starting A) B) C) D)." });
  }
  return { questions, problems };
}

/** Reads any supported file and parses it. Throws a message that's safe to show the teacher. */
export async function readQuestionFile(file: File): Promise<ImportParseResult> {
  const ext = extOf(file.name);
  let result: ImportParseResult;
  if (ext === "csv") {
    result = parseQuestionRows(parseCsv(await file.text()));
  } else if (ext === "xlsx" || ext === "xls") {
    const XLSX = await import("xlsx");
    let wb;
    try { wb = XLSX.read(await file.arrayBuffer(), { type: "array" }); }
    catch { throw new Error(`"${file.name}" couldn't be read. Please check it's a valid Excel file.`); }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    result = parseQuestionRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false }));
  } else if (ext === "docx" || ext === "pdf" || ext === "txt") {
    result = parseQuestionText((await readDocumentText(file)).text);
  } else {
    throw new Error(`"${file.name}" isn't supported. Please upload a CSV, Excel, Word (.docx), PDF or text file.`);
  }
  if (result.questions.length > IMPORT_MAX) {
    result.problems.push({ where: "File", message: `Only the first ${IMPORT_MAX} questions will be imported.` });
    result.questions = result.questions.slice(0, IMPORT_MAX);
  }
  return result;
}
