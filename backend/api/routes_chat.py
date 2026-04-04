"""
backend/api/routes_chat.py
===========================
Chat endpoints:
  GET  /chat/health
  GET  /chat/stats
  GET  /chat/greeting/stream   — opening greeting, streams token by token
  POST /chat/ask
  POST /chat/ask/stream
"""

import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


class QuestionRequest(BaseModel):
    question:  str
    n_results: int = 10
    mode:      str = "medical"   # "medical" or "commercial"


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/stats")
def stats():
    from backend.rag.engine import engine
    try:
        return engine.get_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/greeting/stream")
def greeting_stream():
    """Stream the opening greeting from Dr. Layla."""
    from backend.rag.engine import engine

    def event_generator():
        try:
            for chunk in engine.stream_greeting():
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/ask")
def ask(req: QuestionRequest):
    from backend.rag.engine import engine
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    try:
        return engine.ask(req.question, n_results=req.n_results, mode=req.mode)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ask/stream")
async def ask_stream(req: QuestionRequest):
    from backend.rag.engine import engine
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    def event_generator():
        try:
            for chunk in engine.stream_ask(req.question, n_results=req.n_results, mode=req.mode):
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/products")
def get_products():
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
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/mode-intro/stream")
def mode_intro_stream(mode: str = "medical"):
    """Stream a mode-specific intro message from Vita."""
    from backend.rag.engine import engine
    from fastapi.responses import StreamingResponse

    def event_generator():
        try:
            # stream_greeting yields {"type": "token", "content": ...} then {"type": "done"}
            for chunk in engine.stream_greeting(mode):
                import json
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            import json
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.get("/gammes")
def get_gammes():
    """Retourne la liste des gammes depuis la table catalogues."""
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
            cur.execute("SELECT gamme FROM catalogues ORDER BY gamme")
            rows = cur.fetchall()
        conn.close()
        return {"gammes": [r["gamme"] for r in rows if r.get("gamme")]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))