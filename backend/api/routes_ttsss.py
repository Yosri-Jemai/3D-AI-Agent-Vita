"""
backend/api/routes_tts.py
==========================
TTS endpoint:
  POST /tts/speak   — text → MP3 audio (base64) via Edge TTS
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class SpeakRequest(BaseModel):
    text: str
    lang: str = "fr"   # "fr", "en", "ar", "de", "es", "it"


@router.post("/speak")
async def speak(req: SpeakRequest):
    """
    Convert text to speech.
    Returns JSON: { audio_b64, voice, lang, format }
    """
    from backend.tts.synthesizer import synthesize_async

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    try:
        result = await synthesize_async(req.text, lang=req.lang)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")
