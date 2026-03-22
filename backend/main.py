"""
backend/main.py
===============
FastAPI entry point. Registers all routers.

Run with:
    python backend/main.py
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from backend.api.routes_chat  import router as chat_router
from backend.api.routes_voice import router as voice_router

app = FastAPI(
    title="VitalAgent API",
    description="3D AI Medical Delegate Training Agent",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(chat_router,  prefix="/chat",  tags=["Chat"])
app.include_router(voice_router, prefix="/voice", tags=["Voice"])

@app.get("/health")
def health():
    return {"status": "ok", "service": "VitalAgent"}

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", 8000))
    print(f"\n VitalAgent API starting on http://localhost:{port}\n")
    uvicorn.run("backend.main:app", host=host, port=port, reload=False)

# Direct /products route for frontend product selector
from fastapi.responses import JSONResponse
@app.get("/products")
def products():
    import pymysql, os
    try:
        conn = pymysql.connect(
            host=os.getenv("MYSQL_HOST","localhost"),
            port=int(os.getenv("MYSQL_PORT",3306)),
            user=os.getenv("MYSQL_USER"),
            password=os.getenv("MYSQL_PASSWORD"),
            database=os.getenv("MYSQL_DATABASE"),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
        )
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM products ORDER BY name")
            rows = cur.fetchall()
        conn.close()
        return {"products": [r["name"] for r in rows if r.get("name")]}
    except Exception as e:
        return {"products": [], "error": str(e)}

@app.get("/products/{name}")
def product_detail(name: str):
    import pymysql, os
    try:
        conn = pymysql.connect(
            host=os.getenv("MYSQL_HOST","localhost"),
            port=int(os.getenv("MYSQL_PORT",3306)),
            user=os.getenv("MYSQL_USER"),
            password=os.getenv("MYSQL_PASSWORD"),
            database=os.getenv("MYSQL_DATABASE"),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
        )
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM products WHERE name = %s LIMIT 1", (name,))
            row = cur.fetchone()
        conn.close()
        if not row:
            return {"name": name, "description": ""}
        return {k: (str(v) if v is not None else "") for k, v in row.items()}
    except Exception as e:
        return {"name": name, "description": "", "error": str(e)}
