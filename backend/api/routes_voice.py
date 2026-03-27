"""
backend/api/routes_voice.py
============================
Voice endpoints:
  POST /voice/transcribe   — audio file → text (Whisper large-v3)
  POST /voice/ask          — audio file → transcribe → RAG → text answer
  POST /voice/ask/stream   — audio file → transcribe → RAG → streamed answer
"""

import json
from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import StreamingResponse

router = APIRouter()


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form(default=None),
):
    """
    Upload an audio file, get back the transcribed text.
    Accepts: WAV, MP3, WebM, OGG
    """
    from backend.stt.transcriber import transcribe_audio_file

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    try:
        result = transcribe_audio_file(audio_bytes, language=language)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ask")
async def voice_ask(
    audio: UploadFile = File(...),
    language: str = Form(default=None),
    n_results: int = Form(default=10),
    mode: str = Form(default="medical"),
):
    """
    Full voice pipeline:
      audio → STT (Whisper) → RAG (ChromaDB + LLM) → text answer
    """
    from backend.stt.transcriber import transcribe_audio_file
    from backend.rag.engine import engine

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    # Step 1: transcribe
    stt_result = transcribe_audio_file(audio_bytes, language=language)
    question   = stt_result["text"]

    if not question.strip():
        raise HTTPException(status_code=400, detail="Could not transcribe audio")

    # Step 2: RAG
    rag_result = engine.ask(question, n_results=n_results, mode=mode)

    return {
        "question": question,
        "language": stt_result["language"],
        **rag_result,
    }


@router.post("/ask/stream")
async def voice_ask_stream(
    audio: UploadFile = File(...),
    language: str = Form(default=None),
    n_results: int = Form(default=10),
    mode: str = Form(default="medical"),
):
    """
    Full voice pipeline with streamed answer.
    First SSE event contains the transcribed question.
    """
    from backend.stt.transcriber import transcribe_audio_file
    from backend.rag.engine import engine

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    stt_result = transcribe_audio_file(audio_bytes, language=language)
    question   = stt_result["text"]

    if not question.strip():
        raise HTTPException(status_code=400, detail="Could not transcribe audio")

    def event_generator():
        # Send transcription first so UI can show what was heard
        yield f"data: {json.dumps({'type': 'transcript', 'text': question, 'language': stt_result['language']})}\n\n"

        try:
            for chunk in engine.stream_ask(question, n_results=n_results, mode=mode):
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
