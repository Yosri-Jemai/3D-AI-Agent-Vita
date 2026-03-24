"""
backend/tts/synthesizer.py
==========================
Text-to-Speech via Microsoft Edge TTS.
Langues supportées : Français, Anglais, Arabe uniquement.
"""
import asyncio
import base64
import os
import tempfile

VOICES = {
    "fr": "fr-FR-DeniseNeural",
    "en": "en-US-JennyNeural",
    "ar": "ar-SA-ZariyahNeural",
}
DEFAULT_VOICE = "fr-FR-DeniseNeural"


async def synthesize_async(text: str, lang: str = "fr") -> dict:
    import edge_tts
    voice = VOICES.get(lang, DEFAULT_VOICE)
    print(f"🎙️ Edge TTS: voice={voice}, lang={lang}, chars={len(text)}")

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        out_path = f.name
    try:
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(out_path)
        with open(out_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("utf-8")
        return {"audio_b64": audio_b64, "voice": voice, "lang": lang, "format": "mp3"}
    finally:
        if os.path.exists(out_path):
            os.unlink(out_path)


def synthesize(text: str, lang: str = "fr") -> dict:
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(asyncio.run, synthesize_async(text, lang))
        return future.result()