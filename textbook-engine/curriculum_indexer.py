import re

UNIT_RE = re.compile(
    r"^(Unit|Semester|Term|Section|Module|Part|Block|Volume)\s*[\d\-:–IVXivx]+",
    re.IGNORECASE)
CHAPTER_RE = re.compile(
    r"^(Chapter|Lesson|Topic|Content|Exercise|Activity|Theme|Area|Week|Period)\s*[\d\-:–]+",
    re.IGNORECASE)
NUMBERED_RE = re.compile(r"^\d+[\.\-]\d+[\.\-]?\d*\s+\w+")

NOISE = [
    "let's", "lets", "observe", "try out", "activity",
    "learning outcomes", "daytime", "nighttime",
    "www.", "http", "copyright", "isbn", "all rights",
    "quiz", "buzz", "think sheet", "self check",
    "printed", "publisher", "edition", "glossary",
    "answer key", "worksheet", "exercise sheet",
    "fill in", "tick the", "match the", "circle the",
    "write the", "draw a", "colour the", "color the",
    "note:", "note :", "teacher", "parent", "guardian",
    "ourascinating", "eee", "inating", "true or false", "short answer",
    "long answer", "differentiate", "reflect on", "word zone"
]

def clean(line: str) -> str:
    line = re.sub(r'<[^>]+>', '', line)
    line = re.sub(r'\[.*?\]', '', line)
    line = re.sub(r'\(CG[^\)]*\)', '', line, flags=re.IGNORECASE)
    line = re.sub(r'\b(NS|GS|RS|CG|SF|TM)\b', '', line)
    line = re.sub(r'[\(\)\[\]\{\}]', '', line)
    line = re.sub(r'\s+', ' ', line)
    line = re.sub(r'[^\w\s\-\!\?\,\.\:\;\/]', '', line)
    return line.strip()

def is_noise(line: str) -> bool:
    low = line.lower()
    if re.match(r'^\d+$', line):
        return True
    if len(line) < 4:
        return True
    if any(w in low for w in NOISE):
        return True
    if re.match(r'^[A-Z]{1,3}[\-\;]\s*[A-Z0-9\.\-\;\s]+$', line):
        return True
    if line.endswith('.') and len(line) > 40:
        return True
    return False

def is_heading(line: str) -> bool:
    if len(line) < 4 or len(line) > 45:
        return False
    if not line[0].isupper():
        return False
    if line.endswith('.'):
        return False
        
    words = line.split()
    if len(words) < 1 or len(words) > 6:
        return False

    sentence_indicators = ["is", "was", "were", "are", "have", "has", "had", "we", "they", "who", "it", "started", "proved", "taken"]
    if any(w.lower() in sentence_indicators for w in words):
        return False

    lowercase_count = 0
    prepositions = ["and", "or", "of", "in", "on", "at", "to", "a", "an", "the", "with", "from", "by"]
    for w in words[1:]:
        if w.islower() and w.lower() not in prepositions:
            lowercase_count += 1
    if lowercase_count > 1:
        return False

    return True

def build_curriculum_index(pages: list) -> list:
    index = []
    current_unit    = "Unit 1"
    current_chapter = "Chapter 1"
    current_topic   = None

    all_text = ""
    for p in pages:
        all_text += f"\n--- PAGE {p['page_number']} ---\n" + p["text"]

    all_structural = (
        r"(Chapter|Lesson|Topic|Content|Exercise|Activity|Theme|"
        r"Unit|Semester|Term|Section|Module|Part|Block|Volume|"
        r"Area|Week|Day|Period)"
    )
    all_text = re.sub(
        rf'{all_structural}\s*\n\s*(\d+)',
        r'\1 \2', all_text, flags=re.IGNORECASE
    )

    current_page = 1
    lines = all_text.split("\n")

    for i, raw_line in enumerate(lines):
        page_match = re.match(r"^--- PAGE (\d+) ---$", raw_line.strip())
        if page_match:
            current_page = int(page_match.group(1))
            continue

        line = clean(raw_line)
        if not line or is_noise(line):
            continue

        # Unit level
        if UNIT_RE.match(line):
            title = ""
            for j in range(i+1, min(i+4, len(lines))):
                c = clean(lines[j])
                if c and len(c) > 2 and not re.match(r"^\d+$", c):
                    if not CHAPTER_RE.match(c) and not UNIT_RE.match(c):
                        title = c
                    break
            current_unit = f"{line} - {title}" if title else line
            continue

        # Chapter level
        if CHAPTER_RE.match(line):
            title = ""
            for j in range(i+1, min(i+4, len(lines))):
                c = clean(lines[j])
                if c and len(c) > 2 and not re.match(r"^\d+$", c):
                    if not CHAPTER_RE.match(c) and not UNIT_RE.match(c) and len(c) < 80:
                        title = c
                    break
            current_chapter = f"{line} - {title}" if title else line
            current_topic = None
            continue

        # Numbered topic
        if NUMBERED_RE.match(line):
            current_topic = line
            if index:
                index[-1]["end_page"] = max(index[-1]["start_page"], current_page - 1)
            index.append({
                "unit_name":    current_unit,
                "chapter_name": current_chapter,
                "topic_name":   current_topic,
                "start_page":   current_page,
                "end_page":     current_page
            })
            continue

        # Short heading as topic
        if is_heading(line) and not CHAPTER_RE.match(line) and not UNIT_RE.match(line):
            if index and index[-1]["topic_name"] == line:
                continue
            current_topic = line
            if index:
                index[-1]["end_page"] = max(index[-1]["start_page"], current_page - 1)
            index.append({
                "unit_name":    current_unit,
                "chapter_name": current_chapter,
                "topic_name":   current_topic,
                "start_page":   current_page,
                "end_page":     current_page
            })

    if index and pages:
        index[-1]["end_page"] = pages[-1]["page_number"]

    if not index:
        index.append({
            "unit_name":    current_unit,
            "chapter_name": current_chapter,
            "topic_name":   "General Content",
            "start_page":   1,
            "end_page":     pages[-1]["page_number"] if pages else 1
        })

    return index