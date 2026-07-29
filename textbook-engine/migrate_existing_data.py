import psycopg2
from pgvector.psycopg2 import register_vector  # Add this import
from chunker import create_chunks

DB_CONFIG = "postgresql://postgres:apascirrcum12345@db.ywzebiuugnpjawgqengp.supabase.co:5432/postgres"

def migrate():
    conn = psycopg2.connect(DB_CONFIG)
    register_vector(conn)  # Add this line to register the vector type
    cur = conn.cursor()
    
    cur.execute("SELECT book_name, chapter_name, extracted_text FROM textbook_content")
    rows = cur.fetchall()
    
    print(f"Found {len(rows)} textbooks. Starting migration...")
    
    for book, chapter, text in rows:
        print(f"Processing: {book} - {chapter}")
        create_chunks(book, chapter, text)
        
    cur.close()
    conn.close()
    print("--- MIGRATION COMPLETE ---")

if __name__ == "__main__":
    migrate()