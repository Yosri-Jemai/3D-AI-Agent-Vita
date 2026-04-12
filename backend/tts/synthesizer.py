"""
backend/tts/synthesizer.py
==========================
TTS simple et rapide – sans transformers, sans torch
Détection de langue : langdetect (local, < 1s)
Voix : edge-tts  (Denise FR · Jenny EN · Zariyah AR)

✅ LIPSYNC AMÉLIORÉ :
  Les timestamps de mots sont extraits directement depuis edge-tts
  via les événements WordBoundary → synchronisation précise à la ms.

Cas spécial arabe mixte :
  Les mots scientifiques/français insérés dans une réponse arabe
  sont regroupés et lus par la voix française (Denise), puis on
  revient à la voix arabe (Zariyah).
"""

import asyncio
import base64
import os
import re
import tempfile

VOICES = {
    "fr": "fr-FR-DeniseNeural",
    "en": "en-US-JennyNeural",
    "ar": "ar-SA-ZariyahNeural",
}

def clean_for_tts(text: str) -> str:
    text = re.sub(r'\*{1,3}([^*\n]+?)\*{1,3}', r'\1', text)
    text = re.sub(r'^\s*([*\-––•◦▪›»]|[0-9٠-٩]+[.\)]|[٠-٩]+\.?)\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = text.replace('*', '')
    text = re.sub(r'_([^_]+)_', r'\1', text)
    text = re.sub(r'^[\-=*_]{3,}\s*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def detect_lang(text: str, fallback: str = "fr") -> str:
    if not text or not text.strip():
        return fallback
    arabic_chars = len(re.findall(r'[\u0600-\u06FF]', text))
    latin_chars  = len(re.findall(r'[A-Za-z]', text))
    if arabic_chars > latin_chars:
        return "ar"
    try:
        from langdetect import detect
        lang = detect(text.strip())
        return lang if lang in ("fr", "en", "ar") else fallback
    except Exception:
        return fallback


def _is_latin_token(token: str) -> bool:
    return bool(re.search(r'[A-Za-zÀ-ÿ]', token))


def split_arabic_latin(text: str) -> list[tuple[str, str]]:
    tokens = text.split()
    segments = []
    current_tokens = []
    current_type = None

    for token in tokens:
        if not token.strip():
            continue
        token_type = "fr" if _is_latin_token(token) else "ar"

        if token_type == current_type:
            current_tokens.append(token)
        else:
            if current_tokens and current_type:
                chunk = " ".join(current_tokens).strip()
                if chunk:
                    segments.append((chunk, current_type))
            current_tokens = [token]
            current_type   = token_type

    if current_tokens and current_type:
        chunk = " ".join(current_tokens).strip()
        if chunk:
            segments.append((chunk, current_type))

    return segments if segments else [(text.strip(), "ar")]


# ✅ NOUVEAU : Synthèse avec timestamps réels (WordBoundary events)
async def _synth_segment_with_timing(text: str, lang: str) -> tuple[bytes, list, list, list]:
    """
    Synthétise un segment et retourne :
      - mp3_bytes   : l'audio MP3
      - words       : liste des mots
      - wtimes      : timestamp de début de chaque mot (ms)
      - wdurations  : durée de chaque mot (ms)

    Les timestamps viennent des événements WordBoundary d'edge-tts,
    ce qui donne une synchronisation précise à la milliseconde.
    """
    import edge_tts

    voice = VOICES.get(lang, VOICES["fr"])
    comm  = edge_tts.Communicate(text.strip(), voice, rate="+10%")

    audio_chunks: list[bytes] = []
    words:        list[str]   = []
    wtimes:       list[float] = []
    wdurations:   list[float] = []

    async for event in comm.stream():
        if event["type"] == "audio":
            audio_chunks.append(event["data"])

        elif event["type"] == "WordBoundary":
            # offset et duration sont en « ticks » (100 ns chacun) → convertir en ms
            offset_ms   = event["offset"]   / 10_000
            duration_ms = event["duration"] / 10_000
            word        = event["text"]

            words.append(word)
            wtimes.append(offset_ms)
            wdurations.append(duration_ms)

    mp3_bytes = b"".join(audio_chunks)

    # Fallback si edge-tts n'a pas émis de WordBoundary
    if not words and mp3_bytes:
        print(f"⚠️  Pas de WordBoundary pour [{lang}], fallback estimation")
        words, wtimes, wdurations = _fallback_timings(text, len(mp3_bytes))

    return mp3_bytes, words, wtimes, wdurations


def _fallback_timings(text: str, mp3_size_bytes: int) -> tuple[list, list, list]:
    """
    Estime les timings à partir de la taille du fichier MP3.
    Utilisé uniquement quand edge-tts ne retourne pas de WordBoundary.
    Bitrate MP3 edge-tts ≈ 128 kbps → 16 000 bytes/s
    """
    words = text.strip().split()
    if not words:
        return [], [], []
    duration_ms = max((mp3_size_bytes / 16_000) * 1000, 500)
    unit_dur    = duration_ms / len(words)
    wtimes      = [i * unit_dur for i in range(len(words))]
    wdurations  = [unit_dur] * len(words)
    return words, wtimes, wdurations


async def synthesize_async(text: str, lang: str = "auto") -> dict:
    text = clean_for_tts(text)
    if not text:
        return {"audio_b64": "", "voice": VOICES["fr"], "lang": "fr",
                "format": "mp3", "segments": [], "words": [], "wtimes": [], "wdurations": []}

    detected = detect_lang(text) if lang == "auto" or lang not in VOICES else lang

    # Cas arabe avec mots latins → segments mixtes
    if detected == "ar" and re.search(r'[A-Za-z]{2,}', text):
        segments = split_arabic_latin(text)

        print(f"🎙️ TTS arabe mixte -> {len(segments)} segment(s)")
        for seg_text, seg_lang in segments:
            print(f"   [{seg_lang}] {seg_text[:70]}")

        all_mp3:        list[bytes] = []
        all_words:      list[str]   = []
        all_wtimes:     list[float] = []
        all_wdurations: list[float] = []
        offset_ms = 0.0

        for seg_text, seg_lang in segments:
            if not seg_text.strip():
                continue
            mp3, words, wtimes, wdurations = await _synth_segment_with_timing(seg_text, seg_lang)
            all_mp3.append(mp3)

            # Décaler les timestamps de ce segment par rapport aux précédents
            for w, t, d in zip(words, wtimes, wdurations):
                all_words.append(w)
                all_wtimes.append(t + offset_ms)
                all_wdurations.append(d)

            # Calculer la durée réelle de ce segment pour l'offset suivant
            if wtimes and wdurations:
                seg_duration = wtimes[-1] + wdurations[-1]
            else:
                seg_duration = max((len(mp3) / 16_000) * 1000, 100)
            offset_ms += seg_duration

        if not all_mp3:
            mp3, all_words, all_wtimes, all_wdurations = await _synth_segment_with_timing(text, "ar")
            all_mp3 = [mp3]

        combined  = b"".join(all_mp3)
        audio_b64 = base64.b64encode(combined).decode("utf-8")

        return {
            "audio_b64":  audio_b64,
            "voice":      VOICES["ar"],
            "lang":       "ar",
            "format":     "mp3",
            "segments":   [{"text": t, "lang": l} for t, l in segments],
            "words":      all_words,
            "wtimes":     all_wtimes,
            "wdurations": all_wdurations,
        }

    # Cas simple FR / EN / AR pur
    print(f"🎙️ TTS simple [{detected}] -> {text[:70]}")
    mp3_bytes, words, wtimes, wdurations = await _synth_segment_with_timing(text, detected)
    audio_b64 = base64.b64encode(mp3_bytes).decode("utf-8")

    return {
        "audio_b64":  audio_b64,
        "voice":      VOICES[detected],
        "lang":       detected,
        "format":     "mp3",
        "segments":   [{"text": text, "lang": detected}],
        "words":      words,
        "wtimes":     wtimes,
        "wdurations": wdurations,
    }


def synthesize(text: str, lang: str = "auto") -> dict:
    """Point d'entrée synchrone."""
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(asyncio.run, synthesize_async(text, lang))
        return future.result()