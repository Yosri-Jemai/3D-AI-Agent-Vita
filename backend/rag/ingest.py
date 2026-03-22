"""
ingest.py
=========
Step 1 of the pipeline.

Reads product data from MySQL → splits into chunks → embeds with Ollama →
stores in ChromaDB vector database.

Run once to set up, then re-run whenever your MySQL data changes.

Usage:
    python scripts/ingest.py
    python scripts/ingest.py --reset   (wipe the vector DB and rebuild)
"""

import os
import sys
import argparse
import pymysql
from dotenv import load_dotenv
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_ollama import OllamaEmbeddings
import chromadb
from chromadb.config import Settings

# ── Load .env ────────────────────────────────────────────────────────────────
load_dotenv()

# ── Import your table config ─────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))
from mysql_columns import TABLES, CHUNK_SIZE, CHUNK_OVERLAP


def get_mysql_connection():
    """Create and return a MySQL connection using .env credentials."""
    return pymysql.connect(
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user=os.getenv("MYSQL_USER"),
        password=os.getenv("MYSQL_PASSWORD"),
        database=os.getenv("MYSQL_DATABASE"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def fetch_rows_from_mysql(conn, table_config: dict) -> list[dict]:
    """
    Fetch all rows from one table and return as list of dicts.
    Each dict has: id, name, text (concatenated columns)
    """
    table   = table_config["table"]
    id_col  = table_config["id_column"]
    name_col = table_config["name_column"]
    text_cols = table_config["text_columns"]

    # Build a SELECT for the columns we need
    cols_to_fetch = list(dict.fromkeys([id_col, name_col] + text_cols))
    col_list = ", ".join(f"`{c}`" for c in cols_to_fetch)

    with conn.cursor() as cur:
        cur.execute(f"SELECT {col_list} FROM `{table}`")
        rows = cur.fetchall()

    print(f"  → Fetched {len(rows)} rows from `{table}`")
    return rows


def row_to_document(row: dict, table_config: dict) -> tuple[str, dict]:
    """
    Convert a MySQL row to a (text, metadata) pair.
    Text is built by concatenating column_name: value pairs.
    """
    text_cols = table_config["text_columns"]
    id_col    = table_config["id_column"]
    name_col  = table_config["name_column"]
    table     = table_config["table"]

    parts = []
    for col in text_cols:
        val = row.get(col)
        if val and str(val).strip():
            # Clean up the pipe-separated format
            cleaned = str(val).strip()
            cleaned = cleaned.replace(" | ", "\n")
            cleaned = cleaned.replace("• ", "\n- ")
            cleaned = cleaned.replace("– ", "\n- ")
            label = col.replace("_", " ").title()
            parts.append(f"{label}: {cleaned}")

    text = "\n\n".join(parts)

    metadata = {
        "source_table": table,
        "source_id":    str(row.get(id_col, "")),
        "product_name": str(row.get(name_col, "Unknown Product")),
    }

    return text, metadata


def chunk_document(text: str, metadata: dict, chunk_idx: int) -> list[tuple]:
    """Split a document into chunks, preserving metadata."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_text(text)
    result = []
    for i, chunk in enumerate(chunks):
        chunk_meta = {**metadata, "chunk_index": i}
        chunk_id   = f"{metadata['source_table']}_{metadata['source_id']}_chunk{i}"
        result.append((chunk_id, chunk, chunk_meta))
    return result


def main(reset: bool = False):
    print("\n=== MedRAG Ingestion Pipeline ===\n")

    # ── 1. Connect to MySQL ──────────────────────────────────────────────────
    print("1. Connecting to MySQL...")
    try:
        conn = get_mysql_connection()
        print("   ✓ Connected to MySQL")
    except Exception as e:
        print(f"   ✗ MySQL connection failed: {e}")
        print("   Check your .env file credentials.")
        sys.exit(1)

    # ── 2. Load embedding model ──────────────────────────────────────────────
    print("\n2. Loading embedding model from Ollama...")
    embed_model = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
    base_url    = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    try:
        embeddings = OllamaEmbeddings(model=embed_model, base_url=base_url)
        # Quick test
        _ = embeddings.embed_query("test")
        print(f"   ✓ Embedding model '{embed_model}' ready")
    except Exception as e:
        print(f"   ✗ Ollama not reachable: {e}")
        print("   Make sure Ollama is running: open a terminal and type 'ollama serve'")
        sys.exit(1)

    # ── 3. Set up ChromaDB ───────────────────────────────────────────────────
    print("\n3. Setting up ChromaDB...")
    persist_dir     = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
    collection_name = os.getenv("CHROMA_COLLECTION_NAME", "medical_products")

    os.makedirs(persist_dir, exist_ok=True)
    chroma_client = chromadb.PersistentClient(path=persist_dir)

    if reset:
        print("   ! --reset flag: deleting existing collection...")
        try:
            chroma_client.delete_collection(collection_name)
        except Exception:
            pass

    collection = chroma_client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )
    print(f"   ✓ Collection '{collection_name}' ready")

    # ── 4. Process each table ────────────────────────────────────────────────
    print("\n4. Reading MySQL data and ingesting into vector DB...\n")

    total_chunks = 0

    for table_config in TABLES:
        table_name = table_config["table"]
        print(f"  Processing table: {table_name}")

        rows = fetch_rows_from_mysql(conn, table_config)

        all_ids, all_docs, all_metas = [], [], []

        for i, row in enumerate(rows):
            text, metadata = row_to_document(row, table_config)
            if not text.strip():
                continue

            chunks = chunk_document(text, metadata, i)
            for chunk_id, chunk_text, chunk_meta in chunks:
                all_ids.append(chunk_id)
                all_docs.append(chunk_text)
                all_metas.append(chunk_meta)

        if not all_docs:
            print(f"  ! No text found in table '{table_name}' — check your column names")
            continue

        # Embed in batches of 50 (avoids memory issues)
        BATCH = 50
        for batch_start in range(0, len(all_docs), BATCH):
            batch_ids   = all_ids[batch_start:batch_start + BATCH]
            batch_docs  = all_docs[batch_start:batch_start + BATCH]
            batch_metas = all_metas[batch_start:batch_start + BATCH]

            print(f"    Embedding batch {batch_start // BATCH + 1} "
                  f"({len(batch_docs)} chunks)...", end="", flush=True)

            vectors = embeddings.embed_documents(batch_docs)

            # Upsert (add or update) into ChromaDB
            collection.upsert(
                ids=batch_ids,
                documents=batch_docs,
                embeddings=vectors,
                metadatas=batch_metas,
            )
            print(" ✓")

        total_chunks += len(all_docs)
        print(f"  ✓ {table_name}: {len(rows)} rows → {len(all_docs)} chunks stored\n")

    conn.close()

    # ── 5. Summary ───────────────────────────────────────────────────────────
    final_count = collection.count()
    print("=" * 40)
    print(f"✓ Ingestion complete!")
    print(f"  Total chunks in vector DB: {final_count}")
    print(f"  Database stored at: {persist_dir}")
    print("\nNext step: run the API with:")
    print("  python backend/api.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Wipe the existing vector DB and rebuild from scratch",
    )
    args = parser.parse_args()
    main(reset=args.reset)
