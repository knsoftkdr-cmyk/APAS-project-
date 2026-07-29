from dotenv import load_dotenv
load_dotenv()

import os
import json
from google import genai
from search import search_content
from database import (
    get_lesson_concept_chunks,
    get_chunks_by_type,
    get_or_create_saas_defaults,
    save_saas_lesson_plan
)

# ─────────────────────────────────────────
# GEMINI CLIENT
# ─────────────────────────────────────────

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


# ─────────────────────────────────────────
# HELPER — RESOLVE TOPIC ID
# ─────────────────────────────────────────

def resolve_topic_id(topic: str) -> int:
    """
    Finds topic_id from topics table
    by matching topic name.
    Called when user selects topic from UI.
    """
    try:
        from database import supabase
        res = (
            supabase.table("topics")
            .select("id, topic_name")
            .ilike("topic_name", f"%{topic}%")
            .limit(1)
            .execute()
        )
        if res.data:
            print(f"[+] Resolved topic_id: {res.data[0]['id']} for '{topic}'")
            return res.data[0]["id"]
        else:
            print(f"[!] No topic_id found for '{topic}'")
            return None
    except Exception as e:
        print(f"[-] Topic ID Resolve Error: {str(e)}")
        return None


# ─────────────────────────────────────────
# MAIN LESSON PLAN GENERATOR
# ─────────────────────────────────────────

def generate_lesson_plan(topic: str, grade: str, subject: str = None) -> str:
    """
    Generates a structured lesson plan using
    ONLY lesson concept chunks for a given topic.

    Flow:
    1. Resolve topic_id from topics table
    2. Fetch ONLY lesson concept chunks
    3. Fallback to search_content if no chunks found
    4. Build prompt with clean context
    5. Generate lesson plan via Gemini
    6. Save to lesson_plans table
    """
    try:

        # ── Step 1: Resolve Topic ID ──
        topic_id = resolve_topic_id(topic)

        # ── Step 2: Fetch ONLY Lesson Concept Chunks ──
        lesson_chunks = []

        if topic_id:
            lesson_chunks = get_lesson_concept_chunks(topic_id)
            print(f"[+] Using {len(lesson_chunks)} LESSON_CONCEPT chunks")

        # ── Step 3: Fallback to search_content ──
        # if no typed chunks found yet
        # (happens before chunker.py reprocesses PDFs)
        if not lesson_chunks:
            print("[!] No typed chunks found — falling back to search_content()")
            raw_chunks = search_content(topic)

            if not raw_chunks:
                return (
                    f"I couldn't find any textbook content for "
                    f"'{topic}'. Please try a different topic."
                )
            context_text = "\n\n".join([chunk[1] for chunk in raw_chunks])

        else:
            # Use only clean lesson concept text
            context_text = "\n\n".join([
                chunk["chunk_text"] for chunk in lesson_chunks
            ])

        # ── Step 4: Fetch Examples to Enrich Plan ──
        example_text = ""
        if topic_id:
            example_chunks = get_chunks_by_type(topic_id, "EXAMPLE")
            if example_chunks:
                example_text = "\n\n".join([
                    chunk["chunk_text"] for chunk in example_chunks
                ])
                print(f"[+] Added {len(example_chunks)} EXAMPLE chunks")

        # ── Step 5: Build Prompt ──
        prompt = f"""
You are an expert AI Curriculum Designer 
specializing in the CBSE framework.

Create a comprehensive lesson plan for 
Grade {grade} on the topic: "{topic}".
{f'Subject: {subject}' if subject else ''}

Use ONLY the following textbook lesson content 
as your primary source of truth.
Do NOT include worksheet questions, 
exercise problems, or assessment questions 
in the lesson flow itself:

=== LESSON CONTENT ===
{context_text}

{f'''=== EXAMPLES FROM TEXTBOOK ===
{example_text}''' if example_text else ''}

Format the output into these exact sections:

1. LEARNING OBJECTIVES
   Use Bloom's Taxonomy verbs
   (Remember, Understand, Apply, 
    Analyze, Evaluate, Create)

2. KEY CONCEPTS
   List the main concepts from the 
   lesson content above

3. VARK ENGAGEMENT STRATEGY
   Visual, Aural, Read/Write, 
   and Kinesthetic activities

4. LESSON FLOW (45 minutes)
   - Introduction     (5 mins)
   - Main Teaching   (20 mins)
   - Activity        (10 mins)
   - Assessment      (5 mins)
   - Wrap Up         (5 mins)

5. ZPD SCAFFOLDING
   Support for students who find 
   this topic difficult

6. FORMATIVE ASSESSMENT
   Two short check-for-understanding 
   questions based on lesson content only

7. HOMEWORK
   One relevant homework task

Keep the tone professional, encouraging, 
and pedagogically sound.
"""

        # ── Step 6: Generate via Gemini ──
        print(f"[+] Generating lesson plan for '{topic}' Grade {grade}...")

        response = client.models.generate_content(
            model="models/gemini-2.5-flash",
            contents=prompt
        )

        if not response or not response.text:
            return "The AI generated an empty response. Please try again."

        generated_text = response.text
        print(f"[+] Lesson plan generated successfully")

        # ── Step 7: Save to Database ──
        if topic_id:
            try:
                defaults = get_or_create_saas_defaults()

                plan_master = {
                    "school_id":         defaults.get("school_id"),
                    "branch_id":         defaults.get("branch_id"),
                    "academic_year_id":  defaults.get("academic_year_id"),
                    "grade_id":          defaults.get("grade_id"),
                    "subject_id":        defaults.get("subject_id"),
                    "topic_id":          topic_id,
                    "lesson_title":      topic,
                    "ai_response":       {"generated_text": generated_text},
                    "generated_by_ai":   True,
                    "approval_status":   "DRAFT",
                    "version_no":        1,
                    "is_active":         True
                }

                lesson_plan_id = save_saas_lesson_plan(
                    plan_master,
                    activities=[],    # AI activities parsed separately
                    assessments=[]    # AI assessments parsed separately
                )
                print(f"[+] Saved to DB with lesson_plan_id: {lesson_plan_id}")

            except Exception as save_error:
                # Don't fail the response if DB save fails
                print(f"[!] DB Save Warning: {str(save_error)}")

        return generated_text

    except Exception as e:
        print(f"--- [CRITICAL ERROR in lesson_generator] ---")
        print(str(e))

        if "429" in str(e):
            return (
                "AI is currently busy (Rate limit hit). "
                "Please try again in 1 minute."
            )
        return f"An error occurred: {str(e)}"


# ─────────────────────────────────────────
# QUICK TEST
# ─────────────────────────────────────────

if __name__ == "__main__":
    result = generate_lesson_plan(
        topic="Photosynthesis",
        grade="6",
        subject="Science"
    )
    print(result)