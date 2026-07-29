from sentence_transformers import SentenceTransformer

model = SentenceTransformer(
    "all-MiniLM-L6-v2"
)

def generate_embedding(text):

    if not text or not text.strip():
        return None

    embedding = model.encode(text)

    return embedding