"""
curriculum_detector.py - APAS v16.0
Universal multi-subject curriculum structure extractor.
- Captures full, exact textbook descriptions (Objectives + Activities) into the database.
- Optimized to prevent skipping or truncating topics in long annexures/chapters.
"""

import re
import json
import time

def detect_curriculum_structure(text, book_type="CBSE", client=None, api_keys=None):
    book_type = book_type.upper()
    print(f"[*] Routing engine to pipeline format: {book_type}")

    if api_keys or client:
        print(f"[*] Using Gemini to extract {book_type} curriculum structure...")
        result = _gemini_extract(text, book_type, client, api_keys)
        if result:
            return result
        print(f"[!] All Gemini keys failed - falling back to regex parser")
        
    print(f"[*] Using regex parser for {book_type}...")
    return _regex_detect(text, book_type)


def _gemini_extract(text, book_type, client, api_keys=None):
    from google import genai as _genai

    if api_keys and len(api_keys) > 1:
        clients_to_try = [_genai.Client(api_key=k) for k in api_keys]
    elif client:
        clients_to_try = [client]
    else:
        return None

    # Use a larger sample limit to make sure late-chapter activities are not omitted
    sample = text[:120000]
    
    if book_type == "STATE" or "environmental" in book_type.lower():
        prompt_rules = """
STRICT INSTRUCTIONS FOR STATE / ENVIRONMENTAL / ANNEXURE SUBJECTS:
1. If the top title header says 'Annexure' or contains annexure text, set "chapter_name": "Annexure".
2. Scan the ENTIRE text from beginning to end for ALL numbered topics/activities (e.g., '1. BIRDS AROUND US', '2. OIL AND WATER NEVER MIX', up to '27. THE POET IN US'). Do not skip ANY.
3. For each topic, "topic_name" MUST be the clean uppercase title (e.g., "BIRDS AROUND US").
4. For "description", DO NOT summarize or use phrases like "Covers...". You MUST extract the ACTUAL full paragraph text directly from the textbook section below it (include both the 'Objectives' and 'Activity' sections verbatim or near-verbatim as text sentences).
"""
    else:
        prompt_rules = """
STRICT RULES FOR CBSE SUBJECTS:
1. Extract the main overarching chapter name or lesson title into "chapter_name".
2. Extract the primary core academic conceptual topic sub-headings into the "topics" list.
3. Provide a clear summary of what that topic covers for the description.
"""

    prompt = f"""You are an advanced textbook curriculum structure extractor.
Analyze the following raw text from a textbook chapter and return a strict JSON object mapping its structural layout.

OUTPUT FORMAT TEMPLATE:
{{
  "chapter_name": "Extract the precise, complete title at the top of page 1.",
  "topics": [
    {{
      "topic_name": "EXACT TOPIC NAME FROM TEXTBOOK",
      "description": "FULL PARAGRAPH DESCRIPTION DIRECTLY FROM THE TEXTBOOK CONTENT UNDER THIS TOPIC (Include Objectives and Activity details)."
    }}
  ]
}}

{prompt_rules}

RAW TEXT TO PARSE:
{sample}
"""

    total_attempts = len(clients_to_try) * 2
    for attempt in range(total_attempts):
        key_index  = attempt % len(clients_to_try)
        cur_client = clients_to_try[key_index]
        
        try:
            res = cur_client.models.generate_content(
                model="models/gemini-2.5-flash",
                contents=prompt,
                config={
                    "temperature": 0.1, 
                    "response_mime_type": "application/json"
                }
            )
            
            if not res or not hasattr(res, 'text') or res.text is None:
                print(f"[!] Gemini returned an empty response text payload on attempt {attempt + 1}")
                continue
                
            raw = res.text.strip()
            if not raw:
                print(f"[!] Cleaned text payload string is empty on attempt {attempt + 1}")
                continue

            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
            
            return json.loads(raw)
            
        except Exception as e:
            print(f"[!] Key attempt failed: {e}")
            time.sleep(2)
            
    return None


def _regex_detect(text, book_type):
    raw_lines = text.split("\n")
    lines = [rl.strip() for rl in raw_lines if rl.strip()]
    
    chapter_name = "Core Chapter Content"
    topics = []

    for line in lines[:10]:
        if "annexure" in line.lower():
            chapter_name = "Annexure"
            break
        elif "item:" in line.lower() or "chapter:" in line.lower():
            continue
        elif len(line) > 3 and not line.startswith("-"):
            chapter_name = line
            break

    if book_type == "STATE" or "environmental" in book_type.lower():
        # Match lines starting with "1. TOPIC NAME"
        topic_pattern = re.compile(r'^(\d+)\.\s*([A-Z\s\']{4,})')
        for i, line in enumerate(lines):
            match = topic_pattern.match(line)
            if match:
                t_name = match.group(2).strip()
                desc_lines = []
                
                # Capture the next 12 lines to extract a full description block 
                for j in range(i + 1, min(i + 15, len(lines))):
                    if topic_pattern.match(lines[j]) or "Free distribution by" in lines[j]:
                        break
                    desc_lines.append(lines[j])
                
                topics.append({
                    "topic_name": t_name,
                    "description": " ".join(desc_lines).strip() if desc_lines else "Textbook activity guidelines."
                })
    else:
        for line in lines[5:15]:
            if len(line) > 5 and line.isupper() and not any(k in line.lower() for k in ["page", "copyright"]):
                topics.append({"topic_name": line, "description": "Academic chapter subtopic."})

    return {
        "chapter_name": chapter_name,
        "topics": topics
    }