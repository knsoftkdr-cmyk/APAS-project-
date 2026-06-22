const fs = require("fs");
const file = "./src/pages/Curative.tsx";
let c = fs.readFileSync(file, "utf8");

// Replace VARK_INSTRUCTIONS block using regex (handles CRLF/LF differences)
c = c.replace(
  /const VARK_INSTRUCTIONS: Record<string, string> = \{[\s\S]*?const varkInstruction = varkType && varkType !== "general"[\s\S]*?: VARK_INSTRUCTIONS\["general"\];/,
  `const VARK_INSTRUCTIONS: Record<string, string> = {
    visual: \`Design ALL 12-15 activities specifically for VISUAL learners studying "\${topic || chapter || subject}".
VISUAL ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Draw and label: Student draws the concept by hand and writes labels. Example instruction: "Draw a circle in the box below and write its name."
- Colour coding: List shapes/items as words. Student colours or circles each. Example: "Circle all triangles in blue."
- Pattern completion using symbols: Use O [] /\\ as shape symbols. Example: O -- [] -- O -- [] -- ___
- Match with lines (text only): Write Column A and Column B as numbered/lettered text lists. Student draws lines.
- Sort into table: Give a word list, student writes items into a 2-3 column table drawn with | characters.
- Number line fill: 1---2---3---[___]---5  Student fills the blank.
- Spot the difference: Describe two similar things in words, student writes what differs.
STRICT RULE: NEVER write [Image: ...] or (Image of ...). Use text, symbols O [] /\\, or "(Draw your answer in the box below)".\`,

    auditory: \`Design ALL 12-15 activities specifically for AUDITORY learners studying "\${topic || chapter || subject}".
AUDITORY ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Say and write: "Say this aloud three times, then write the next item: 10, 20, 30, ___"
- Rhyme completion: Give a rhyme with blanks. Example: "Five, ten, ___, twenty - counting by fives is plenty!"
- Read aloud and answer: A short 3-4 sentence passage the student reads, then 3 questions below it.
- Echo pattern: "Continue the pattern you hear in your head: 100, 99, 98, ___, ___, ___"
- Circle the direction: "100, 99, 98, 97 - is this counting (Forward / Backward)?" Student circles one.
- Story with spoken numbers: Short story like "A bird sat on branch 125. It flew forward twice." Student writes the answer.
- Partner dictation: "Your partner says a number. Write the number that comes before it: ___"
STRICT RULE: NEVER write [Image: ...]. All activities must work as written text a student can read aloud.\`,

    readwrite: \`Design ALL 12-15 activities specifically for READ/WRITE learners studying "\${topic || chapter || subject}".
READ/WRITE ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Definition match: Terms on left (A,B,C), definitions on right (1,2,3). Student writes matching pairs.
- Fill in the blank: Complete sentences using a word bank. Example: "A ___ has 3 sides." Word bank: [circle, triangle, square]
- Rewrite in own words: Give a rule or definition, student rewrites it simply.
- Jumbled facts: Give 4-5 facts out of order, student numbers them correctly.
- True or False with reason: Statement, student writes T/F and one sentence explaining why.
- Short answer: "Write 2 sentences explaining what forward counting means."
- Vocabulary table: | Word | Meaning | My sentence | - student fills all 3 columns.
- Compare table: Two columns (e.g. Forward Counting vs Backward Counting), student fills facts for each.
STRICT RULE: NEVER write [Image: ...]. All tasks must be purely text-based reading and writing.\`,

    kinesthetic: \`Design ALL 12-15 activities specifically for KINESTHETIC learners studying "\${topic || chapter || subject}".
KINESTHETIC ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Cut and sort (written): Give a box of mixed words/numbers. Draw two columns below. Student writes each item in correct column.
- Trace and write: "Trace this shape with your finger: a square has 4 equal sides. Now draw it yourself in the box below."
- Act it out and record: "Start at 10. Hop forward 3 times. Write where you land: ___. Now hop back 2. Write it: ___"
- Build with symbols: "Use O for circles and [] for squares. Extend this pattern 4 more: O [] O [] ___ ___ ___ ___"
- Real-life scenario: "You have 15 apples. You give 4 to a friend. How many are left? Show your working: ___"
- Step-by-step activity: Numbered steps where each answer feeds the next. Student works through all steps in order.
- Paper game board: A simple 10-box path: [1]---[2]---[3]---[___]---[5]. Student fills answers to advance.
STRICT RULE: NEVER write [Image: ...]. All hands-on elements must use text instructions, symbols, or ASCII.\`,

    general: \`Design 12-15 activities covering ALL FOUR VARK learning styles for "\${topic || chapter || subject}".
Label each section clearly. NEVER write [Image: ...] anywhere.

=== VISUAL (Activities 1-3) ===
Use: draw-and-label (text instructions only), symbol pattern completion (O [] /\\), text-based matching tables, or colour-coding tasks written as text.

=== AUDITORY (Activities 4-6) ===
Use: say-and-write sequences, rhyme completion with blanks, echo patterns, or read-aloud-and-answer passages.

=== READ/WRITE (Activities 7-9) ===
Use: definition matching (text columns), fill-in-blank with word bank, true/false with reason, or vocabulary/compare tables.

=== KINESTHETIC (Activities 10-12) ===
Use: cut-and-sort (written version), act-it-out-and-record, real-life scenario, or paper game board path.

Each section must have exactly 3 activities. All 12 activities must be strictly about "\${topic || chapter || subject}".\`,
  };
  const varkInstruction = varkType && varkType !== "general"
    ? VARK_INSTRUCTIONS[varkType] ?? ""
    : VARK_INSTRUCTIONS["general"];`
);

if (!c.includes("VISUAL ACTIVITY TYPES")) {
  console.log("FAILED: VARK block regex did not match");
  process.exit(1);
}
console.log("VARK block: OK");

// Replace the return prompt block using regex
c = c.replace(
  /return `Generate ONLY a student practice worksheet[\s\S]*?Stop immediately after the COMPLETE ANSWER KEY\.`/,
  `return \`Generate ONLY a student practice worksheet for \${classLabel} Section \${section}.

TOPIC LOCK: EVERY activity MUST be about "\${topic || chapter || subject}" only. Never switch topics mid-worksheet.

SUBJECT: \${subject}\${chapter ? \` | CHAPTER: \${chapter}\` : ""}\${topic ? \` | TOPIC: \${topic}\` : ""}\${subtopic ? \` | SUBTOPIC: \${subtopic}\` : ""}

\${varkInstruction}

At the very top write:
[Worksheet title about \${topic || chapter || subject}]
Name: ___________________________ Date: ___________________________

Then generate 12-15 activities. Separate each with ---. No page numbers or page headings.

\${pageStructure}

RULES FOR EVERY ACTIVITY:
- Creative topic-specific title
- Clear 1-2 sentence instructions
- 1 worked example with the answer shown
- 4-8 questions with blanks written as ___ (underscores only, never backslashes)
- NEVER write [Image: ...] or (Image of ...) — use text, symbols O [] /\\, or "(Draw your answer in the box below)"
- Matching tasks: write both sides as text lists, student draws connecting lines
- All content strictly about "\${topic || chapter || subject}" for \${classLabel} students
- No individual student names

After all activities write "COMPLETE ANSWER KEY" with answers for every question.

CRITICAL: Output ONLY worksheet content. No lesson plan, no objectives, no VARK analysis, no BBL checklist. Stop after COMPLETE ANSWER KEY.\``
);

if (!c.includes("TOPIC LOCK")) {
  console.log("FAILED: return block regex did not match");
  process.exit(1);
}
console.log("Return block: OK");

fs.writeFileSync(file, c, "utf8");
console.log("SUCCESS: Both blocks rewritten");
