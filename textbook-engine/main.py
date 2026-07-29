from dotenv import load_dotenv
import os
import re
import pdfplumber
import io
import pytesseract
import json
import time
import traceback
import random
from google import genai
from PIL import Image
from pdf2image import convert_from_bytes
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from database import (
    supabase,
    save_curriculum,
    save_curriculum_index,
    save_chunk,
    get_id_by_name,
    get_or_create_saas_defaults,
    save_saas_lesson_plan,
    get_lesson_concept_chunks,
    get_chunks_by_type
)
from curriculum_detector import detect_curriculum_structure
from curriculum_indexer import build_curriculum_index
from chunker import detect_content_type

import shutil
TESSERACT_CMD = os.getenv("TESSERACT_CMD") or shutil.which("tesseract")
if TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
else:
    print("[!] WARNING: tesseract binary not found on PATH and TESSERACT_CMD not set")

POPPLER_PATH = os.getenv("POPPLER_PATH")  # None on Mac/Linux is fine; pdf2image finds poppler on PATH automatically

base_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(base_dir, ".env")
load_dotenv(dotenv_path=env_path, override=True)

GEMINI_API_KEYS = [
    k for k in [
        os.getenv("GEMINI_API_KEY_1"),
        os.getenv("GEMINI_API_KEY_2"),
        os.getenv("GEMINI_API_KEY"),
    ] if k
]

if not GEMINI_API_KEYS:
    print("[!] WARNING: No GEMINI_API_KEY found in .env file!")
    client = None
else:
    client = genai.Client(api_key=GEMINI_API_KEYS[0])
    print(f"[+] Gemini client initialized with {len(GEMINI_API_KEYS)} API key(s)")

app = FastAPI(title="APAS Multi-Tenant Curriculum Processor Engine", version="6.6")

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8080").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SaaSGenerateLessonPlanRequest(BaseModel):
    class_name:    str
    subject:       str
    chapter_name:  str
    topic_name:    str
    academic_year: str = "2026-27"

def extract_book_metadata(fname: str) -> dict:
    fname_lower = fname.lower()
    subject = "General"
    for s in ["science", "maths", "math", "english", "hindi", "social", "evs", "computer", "geography", "history", "physics", "chemistry", "biology", "telugu"]:
        if s in fname_lower:
            subject = s.title()
            break
    class_name = None
    match = re.search(r'class\s*(\d+)', fname_lower)
    if match:
        class_name = f"Class {match.group(1)}"
    curriculum = "CBSE"
    for c in ["cbse", "icse", "igcse", "state", "ncert"]:
        if c in fname_lower:
            curriculum = c.upper()
            break
    return {"subject": subject, "class_name": class_name, "curriculum": curriculum}

# Unicode block ranges for Indic scripts we care about.
# If a page's text contains NONE of these characters for a book we know is
# in one of these languages, the "text" pdfplumber pulled out is not real
# script text - it's raw codepoints from a legacy (non-Unicode) font and
# must be discarded in favor of OCR.
SCRIPT_UNICODE_RANGES = {
    "telugu": (0x0C00, 0x0C7F),
    "hindi":  (0x0900, 0x097F),  # Devanagari
}

def is_text_garbled(text: str, script: Optional[str] = None) -> bool:
    """Detects if the text contains font corruption symbols common in legacy PDFs."""
    if not text.strip():
        return False

    # Strongest signal: if we know the book's language/script and the text
    # contains zero characters from that script's Unicode block, it's a
    # legacy-font PDF whose "text layer" doesn't actually contain real
    # Unicode text in that script. This catches cases where the corrupted
    # output looks like plain ASCII/symbols rather than accented Latin
    # (which the old narrow regex below would miss entirely).
    if script and script in SCRIPT_UNICODE_RANGES:
        lo, hi = SCRIPT_UNICODE_RANGES[script]
        has_script_chars = any(lo <= ord(ch) <= hi for ch in text)
        if not has_script_chars:
            return True

    # Fallback heuristic: count placeholder/corruption symbols common in
    # legacy font remaps. Broadened beyond the old \u0080-\u00ff band to
    # also catch plain-ASCII symbol noise, which is what legacy-font
    # garbage often actually looks like.
    corruption_markers = len(re.findall(r'[\u0080-\u00ffÂÃÛþýîíìëêéèäãā@#$%^&*_+<>=~`|\\]', text))
    word_count = max(len(text.split()), 1)
    if corruption_markers > word_count * 0.3:
        return True
    return False

def preprocess_image_for_ocr(image: Image.Image) -> Image.Image:
    """
    Cleans a page image before OCR to reduce misreads from decorative
    borders, background watermarks, and illustrations - common sources of
    hallucinated text on textbook chapter-opener / illustrated pages.
    """
    gray = image.convert("L")
    # Simple binarization: push faint background art/watermarks to white,
    # keep dark ink as black. Threshold is conservative to avoid losing
    # thin Indic glyph strokes/matras.
    threshold = 150
    bw = gray.point(lambda p: 255 if p > threshold else 0)
    return bw

def ocr_page_with_confidence_filter(image: Image.Image, lang: str, min_confidence: int = 40) -> str:
    """
    Runs OCR and discards low-confidence words. Tesseract returns a
    confidence score (0-100, or -1 for non-text regions) per recognized
    word via image_to_data. Words below min_confidence are usually noise
    from illustrations, borders, or image artifacts rather than real text,
    so dropping them prevents storing hallucinated garbage in the DB.
    """
    cleaned_image = preprocess_image_for_ocr(image)
    try:
        data = pytesseract.image_to_data(cleaned_image, lang=lang, output_type=pytesseract.Output.DICT)
    except Exception as e:
        print(f"[!] OCR confidence-data extraction failed ({e}); falling back to plain OCR.")
        return pytesseract.image_to_string(cleaned_image, lang=lang)

    words = data.get("text", [])
    confs = data.get("conf", [])
    line_nums = data.get("line_num", [])
    block_nums = data.get("block_num", [])

    kept_lines = {}
    for word, conf, line_no, block_no in zip(words, confs, line_nums, block_nums):
        word = word.strip()
        if not word:
            continue
        try:
            conf_val = int(float(conf))
        except (ValueError, TypeError):
            conf_val = -1
        if conf_val < min_confidence:
            continue
        key = (block_no, line_no)
        kept_lines.setdefault(key, []).append(word)

    lines_in_order = [" ".join(kept_lines[k]) for k in sorted(kept_lines.keys())]
    return "\n".join(lines_in_order)

def extract_pages_from_pdf(file_bytes: bytes, file_name: str = "") -> list:
    fname_lower = file_name.lower()
    script = None
    if "telugu" in fname_lower:
        script = "telugu"
    elif "hindi" in fname_lower:
        script = "hindi"

    # For known regional-language books, skip the pdfplumber-first attempt
    # entirely. Legacy-font Telugu/Hindi PDFs frequently "extract cleanly"
    # by pdfplumber's own metrics (non-empty, no obvious corruption symbols)
    # while actually containing garbage codepoints - so we can't trust the
    # text-layer detector here and must go straight to OCR.
    if script:
        print(f"[*] Detected '{script}' book from filename - forcing OCR pass (skipping unreliable text layer).")
        # Higher DPI than before (300 vs 200) - sharper glyph edges reduce
        # misreads on dense Indic scripts.
        images = convert_from_bytes(file_bytes, dpi=300, poppler_path=POPPLER_PATH)
        pages = []
        for i, image in enumerate(images):
            # Single-language OCR (no '+eng') - since these books are
            # purely Telugu/Hindi, adding English to the language set was
            # causing Tesseract to occasionally misread native glyphs as
            # stray Latin letters. Numbers/punctuation still recognize fine
            # without the English model loaded.
            lang = 'tel' if script == "telugu" else 'hin'
            text = ocr_page_with_confidence_filter(image, lang)
            pages.append({"page_number": i + 1, "text": text.strip()})
        print(f"[+] OCR extraction pass completed for {len(pages)} pages.")
        return pages

    pages = []
    # 1. Try structural PDF text extraction first
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            pages.append({"page_number": i + 1, "text": text.strip(), "is_empty": len(text.strip()) < 10})

    # Check if extracted text elements show severe encoding corruption
    sample_text = "\n".join([p["text"] for p in pages[:4]])
    if sum(1 for p in pages if p["is_empty"]) <= len(pages) * 0.5 and not is_text_garbled(sample_text, script):
        for p in pages: p.pop("is_empty", None)
        print("[+] PDF text parsed cleanly via structural font vectors.")
        return pages

    # 2. OCR Fallback for language books with legacy font encodings (Telugu/Hindi)
    print("[!] Text is missing or garbled due to legacy font mapping. Initializing OCR parser...")
    images = convert_from_bytes(file_bytes, dpi=300, poppler_path=POPPLER_PATH)
    pages = []
    for i, image in enumerate(images):
        # Use appropriate script packs for OCR text detection matching
        text = ocr_page_with_confidence_filter(image, 'hin+tel+eng')
        pages.append({"page_number": i + 1, "text": text.strip()})
    print(f"[+] OCR extraction pass completed for {len(pages)} pages.")
    return pages

def extract_chapter_title(pages: list) -> str:
    noise_keywords = ["chapter", "lesson", "unit", "learning outcomes", "observe", "let's", "lets", "http", "www", "activity", "class", "find out", "teacher", "parent", "isbn", "free distribution", "government of"]
    
    for page in pages[:3]:
        lines = page["text"].split("\n")
        for i, line in enumerate(lines):
            line_strip = line.strip()
            
            if line_strip.lower() in ["chapter", "lesson", "unit", "prose", "poem"] or re.match(r'^\d+$', line_strip):
                continue
                
            if re.search(r'\b(chapter|lesson|unit|prose|poem)\b\s*[\-\s\dIVX]+$', line_strip, re.IGNORECASE):
                for next_idx in range(i + 1, min(i + 4, len(lines))):
                    next_line = lines[next_idx].strip()
                    if next_line and len(next_line) > 2 and not any(k in next_line.lower() for k in noise_keywords):
                        return " ".join(re.sub(r'[\(\)\[\]\{\}\)]', '', next_line).split()).title()
            
            state_title_match = re.search(r'^(?:chapter|lesson|unit)?\s*[\d\.\-IVX]*\s*([A-Z][A-Za-z\s\,\'\!\-]{3,40})$', line_strip)
            if state_title_match:
                candidate = state_title_match.group(1).strip()
                if not any(k in candidate.lower() for k in noise_keywords) and len(candidate) > 3:
                    return candidate.title()
                    
    return None

def split_text_into_chunks(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    words = text.split()
    if len(words) <= chunk_size: return [" ".join(words)] if words else []
    return [" ".join(words[i:i + chunk_size]) for i in range(0, len(words), chunk_size - overlap) if words[i:i + chunk_size]]

def save_textbook_content(book_name: str, chapter_name: str, page_number: int, text: str):
    supabase.table("textbook_content").insert({"book_name": book_name, "chapter_name": chapter_name, "page_number": page_number, "extracted_text": text}).execute()

def get_clean_name(file_name: str) -> str:
    return file_name.replace('.pdf', '').replace('_', ' ').title()

@app.get("/api/schools")
async def get_schools():
    try:
        res = supabase.table("schools").select("id, name, address, phone, email, curriculum, is_active").eq("is_active", True).order("name").execute()
        return {"status": "Success", "total": len(res.data or []), "schools": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload-textbook")
async def upload_textbook(
    file:      UploadFile = File(...),
    school_id: str        = Form(None),
    book_type: str        = Form("CBSE")
):
    file_name = file.filename
    if not file_name.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Please upload a PDF.")
    try:
        contents = await file.read()
        clean_name = get_clean_name(file_name)
        book_meta = extract_book_metadata(file_name)
        extracted_pages = extract_pages_from_pdf(contents, file_name)
        full_document_text = "\n".join([p["text"] for p in extracted_pages])

        parsed_curriculum = detect_curriculum_structure(full_document_text, book_type, client, GEMINI_API_KEYS)
        
        ai_chapter_title = parsed_curriculum.get("chapter_name")
        final_chapter_name = ai_chapter_title if ai_chapter_title and ai_chapter_title != "Unknown Chapter" else (extract_chapter_title(extracted_pages) or clean_name)

        unit_match = re.search(r'(?:chapter|lesson|unit)[\s_\-]*(\d+)', file_name.lower())
        if unit_match:
            final_unit_name = f"Unit {unit_match.group(1)}"
        else:
            digit_match = re.search(r'^\d+', final_chapter_name)
            final_unit_name = f"Unit {digit_match.group(0)}" if digit_match else "Unit 1"

        extracted_topics = []
        if "topics" in parsed_curriculum:
            extracted_topics = parsed_curriculum.get("topics", [])
        else:
            detector_units = parsed_curriculum.get("units", [])
            if detector_units and len(detector_units) > 0:
                detector_chapters = detector_units[0].get("chapters", [])
                if detector_chapters and len(detector_chapters) > 0:
                    extracted_topics = detector_chapters[0].get("topics", [])

        database_payload = {
            "units": [{"unit_name": final_unit_name, "chapters": [{"chapter_name": final_chapter_name, "topics": extracted_topics}]}]
        }

        book_id = save_curriculum(
            file_name=file_name, 
            curriculum=database_payload, 
            book_meta=book_meta, 
            school_id=school_id,
            book_type=book_type
        )
        
        page_index_map = build_curriculum_index(extracted_pages)
        save_curriculum_index(file_name, page_index_map)

        page_chapter_map = {}
        for entry in page_index_map:
            for pg in range(entry["start_page"], entry["end_page"] + 1):
                if pg not in page_chapter_map:
                    page_chapter_map[pg] = {"unit_name": final_unit_name, "chapter_name": final_chapter_name, "topic_name": entry["topic_name"]}

        print("[*] Storing smart typed chunks and matching database nodes...")
        inserted_topics_map = {}

        for unit_item in database_payload.get("units", []):
            unit_name = unit_item["unit_name"]
            unit_id = get_id_by_name("units", unit_name, "book_id", book_id)
            
            for chapter_item in unit_item.get("chapters", []):
                chapter_name = chapter_item["chapter_name"]
                chapter_id = get_id_by_name("curriculum_chapters", chapter_name, "unit_id", unit_id) if unit_id else None
                
                if not chapter_id: continue

                for topic in chapter_item.get("topics", []):
                    t_name = topic.get("topic_name", "").strip()
                    if not t_name: continue
                        
                    try:
                        existing_topic = supabase.table("topics").select("id").eq("chapter_id", chapter_id).ilike("topic_name", t_name).execute()
                        if existing_topic.data:
                            generated_topic_id = existing_topic.data[0]["id"]
                        else:
                            topic_res = supabase.table("topics").insert({
                                "chapter_id": chapter_id, 
                                "topic_name": t_name, 
                                "topic_description": topic.get("topic_description", ""), 
                                "topic_code": None
                            }).execute()
                            generated_topic_id = topic_res.data[0]["id"] if topic_res.data else None
                        
                        if generated_topic_id:
                            inserted_topics_map[t_name.lower()] = generated_topic_id
                            
                            for subtopic in topic.get("subtopics", []):
                                s_name = subtopic.get("name", "").strip()
                                s_desc = subtopic.get("description", "").strip()
                                if s_name:
                                    existing_subtopic = supabase.table("subtopics").select("id").eq("topic_id", generated_topic_id).ilike("subtopic_name", s_name).execute()
                                    if not existing_subtopic.data:
                                        supabase.table("subtopics").insert({
                                            "topic_id": generated_topic_id,
                                            "subtopic_name": s_name,
                                            "subtopic_description": s_desc if s_desc else "Textbook subtopic concept explanation.",
                                            "is_active": True
                                        }).execute()
                    except Exception as e:
                        print(f"[!] DB Error processing elements for {t_name}: {e}")

        for page in extracted_pages:
            page_num, page_text = page["page_number"], page["text"].strip()
            if not page_text: continue
            
            topic_name = page_chapter_map.get(page_num, {}).get("topic_name")
            save_textbook_content(file_name, final_chapter_name, page_num, page_text)
            
            unit_id    = get_id_by_name("units", final_unit_name, "book_id", book_id)
            chapter_id = get_id_by_name("curriculum_chapters", final_chapter_name, "unit_id", unit_id) if unit_id else None
            topic_id   = inserted_topics_map.get(topic_name.lower()) if topic_name else None
            
            for chunk_text in split_text_into_chunks(page_text):
                try:
                    from embeddings import generate_embedding
                    embedding_list = generate_embedding(chunk_text).tolist()
                except Exception:
                    embedding_list = [random.uniform(-1.0, 1.0) for _ in range(384)]
                
                save_chunk(
                    book_id=book_id, 
                    unit_id=unit_id, 
                    chapter_id=chapter_id, 
                    topic_id=topic_id, 
                    subtopic_id=None, 
                    page_number=page_num, 
                    chunk_text=chunk_text, 
                    embedding=embedding_list, 
                    content_type=detect_content_type(chunk_text), 
                    book_name=file_name, 
                    chapter_name=final_chapter_name
                )

        return {"status": "Success", "book_id": book_id, "parsed_structure": database_payload}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/get-topics")
async def get_topics():
    try:
        res = supabase.table("topics").select("id, topic_name, topic_description, chapter_id, curriculum_chapters(id, chapter_name, unit_id, units(id, unit_name, book_id, books(id, book_name)))").execute()
        return {"status": "Success", "topics": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate-lesson-plan")
async def generate_lesson_plan_endpoint(payload: SaaSGenerateLessonPlanRequest):
    pass

@app.get("/api/health")
def health_check():
    return {"status": "Online", "engine_version": "APAS SaaS v6.6", "gemini_ready": client is not None}