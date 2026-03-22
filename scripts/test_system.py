"""
test_system.py
==============
Run this after setup to check each component of the system.

Usage:
    python scripts/test_system.py
"""

import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()


def section(title):
    print(f"\n{'─'*50}")
    print(f"  {title}")
    print(f"{'─'*50}")


def ok(msg):    print(f"  ✓ {msg}")
def fail(msg):  print(f"  ✗ {msg}")
def info(msg):  print(f"  · {msg}")


# ── 1. Python packages ──────────────────────────────────────────────────────
section("1. Python Dependencies")
required = [
    "langchain", "langchain_community", "langchain_ollama",
    "chromadb", "pymysql", "dotenv", "fastapi", "uvicorn",
]
all_ok = True
for pkg in required:
    try:
        __import__(pkg.replace("-", "_"))
        ok(pkg)
    except ImportError:
        fail(f"{pkg}  ← run: pip install -r requirements.txt")
        all_ok = False

if not all_ok:
    print("\n  Fix missing packages first, then re-run this script.")
    sys.exit(1)


# ── 2. .env file ───────────────────────────────────────────────────────────
section("2. Environment Variables")
required_env = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"]
for var in required_env:
    val = os.getenv(var)
    if val:
        display = val if "PASSWORD" not in var else "***"
        ok(f"{var} = {display}")
    else:
        fail(f"{var} is not set in .env")


# ── 3. MySQL connection ────────────────────────────────────────────────────
section("3. MySQL Connection")
try:
    import pymysql
    conn = pymysql.connect(
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user=os.getenv("MYSQL_USER"),
        password=os.getenv("MYSQL_PASSWORD"),
        database=os.getenv("MYSQL_DATABASE"),
    )
    ok(f"Connected to MySQL database '{os.getenv('MYSQL_DATABASE')}'")

    with conn.cursor() as cur:
        cur.execute("SHOW TABLES")
        tables = cur.fetchall()
        info(f"Tables found: {[t[0] for t in tables]}")

    conn.close()
except Exception as e:
    fail(f"MySQL connection failed: {e}")
    print("  Check your .env credentials.")


# ── 4. Ollama ──────────────────────────────────────────────────────────────
section("4. Ollama LLM Service")
try:
    import urllib.request
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    req = urllib.request.urlopen(f"{base_url}/api/tags", timeout=3)
    data = json.loads(req.read())
    models = [m["name"] for m in data.get("models", [])]
    ok(f"Ollama is running at {base_url}")
    info(f"Available models: {models}")

    llm_model   = os.getenv("OLLAMA_LLM_MODEL", "llama3.1")
    embed_model = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

    if any(llm_model in m for m in models):
        ok(f"LLM model '{llm_model}' is available")
    else:
        fail(f"LLM model '{llm_model}' not found — run: ollama pull {llm_model}")

    if any(embed_model in m for m in models):
        ok(f"Embed model '{embed_model}' is available")
    else:
        fail(f"Embed model '{embed_model}' not found — run: ollama pull {embed_model}")

except Exception as e:
    fail(f"Cannot reach Ollama: {e}")
    print("  Make sure Ollama is installed and running.")
    print("  Download: https://ollama.com/download")
    print("  Then run: ollama serve")


# ── 5. ChromaDB / Vector store ─────────────────────────────────────────────
section("5. ChromaDB Vector Store")
try:
    import chromadb
    persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
    coll_name   = os.getenv("CHROMA_COLLECTION_NAME", "medical_products")

    client = chromadb.PersistentClient(path=persist_dir)
    coll   = client.get_or_create_collection(coll_name)
    count  = coll.count()
    ok(f"ChromaDB accessible at: {persist_dir}")

    if count > 0:
        ok(f"{count} chunks already stored — ingestion done!")
    else:
        info("0 chunks stored — run: python scripts/ingest.py")

except Exception as e:
    fail(f"ChromaDB error: {e}")


# ── Summary ────────────────────────────────────────────────────────────────
section("Summary")
print("  If all checks passed, run the system with:")
print()
print("    Step 1: python scripts/ingest.py")
print("    Step 2: python backend/api.py")
print("    Step 3: Open frontend/index.html in your browser")
print()
