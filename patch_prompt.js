const fs = require("fs");
const file = "./src/pages/Curative.tsx";
let c = fs.readFileSync(file, "utf8");

const oldVARK = `  const VARK_INSTRUCTIONS: Record<string, string> = {
    visual:      "Design ALL activities for VISUAL learners: use number lines, diagrams, colour-coding, visual matching, and pictorial patterns.",
    auditory:    "Design ALL activities for AUDITORY learners: include rhymes, rhythmic counting, partner-discussion tasks, listen-and-write, and dictation.",
    readwrite:   "Design ALL activities for READ/WRITE learners: use definitions, fill-in-the-blank, written sequences, lists, and short-answer questions.",
    kinesthetic: "Design ALL activities for KINESTHETIC learners: include cut-and-sort, trace-and-act, object counting, hands-on games, and real-life scenarios.",
    general:     "Include one activity per VARK type (Visual, Auditory, Read/Write, Kinesthetic) — clearly label each one with its learning style.",
  };
  const varkInstruction = varkType && varkType !== "general"
    ? VARK_INSTRUCTIONS[varkType] ?? ""
    : VARK_INSTRUCTIONS["general"];`;

const newVARK = `  const VARK_INSTRUCTIONS: Record<string, string> = {
    visual: \`Design ALL 12-15 activities specifically for VISUAL learners studying "\${topic || chapter || subject}".
VISUAL ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Draw and label: Student draws the concept using their own hand and writes labels next to it. Instruction example: "Draw a circle in the box below and write its name."
- Colour coding: "Circle all triangles in blue. Circle all squares in red." — list the shapes as words, student acts on them.
- Pattern completion using symbols: Use O, [], /\\, — as shape symbols. Example: O — [] — O — [] — ___
- Match with lines (text only): List Column A and Column B as numbered/lettered text. Student draws lines between them.
- Sort into table: Provide a word/symbol list, student writes items into a 2-3 column table you draw with | characters.
- Number line fill: Draw using dashes: 1---2---3---[___]---5  Student fills the blank.
- Spot the difference: Describe two similar things in words, student writes what is different.
STRICT RULE: NEVER write [Image: ...] or (Image of ...). Use text, symbols O [] /\\, or "(Draw here)" boxes.\`,

    auditory: \`Design ALL 12-15 activities specifically for AUDITORY learners studying "\${topic || chapter || subject}".
AUDITORY ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Say and write: "Say this aloud three times, then write the next item: 10, 20, 30, ___"
- Rhyme completion: Give a rhyme with blanks. Example: "Five, ten, ___, twenty — counting by fives is plenty!"
- Read aloud and answer: A short 3-4 sentence passage the student reads, then 3 questions below it.
- Echo pattern: "Continue the pattern you hear in your head: 100, 99, 98, ___, ___, ___"
- Circle the direction: "100, 99, 98, 97 — is this counting (Forward / Backward)?" Student circles one.
- Story with spoken numbers: Short story like "A bird sat on branch 125. It flew forward twice." Student writes the answer.
- Partner dictation: "Your partner says a number. Write the number that comes before it: ___"
STRICT RULE: NEVER write [Image: ...]. All activities must work as written text that a student can read aloud.\`,

    readwrite: \`Design ALL 12-15 activities specifically for READ/WRITE learners studying "\${topic || chapter || subject}".
READ/WRITE ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Definition match: Two text columns — terms on left (A,B,C...), definitions on right (1,2,3...). Student writes matching letter-number pairs.
- Fill in the blank: Complete sentences using a word bank. Example: "A ___ has 3 sides and 3 corners." Word bank: [circle, triangle, square]
- Rewrite in own words: Give a rule or definition, student rewrites it in simpler language.
- Jumbled facts: Give 4-5 facts out of order, student numbers them correctly.
- True or False with reason: Statement, student writes T/F + one sentence why.
- Short answer: "Write 2 sentences explaining what forward counting means."
- Vocabulary table: | Word | Meaning | My sentence | — student fills all 3 columns.
- Compare table: Two columns (e.g. "Forward Counting | Backward Counting"), student fills in facts for each.
STRICT RULE: NEVER write [Image: ...]. All tasks must be purely text-based reading and writing.\`,

    kinesthetic: \`Design ALL 12-15 activities specifically for KINESTHETIC learners studying "\${topic || chapter || subject}".
KINESTHETIC ACTIVITY TYPES (rotate through these, never use [Image:] placeholders):
- Cut and sort (written): Print a box of mixed words/numbers. Below it draw two columns. Student writes each item in the correct column.
- Trace and write: "Trace this shape outline with your finger, then draw it yourself in the box: [ square outline described as 4 equal sides ]"
- Act it out and record: "Start at 10. Hop forward 3 times. Write where you land: ___. Now hop back 2. Write it: ___"
- Build with symbols: "Use O for circles and [] for squares. Build this pattern: O [] O [] and extend it 4 more: ___ ___ ___ ___"
- Real-life scenario: "You have 15 apples. You give 4 to a friend. How many are left? Show your working: ___"
- Step-by-step activity: Numbered steps where each step's answer feeds the next. Student works through all steps.
- Paper game board: Draw a simple 10-box path with --- between boxes. Student fills in answers to advance.
STRICT RULE: NEVER write [Image: ...]. All hands-on elements must use text instructions, symbols, or ASCII diagrams.\`,

    general: \`Design 12-15 activities covering ALL FOUR VARK learning styles for "\${topic || chapter || subject}".
Label each section clearly. NEVER write [Image: ...] anywhere.

=== VISUAL (Activities 1-3) ===
Use: draw-and-label with text instructions, symbol pattern completion (O [] /\\), text-based matching tables, or colour-coding tasks written as text instructions.

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
    : VARK_INSTRUCTIONS["general"];`;

c = c.replace(oldVARK, newVARK);

// Fix the return prompt
const oldReturn = `return \`Generate ONLY a student practice worksheet for \${classLabel} Section \${section}.

SUBJECT: \${subject}\${chapter ? \` | CHAPTER: \${chapter}\` : ""}\${topic ? \` | TOPIC: \${topic}\` : ""}\${subtopic ? \` | SUBTOPIC: \${subtopic}\` : ""}

LEARNING STYLE TARGET: \${varkInstruction}

At the very top, write a title for the worksheet and a "Name: ___ Date: ___" line.

Then generate 12-15 activities directly about "\${topic || chapter || subject}", one after another. Do NOT use page numbers or page headings. Separate each activity with a horizontal line (---).

\${pageStructure}

RULES FOR EVERY ACTIVITY:
- Give each activity a creative, topic-specific title (e.g. "Subtraction Zero Hero!", "Shape Sorter", "Water Cycle Fill-In")
- Write clear instructions in 1-2 sentences
- Give 1 worked example
- Then 4-8 questions in that activity's format
- Use varied formats across the 5 pages: fill-in-the-blank, matching, true/false, multiple choice, short answer, sort/classify, draw-and-label, story problems
- All content must be about "\${topic || chapter || subject}" only — appropriate for \${classLabel} students
- Do NOT mention individual student names

After all 5 pages, write a "COMPLETE ANSWER KEY" section with answers for every activity on every page.

CRITICAL: Output ONLY the worksheet content. Do NOT generate a lesson plan, learning objectives, hook activities, VARK analysis, BBL checklist, Word Decoder, or any lesson plan sections. Stop immediately after the COMPLETE ANSWER KEY.\``;

const newReturn = `return \`Generate ONLY a student practice worksheet for \${classLabel} Section \${section}.

TOPIC LOCK: EVERY activity MUST be about "\${topic || chapter || subject}" only. Never switch topics. Never drift to a different chapter or concept.

SUBJECT: \${subject}\${chapter ? \` | CHAPTER: \${chapter}\` : ""}\${topic ? \` | TOPIC: \${topic}\` : ""}\${subtopic ? \` | SUBTOPIC: \${subtopic}\` : ""}

\${varkInstruction}

At the very top write:
Title: [creative title about \${topic || chapter || subject}]
Name: ___________________________ Date: ___________________________

Then generate 12-15 activities. Separate each with ---. No page numbers or page headings.

\${pageStructure}

RULES FOR EVERY ACTIVITY:
- Creative topic-specific title for each activity
- Clear 1-2 sentence instructions
- 1 worked example with the answer shown
- 4-8 questions with blanks written as ___ (underscores only — never use backslashes like \\_ or \\\\)
- NEVER write [Image: ...] or (Image of ...) — use text, symbols, or "(Draw your answer in the box below)"
- Matching tasks: write both sides as text lists (A/B/C and 1/2/3), student draws lines
- All content strictly about "\${topic || chapter || subject}" for \${classLabel} students
- No individual student names

After all activities write "COMPLETE ANSWER KEY" with answers for every question.

CRITICAL: Output ONLY worksheet content. No lesson plan, no objectives, no VARK analysis, no BBL checklist. Stop after COMPLETE ANSWER KEY.\``;

c = c.replace(oldReturn, newReturn);

if (c.includes("TOPIC LOCK")) {
  fs.writeFileSync(file, c, "utf8");
  console.log("SUCCESS: Prompt rewritten");
} else {
  console.log("FAILED: old string not found — check for whitespace differences");
}
