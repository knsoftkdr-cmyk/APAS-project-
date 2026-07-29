import fitz
from chunker import create_chunks
from curriculum_detector import detect_curriculum_structure
from database import save_curriculum # Import this to save to DB

def process_pdf(pdf_path, filename):
    doc = fitz.open(pdf_path)
    full_text = ""

    for page_number, page in enumerate(doc):
        page_text = page.get_text()
        full_text += page_text + "\n"
        
        # Optional: Print progress
        print(f"--- Processed Page {page_number + 1} ---")

    doc.close()
    
    # 1. Detect the hierarchy structure
    curriculum = detect_curriculum_structure(full_text)
    print("Detected Curriculum:", curriculum)
    
    # 2. Save hierarchy to your Supabase tables
    # This populates your books, units, chapters, and topics tables
    save_curriculum(filename, curriculum)
    
    # 3. Future Step: Iterate through 'curriculum' to create topic-specific chunks
    # For now, this confirms the pipeline flow is complete
    print("--- [SUCCESS] Curriculum saved to database. ---")
    
    return full_text, curriculum