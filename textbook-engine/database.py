import os
import re
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────
# SUPABASE CONNECTION
# ─────────────────────────────────────────
SUPABASE_URL ="https://qkclzrscyhzrbixajaiw.supabase.co"
SUPABASE_KEY ="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrY2x6cnNjeWh6cmJpeGFqYWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MTkxMDQsImV4cCI6MjA5NDQ5NTEwNH0.ziU4sPjrGx6ec1ungXbnW-5z-I1g4Qb_uxDgcuO4hHQ"
if not SUPABASE_URL or not SUPABASE_KEY:
    print("[!] Warning: SUPABASE_URL or SUPABASE_KEY is missing.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ─────────────────────────────────────────
# HELPER — GET ID BY NAME
# ─────────────────────────────────────────
def get_id_by_name(
    table_name: str,
    name_val:   str,
    filter_col: str = None,
    filter_id:  int = None
) -> int:
    try:
        col_name = (
            "unit_name"     if table_name == "units"  else
            "chapter_name"  if table_name in ["chapters", "curriculum_chapters"] else
            "topic_name"    if table_name == "topics" else
            "subtopic_name"
        )

        target_table = "curriculum_chapters" if table_name == "chapters" else table_name

        query = supabase.table(target_table).select("id").eq(col_name, name_val)
        if filter_col and filter_id:
            query = query.eq(filter_col, filter_id)
        res = query.execute()
        if res.data:
            return res.data[0]["id"]
    except Exception as e:
        print(f"[-] Lookup Error in table '{table_name}': {str(e)}")
    return None


# ─────────────────────────────────────────
# SAVE CURRICULUM HIERARCHY (UPDATED FOR DYNAMIC BOARD SELECTION)
# ─────────────────────────────────────────
def save_curriculum(
    file_name:  str,
    curriculum: dict,
    book_meta:  dict = None,
    school_id:  str  = None,
    book_type:  str  = "CBSE"  # <--- FIXED: Now accepts frontend parameter safely
) -> int:
    try:
        meta            = book_meta or {}
        class_name      = meta.get("class_name") or "Unknown Class"
        subject         = meta.get("subject")    or "General"
        
        # Priority fallback: Use frontend selection, fallback to metadata parsing if empty
        curriculum_type = book_type.upper() if book_type else (meta.get("curriculum") or "CBSE")

        print(f"[*] Saving Book: {file_name} | Subject: {subject} | Grade: {class_name} | Curriculum: {curriculum_type} | School ID: {school_id}")

        # Ensure a clean slate for the book if it exists to avoid mixing cross-chunks
        supabase.table("books").delete().eq("book_name", file_name).eq("subject", subject).execute()

        # Insert a clean new row — mapping the frontend choice directly to your 'curriculum' column
        book_insert = supabase.table("books").insert({
            "book_name":  file_name,
            "class_name": class_name,
            "subject":    subject,
            "curriculum": curriculum_type, # <--- Perfectly targets and updates your DB column layout
            "is_active":  True,
            "school_id":  school_id  
        }).execute()
        book_id = book_insert.data[0]["id"]

        for unit in curriculum.get("units", []):
            # ── 2. Unit ──
            unit_res = (
                supabase.table("units")
                .select("id")
                .eq("unit_name", unit["unit_name"])
                .eq("book_id", book_id)
                .execute()
            )
            if unit_res.data:
                unit_id = unit_res.data[0]["id"]
            else:
                unit_insert = supabase.table("units").insert({
                    "book_id":   book_id,
                    "unit_name": unit["unit_name"],
                    "is_active": True
                }).execute()
                unit_id = unit_insert.data[0]["id"]

            for chapter in unit.get("chapters", []):
                # ── 3. Chapter ──
                chapter_res = (
                    supabase.table("curriculum_chapters")
                    .select("id")
                    .eq("chapter_name", chapter["chapter_name"])
                    .eq("unit_id", unit_id)
                    .execute()
                )
                if chapter_res.data:
                    chapter_id = chapter_res.data[0]["id"]
                else:
                    chapter_insert = supabase.table("curriculum_chapters").insert({
                        "unit_id":      unit_id,
                        "chapter_name": chapter["chapter_name"],
                        "is_active":    True
                    }).execute()
                    chapter_id = chapter_insert.data[0]["id"]

                for display_order, topic in enumerate(
                    chapter.get("topics", []), start=1
                ):
                    # ── 4. Topic ──
                    topic_res = (
                        supabase.table("topics")
                        .select("id")
                        .eq("topic_name", topic["topic_name"])
                        .eq("chapter_id", chapter_id)
                        .execute()
                    )
                    if topic_res.data:
                        topic_id   = topic_res.data[0]["id"]
                        gemini_desc = topic.get("topic_description", "").strip()
                        if gemini_desc:
                            supabase.table("topics").update({
                                "topic_description": gemini_desc,
                                "status":            "ACTIVE"
                            }).eq("id", topic_id).execute()
                    else:
                        topic_code_val = re.sub(
                            r'[^a-zA-Z0-9]', '', topic["topic_name"]
                        )[:20].upper() or "TOPIC"

                        gemini_desc       = topic.get("topic_description", "").strip()
                        topic_description = gemini_desc if gemini_desc else f"Covers {topic['topic_name']}."

                        topic_insert = supabase.table("topics").insert({
                            "chapter_id":        chapter_id,
                            "topic_name":        topic["topic_name"],
                            "topic_code":        topic_code_val,
                            "topic_description": topic_description,
                            "display_order":     display_order,
                            "status":            "ACTIVE"
                        }).execute()
                        topic_id = topic_insert.data[0]["id"]

                    # ── 5. Subtopics ──
                    subtopics_list = topic.get("subtopics", [])

                    if not subtopics_list:
                        try:
                            supabase.table("curriculum_index").insert({
                                "book_name":     file_name,
                                "unit_name":     unit["unit_name"],
                                "chapter_name":  chapter["chapter_name"],
                                "topic_name":    topic["topic_name"],
                                "subtopic_name": None,
                                "start_page":    1,
                                "end_page":      1
                            }).execute()
                        except Exception as e:
                            print(f"[-] Index Tracking Log Error: {str(e)}")

                    for subtopic in subtopics_list:
                        if isinstance(subtopic, dict):
                            subtopic_name        = subtopic.get("name", "").strip()
                            subtopic_description = subtopic.get("description", "").strip()
                        else:
                            subtopic_name        = str(subtopic).strip()
                            subtopic_description = ""

                        if not subtopic_name:
                            continue

                        existing = (
                            supabase.table("subtopics")
                            .select("id")
                            .eq("subtopic_name", subtopic_name)
                            .eq("topic_id", topic_id)
                            .execute()
                        )
                        if existing.data:
                            subtopic_id = existing.data[0]["id"]
                            if subtopic_description:
                                supabase.table("subtopics").update({
                                    "subtopic_description": subtopic_description
                                }).eq("id", subtopic_id).execute()
                        else:
                            subtopic_insert = supabase.table("subtopics").insert({
                                "topic_id":             topic_id,
                                "subtopic_name":        subtopic_name,
                                "subtopic_description": subtopic_description,
                                "is_active":            True
                            }).execute()
                            subtopic_id = subtopic_insert.data[0]["id"]

                        # ── 6. Curriculum Index ──
                        try:
                            idx_check = (
                                supabase.table("curriculum_index")
                                .select("id")
                                .eq("book_name",     file_name)
                                .eq("topic_name",    topic["topic_name"])
                                .eq("subtopic_name", subtopic_name)
                                .execute()
                            )
                            if not idx_check.data:
                                supabase.table("curriculum_index").insert({
                                    "book_name":     file_name,
                                    "unit_name":     unit["unit_name"],
                                    "chapter_name":  chapter["chapter_name"],
                                    "topic_name":    topic["topic_name"],
                                    "subtopic_name": subtopic_name,
                                    "start_page":    1,
                                    "end_page":      1
                                }).execute()
                        except Exception as e:
                            print(f"[-] Live Index Insertion Error: {str(e)}")

        print(f"[+] Curriculum saved successfully for {subject}. book_id={book_id}")
        return book_id

    except Exception as e:
        print(f"[-] Curriculum Save Error: {str(e)}")
        raise


# ─────────────────────────────────────────
# SAVE CURRICULUM INDEX
# ─────────────────────────────────────────
def save_curriculum_index(file_name: str, index_entries: list):
    try:
        for entry in index_entries:
            supabase.table("curriculum_index").insert({
                "book_name":     file_name,
                "unit_name":     entry["unit_name"],
                "chapter_name":  entry["chapter_name"],
                "topic_name":    entry["topic_name"],
                "subtopic_name": entry.get("subtopic_name"),
                "start_page":    entry["start_page"],
                "end_page":      entry["end_page"]
            }).execute()
    except Exception as e:
        print(f"[-] Index Save Error: {str(e)}")


# ─────────────────────────────────────────
# SAVE CHUNK
# ─────────────────────────────────────────
def save_chunk(
    book_id:      int,
    unit_id:      int,
    chapter_id:   int,
    topic_id:     int,
    subtopic_id:  int,
    page_number:  int,
    chunk_text:   str,
    embedding:    list,
    content_type: str = "LESSON_CONCEPT",
    book_name:    str = None,
    chapter_name: str = None
):
    try:
        supabase.table("textbook_chunks").insert({
            "book_id":      book_id,
            "unit_id":      unit_id,
            "chapter_id":   chapter_id,
            "topic_id":     topic_id,
            "subtopic_id":  subtopic_id,
            "page_number":  page_number,
            "chunk_text":   chunk_text,
            "embedding":    embedding,
            "content_type": content_type,
            "book_name":    book_name,
            "chapter_name": chapter_name
        }).execute()
    except Exception as e:
        print(f"[-] Chunk Save Error: {str(e)}")


# ─────────────────────────────────────────
# GET OR CREATE SAAS DEFAULTS
# ─────────────────────────────────────────
def get_or_create_saas_defaults() -> dict:
    try:
        school_res = (
            supabase.table("schools")
            .select("id")
            .eq("name", "APAS Demo School")
            .execute()
        )
        if school_res.data:
            school_id = school_res.data[0]["id"]
        else:
            school_insert = supabase.table("schools").insert({
                "name":      "APAS Demo School",
                "is_active": True
            }).execute()
            school_id = school_insert.data[0]["id"]

        branch_res = (
            supabase.table("school_branches")
            .select("id")
            .eq("school_id", school_id)
            .execute()
        )
        if branch_res.data:
            branch_id = branch_res.data[0]["id"]
        else:
            branch_insert = supabase.table("school_branches").insert({
                "school_id":   school_id,
                "branch_name": "Main Branch",
                "is_active":   True
            }).execute()
            branch_id = branch_insert.data[0]["id"]

        settings_res = (
            supabase.table("school_lesson_plan_settings")
            .select("id, academic_year_id, grade_id, subject_id")
            .eq("school_id", school_id)
            .eq("branch_id", branch_id)
            .limit(1)
            .execute()
        )
        if settings_res.data:
            s = settings_res.data[0]
            return {
                "school_id":        school_id,
                "branch_id":        branch_id,
                "academic_year_id": s.get("academic_year_id"),
                "grade_id":         s.get("grade_id"),
                "subject_id":       s.get("subject_id")
            }

        return {
            "school_id":        school_id,
            "branch_id":        branch_id,
            "academic_year_id": None,
            "grade_id":         None,
            "subject_id":       None
        }
    except Exception as e:
        print(f"[-] SaaS Defaults Error: {str(e)}")
        return {
            "school_id":        None,
            "branch_id":        None,
            "academic_year_id": None,
            "grade_id":         None,
            "subject_id":       None
        }


# ─────────────────────────────────────────
# SAVE SAAS LESSON PLAN
# ─────────────────────────────────────────
def save_saas_lesson_plan(
    plan_master: dict,
    activities:  list,
    assessments: list
) -> int:
    try:
        plan_insert    = supabase.table("lesson_plans").insert(plan_master).execute()
        lesson_plan_id = plan_insert.data[0]["id"]

        for act in activities:
            supabase.table("lesson_plan_activities").insert({
                "lesson_plan_id":       lesson_plan_id,
                "activity_type":        act.get("activity_type"),
                "activity_title":       act.get("activity_title"),
                "activity_description": act.get("activity_description"),
                "duration_minutes":     act.get("duration_minutes"),
                "display_order":        act.get("display_order", 1)
            }).execute()

        for asmt in assessments:
            supabase.table("lesson_plan_assessments").insert({
                "lesson_plan_id":  lesson_plan_id,
                "assessment_type": asmt.get("assessment_type"),
                "question_text":   asmt.get("question_text"),
                "answer_key":      asmt.get("answer_key"),
                "marks":           asmt.get("marks"),
                "display_order":   asmt.get("display_order", 1)
            }).execute()

        return lesson_plan_id
    except Exception as e:
        print(f"[-] Lesson Plan Save Error: {str(e)}")
        raise


# ─────────────────────────────────────────
# FETCH LESSON CONCEPT CHUNKS
# ─────────────────────────────────────────
def get_lesson_concept_chunks(topic_id: int) -> list:
    try:
        res = (
            supabase.table("textbook_chunks")
            .select("chunk_text, page_number, subtopic_id")
            .eq("topic_id", topic_id)
            .eq("content_type", "LESSON_CONCEPT")
            .order("page_number")
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"[-] Chunk Fetch Error: {str(e)}")
        return []


# ─────────────────────────────────────────
# FETCH CHUNKS BY TYPE
# ─────────────────────────────────────────
def get_chunks_by_type(topic_id: int, content_type: str) -> list:
    try:
        res = (
            supabase.table("textbook_chunks")
            .select("chunk_text, page_number, subtopic_id")
            .eq("topic_id", topic_id)
            .eq("content_type", content_type)
            .order("page_number")
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"[-] Chunk Type Fetch Error: {str(e)}")
        return []


# ─────────────────────────────────────────
# FETCH SUBTOPICS WITH DESCRIPTIONS
# ─────────────────────────────────────────
def get_subtopics_by_topic(topic_id: int) -> list:
    try:
        res = (
            supabase.table("subtopics")
            .select("id, subtopic_name, subtopic_description, is_active")
            .eq("topic_id", topic_id)
            .eq("is_active", True)
            .execute()
        )
        if res.data:
            print(f"[+] Found {len(res.data)} subtopics for topic_id {topic_id}")
            return res.data
        else:
            print(f"[!] No subtopics found for topic_id {topic_id}")
            return []
    except Exception as e:
        print(f"[-] Subtopic Fetch Error: {str(e)}")
        return []