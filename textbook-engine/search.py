import psycopg2
from pgvector.psycopg2 import register_vector
from embeddings import generate_embedding

# Database connection string
DB_URL = "postgresql://postgres:apascirrcum12345@db.ywzebiuugnpjawgqengp.supabase.co:5432/postgres"

def search_content(query):
    """
    1. Converts query to embedding.
    2. Searches Supabase using vector similarity.
    3. Returns results as a list of tuples (chapter_name, chunk_text).
    """
    # 1. Convert user query to vector list
    query_embedding = generate_embedding(query).tolist()
    
    # 2. Connect to database
    conn = psycopg2.connect(DB_URL)
    register_vector(conn)
    cur = conn.cursor()
    
    try:
        # DEBUG: Print the database we are connected to
        cur.execute("SELECT current_database(), current_schema();")
        db_info = cur.fetchone()
        print(f"--- [DEBUG] Connected to DB: {db_info[0]}, Schema: {db_info[1]} ---")

        # 3. Execute search with ::vector cast to fix the operator error
        cur.execute(
            """
            SELECT
                chapter_name,
                chunk_text
            FROM public.textbook_chunks
            ORDER BY embedding <-> %s::vector
            LIMIT 5
            """,
            (query_embedding,)
        )
        
        results = cur.fetchall()
        print(f"--- [DEBUG] Found {len(results)} results ---")
        return results
        
    except Exception as e:
        print(f"--- [ERROR] Search failed: {e} ---")
        return []
        
    finally:
        # 4. Clean up connection
        cur.close()
        conn.close()