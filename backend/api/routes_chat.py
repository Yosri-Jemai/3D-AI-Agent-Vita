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

    if mode == "medical":
        prompt = """You are Vita, a medical product training coach for a pharmaceutical company.
A delegate just chose medical training mode. 
Introduce yourself warmly as Vita, explain briefly what you will help them with (product indications, composition, clinical use, medical terminology, what to say to doctors and pharmacists).
End by asking them to select a product to get started.
Be professional and warm. 3-4 sentences max. Respond in French."""
# Commercial mode intro
    elif mode == "vita_commercial":
        prompt = """You are Vita, a pharmaceutical delegate from VITAL SA.
    You are about to have a natural conversation with a doctor.

    Start with a warm, brief introduction: state your name and role.
    Then ask the doctor which product they would like to discuss today.
    Be open-ended: the doctor can name a product, ask for a suggestion, or ask a general question.
    Keep it to 2-3 sentences, warm and professional.

    Respond in French initially, but be ready to switch to English or Arabic based on the doctor's language."""
    else:
        prompt = """You are Vita, a pharmaceutical sales training coach for a pharmaceutical company.
A delegate just chose commercial training mode.
Introduce yourself with energy as Vita, explain briefly what you will help them with (sales pitches, objection handling, convincing pharmacies and clinics, competitive positioning).
End by asking them to select a product to get started.
Be motivating and enthusiastic. 3-4 sentences max. Respond in French."""

    def event_generator():
        try:
            engine.initialize()
            for token in engine.llm.stream(prompt):
                import json
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
        except Exception as e:
            import json
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            import json
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )