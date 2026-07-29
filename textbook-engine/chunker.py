import re
from embeddings import generate_embedding
from database import save_chunk


# ─────────────────────────────────────────
# CONTENT TYPE DETECTION KEYWORDS
# ─────────────────────────────────────────

CONTENT_TYPE_PATTERNS = {
    "WORKSHEET": [
        "worksheet", "fill in the blanks", "fill in the blank",
        "match the following", "true or false", "tick the correct",
        "circle the correct", "write the answer", "answer the following",
        "complete the sentence", "complete the following"
    ],
    "EXERCISE": [
        "exercise", "practice", "solve the following",
        "find the value", "calculate", "simplify",
        "prove that", "show that", "evaluate"
    ],
    "EXAMPLE": [
        "example", "for example", "eg.", "e.g.",
        "illustration", "sample", "solved example",
        "let us understand", "consider the following"
    ],
    "ASSESSMENT": [
        "assessment", "test yourself", "check your understanding",
        "quiz", "review questions", "hots", "higher order",
        "think and answer", "multiple choice", "mcq",
        "short answer", "long answer", "marks"
    ],
    "LESSON_CONCEPT": [
        "introduction", "definition", "concept", "meaning",
        "explanation", "understand", "learn", "objective",
        "key points", "summary", "conclusion", "note:"
    ]
}


# ─────────────────────────────────────────
# DETECT CONTENT TYPE FROM TEXT
# ─────────────────────────────────────────

def detect_content_type(text: str) -> str:
    """
    Detects what type of content a chunk is.
    Returns: LESSON_CONCEPT, WORKSHEET, EXERCISE,
             EXAMPLE, ASSESSMENT, or UNKNOWN
    """
    text_lower = text.lower()

    scores = {
        content_type: 0
        for content_type in CONTENT_TYPE_PATTERNS
    }

    for content_type, keywords in CONTENT_TYPE_PATTERNS.items():
        for keyword in keywords:
            if keyword in text_lower:
                scores[content_type] += 1

    # Get the highest scoring content type
    best_type = max(scores, key=scores.get)

    # If no keywords matched at all → mark as LESSON_CONCEPT
    # (default assumption for plain text)
    if scores[best_type] == 0:
        return "LESSON_CONCEPT"

    return best_type


# ─────────────────────────────────────────
# SMART SPLIT BY CONTENT SECTIONS
# ─────────────────────────────────────────

def split_by_sections(text: str) -> list:
    """
    Splits text into sections based on 
    content type boundaries.
    Each section = { text, content_type }
    """
    # Split on common section heading patterns
    section_pattern = re.compile(
        r'(?i)(\n(?:'
        r'worksheet|exercise|example|assessment|'
        r'introduction|definition|activity|'
        r'summary|review|quiz|test yourself|'
        r'solved example|practice'
        r')[^\n]*\n)',
        re.MULTILINE
    )

    parts = section_pattern.split(text)

    sections = []
    current_text = ""

    for part in parts:
        if section_pattern.match(part):
            # Save previous section
            if current_text.strip():
                sections.append({
                    "text": current_text.strip(),
                    "content_type": detect_content_type(
                        current_text
                    )
                })
            current_text = part
        else:
            current_text += part

    # Save last section
    if current_text.strip():
        sections.append({
            "text": current_text.strip(),
            "content_type": detect_content_type(
                current_text
            )
        })

    # If no sections found → treat whole text
    # as one LESSON_CONCEPT block
    if not sections:
        sections.append({
            "text": text.strip(),
            "content_type": "LESSON_CONCEPT"
        })

    return sections


# ─────────────────────────────────────────
# CHUNK A SINGLE SECTION INTO 500-WORD PIECES
# ─────────────────────────────────────────

def chunk_section(
    section_text: str,
    chunk_size: int = 500,
    overlap: int = 100
) -> list:
    """
    Splits a single section into smaller
    chunks of chunk_size words with overlap.
    """
    words = section_text.split()
    chunks = []
    start = 0

    while start < len(words):
        end = start + chunk_size
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        start += (chunk_size - overlap)

    return chunks


# ─────────────────────────────────────────
# MAIN FUNCTION
# ─────────────────────────────────────────

def create_chunks(
    book_id,
    unit_id,
    chapter_id,
    topic_id,
    subtopic_id,
    page_number,
    topic_text
):
    """
    Smart chunker:
    1. Splits text into typed sections
    2. Chunks each section separately
    3. Tags every chunk with content_type
    4. Saves to DB with content_type column
    """

    # Step 1 — Split into typed sections
    sections = split_by_sections(topic_text)

    all_chunks = []

    for section in sections:

        content_type = section["content_type"]
        section_text = section["text"]

        # Step 2 — Chunk each section
        raw_chunks = chunk_section(section_text)

        for chunk in raw_chunks:

            # Step 3 — Generate embedding
            embedding = generate_embedding(chunk)

            # Step 4 — Save with content_type
            save_chunk(
                book_id,
                unit_id,
                chapter_id,
                topic_id,
                subtopic_id,
                page_number,
                chunk,
                embedding.tolist(),
                content_type       # ← NEW: passing content type
            )

            all_chunks.append({
                "chunk": chunk,
                "content_type": content_type
            })

    return all_chunks