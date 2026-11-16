import { describe, expect, it } from "vitest";
import { answerLetter, parseCsv, parseQuestionRows, parseQuestionText, IMPORT_TEMPLATE_CSV, IMPORT_DOC_EXAMPLE } from "@/lib/questionImport";
import { integrityRisk } from "@/hooks/useExamIntegrity";

describe("bulk question import: spreadsheets", () => {
  it("reads the downloadable template", () => {
    const r = parseQuestionRows(parseCsv(IMPORT_TEMPLATE_CSV));
    expect(r.problems).toEqual([]);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]).toMatchObject({ stem: "What is 1/2 + 1/4?", correct: "C", difficulty: "easy", topic_hint: "Fractions" });
    expect(r.questions[0].options).toEqual({ A: "1/6", B: "2/6", C: "3/4", D: "1/8" });
  });

  it("accepts header aliases, answer as option text, and quoted commas", () => {
    const csv = 'Question,A,B,C,D,Correct Answer\n"Capital of France, the city?",Paris,Rome,Berlin,Madrid,Paris\n';
    const r = parseQuestionRows(parseCsv(csv));
    expect(r.questions[0]).toMatchObject({ stem: "Capital of France, the city?", correct: "A" });
  });

  it("reports rows that can't be imported, with the row number", () => {
    const csv = "question,option_a,option_b,option_c,option_d,answer\nQ1 text,a,b,c,d,E\nQ2 text,a,b,,d,A\nQ3 text,a,a,c,d,A\n";
    const r = parseQuestionRows(parseCsv(csv));
    expect(r.questions).toHaveLength(0);
    expect(r.problems.map((p) => p.where)).toEqual(["Row 2", "Row 3", "Row 4"]);
  });

  it("says which columns are missing", () => {
    const r = parseQuestionRows(parseCsv("question,answer\nx,A\n"));
    expect(r.problems[0].message).toMatch(/option_a/);
  });

  it("handles semicolon CSV and doubled quotes", () => {
    expect(parseCsv('a;b\n"say ""hi""";2\n')).toEqual([["a", "b"], ['say "hi"', "2"]]);
  });

  it("maps answer formats", () => {
    const o = { A: "x", B: "y", C: "z", D: "w" };
    expect(answerLetter("(b)", o)).toBe("B");
    expect(answerLetter("Option D", o)).toBe("D");
    expect(answerLetter("3", o)).toBe("C");
    expect(answerLetter("z", o)).toBe("C");
    expect(answerLetter("maybe", o)).toBeNull();
  });
});

describe("bulk question import: documents", () => {
  it("reads the documented example", () => {
    const r = parseQuestionText(IMPORT_DOC_EXAMPLE);
    expect(r.problems).toEqual([]);
    expect(r.questions[0]).toMatchObject({ correct: "C", explanation: "Make the denominators equal: 2/4 + 1/4 = 3/4." });
  });

  it("reads several questions with titles, inline options and multi-line stems", () => {
    const text = `Chapter 3 test
Answer all questions.

1. Which gas do plants take in
for photosynthesis?
a) Oxygen  b) Carbon dioxide  c) Nitrogen  d) Hydrogen
Ans: b

Q2. Which vitamin C. source is best?
A. Orange
B. Rice
C. Bread
D. Milk
Answer - A
Difficulty: easy`;
    const r = parseQuestionText(text);
    expect(r.problems).toEqual([]);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0]).toMatchObject({ stem: "Which gas do plants take in for photosynthesis?", correct: "B" });
    expect(r.questions[0].options.B).toBe("Carbon dioxide");
    expect(r.questions[1]).toMatchObject({ stem: "Which vitamin C. source is best?", correct: "A", difficulty: "easy" });
  });

  it("splits a PDF page that came out as one long line", () => {
    const one = Array.from({ length: 4 }, (_, i) => `${i + 1}. Question number ${i + 1} about plants and soil here? A) one B) two C) three D) four Answer: ${"ABCD"[i]}`).join(" ");
    const r = parseQuestionText(one);
    expect(r.questions.map((q) => q.correct)).toEqual(["A", "B", "C", "D"]);
  });

  it("reports a question without an answer, and a file with no questions", () => {
    expect(parseQuestionText("1. What is 2+2?\nA) 1\nB) 2\nC) 3\nD) 4").problems[0]).toMatchObject({ where: "Question 1", message: "The answer is missing" });
    expect(parseQuestionText("Just some notes about the chapter.").problems[0].where).toBe("File");
  });
});

describe("proctoring risk level", () => {
  it("weights leaving the tab and time away", () => {
    expect(integrityRisk({})).toBe("low");
    expect(integrityRisk({ right_click: 3 })).toBe("low");
    expect(integrityRisk({ tab_hidden: 2 })).toBe("medium");
    expect(integrityRisk({ tab_hidden: 3, away_seconds: 300 })).toBe("high");
    expect(integrityRisk({ copy_paste: 5 })).toBe("high");
  });
});
