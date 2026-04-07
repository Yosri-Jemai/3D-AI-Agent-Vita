"""
backend/tts/synthesizer.py
==========================
TTS simple et rapide — sans transformers, sans torch
Détection de langue : langdetect (local, < 1s)
Voix : edge-tts  (Denise FR · Jenny EN · Zariyah AR)

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

# ─────────────────────────────────────────────────────────────
# Voix edge-tts
# ─────────────────────────────────────────────────────────────
VOICES = {
    "fr": "fr-FR-DeniseNeural",
    "en": "en-US-JennyNeural",
    "ar": "ar-SA-ZariyahNeural",
}

# ─────────────────────────────────────────────────────────────
# Nettoyage du texte avant TTS (supprime le markdown)
# ─────────────────────────────────────────────────────────────
def clean_for_tts(text: str) -> str:
    """
    Supprime les symboles markdown qui seraient lus à voix haute
    par edge-tts — fonctionne pour FR, EN et AR.
    """
    # Gras/italique : **texte** ou *texte* → texte  (avant de toucher aux *)
    text = re.sub(r'\*{1,3}([^*\n]+?)\*{1,3}', r'\1', text)
    # Puces universelles en début de ligne : * - – — • ◦ ▪ › » et chiffres arabes ١. ٢.
    text = re.sub(r'^\s*([*\-–—•◦▪›»]|[0-9٠-٩]+[.\)]|[٠-٩]+\.?)\s+', '', text, flags=re.MULTILINE)
    # Titres markdown : ## Titre → Titre
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    # Backticks : `code` → code
    text = re.sub(r'`([^`]+)`', r'\1', text)
    # Astérisques isolés restants
    text = text.replace('*', '')
    # Underscores italiques : _texte_ → texte
    text = re.sub(r'_([^_]+)_', r'\1', text)
    # Tirets de séparation (---  ===  ***) → rien
    text = re.sub(r'^[\-=*_]{3,}\s*$', '', text, flags=re.MULTILINE)
    # Lignes vides multiples → une seule
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# ─────────────────────────────────────────────────────────────
# Détection de langue dominante
# ─────────────────────────────────────────────────────────────
def detect_lang(text: str, fallback: str = "fr") -> str:
    if not text or not text.strip():
        return fallback
    # Comparer les caractères arabes vs latins
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


# ─────────────────────────────────────────────────────────────
# Segmentation token par token (arabe vs latin)
# ─────────────────────────────────────────────────────────────
def _is_latin_token(token: str) -> bool:
    """True si le token contient des lettres latines (mot FR/EN scientifique)."""
    return bool(re.search(r'[A-Za-zÀ-ÿ]', token))


def split_arabic_latin(text: str) -> list[tuple[str, str]]:
    """
    Découpe le texte mot par mot et regroupe les séquences consécutives
    de même type (arabe ou latin) en un seul segment.

    Exemple :
      "يحتوي على Acide salicylique وهو متوفر"
      -> [("يحتوي على", "ar"), ("Acide salicylique", "fr"), ("وهو متوفر", "ar")]
    """
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

    # Dernier groupe
    if current_tokens and current_type:
        chunk = " ".join(current_tokens).strip()
        if chunk:
            segments.append((chunk, current_type))

    return segments if segments else [(text.strip(), "ar")]


# ─────────────────────────────────────────────────────────────
# Synthèse d'un seul segment audio
# ─────────────────────────────────────────────────────────────
async def _synth_segment(text: str, lang: str) -> bytes:
    import edge_tts
    voice = VOICES.get(lang, VOICES["fr"])
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        out_path = f.name
    try:
        comm = edge_tts.Communicate(text.strip(), voice, rate="+10%")
        await comm.save(out_path)
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(out_path):
            os.unlink(out_path)


# ─────────────────────────────────────────────────────────────
# Estimation des timings pour le lipsync
# ─────────────────────────────────────────────────────────────
def _estimate_timings(text: str, audio_b64: str) -> tuple[list, list, list]:
    words = text.strip().split()
    if not words:
        return [], [], []
    audio_bytes = len(audio_b64) * 3 / 4
    duration_ms = max((audio_bytes / 16000) * 1000, 500)
    unit_dur    = duration_ms / len(words)
    wtimes      = [i * unit_dur for i in range(len(words))]
    wdurations  = [unit_dur] * len(words)
    return words, wtimes, wdurations


# ─────────────────────────────────────────────────────────────
# Synthèse principale (async)
# ─────────────────────────────────────────────────────────────
async def synthesize_async(text: str, lang: str = "auto") -> dict:
    # 0. Nettoyer le markdown avant toute synthèse
    text = clean_for_tts(text)
    if not text:
        return {"audio_b64": "", "voice": VOICES["fr"], "lang": "fr",
                "format": "mp3", "segments": [], "words": [], "wtimes": [], "wdurations": []}

    # 1. Détecter la langue dominante
    detected = detect_lang(text) if lang == "auto" or lang not in VOICES else lang

    # 2. Cas arabe avec mots latins -> segments mixtes
    if detected == "ar" and re.search(r'[A-Za-z]{2,}', text):
        segments = split_arabic_latin(text)

        print(f"🎙️ TTS arabe mixte -> {len(segments)} segment(s)")
        for seg_text, seg_lang in segments:
            print(f"   [{seg_lang}] {seg_text[:70]}")

        audio_parts: list[bytes] = []
        for seg_text, seg_lang in segments:
            if not seg_text.strip():
                continue
            mp3 = await _synth_segment(seg_text, seg_lang)
            audio_parts.append(mp3)

        if not audio_parts:
            mp3 = await _synth_segment(text, "ar")
            audio_parts = [mp3]

        combined  = b"".join(audio_parts)
        audio_b64 = base64.b64encode(combined).decode("utf-8")
        words, wtimes, wdurations = _estimate_timings(text, audio_b64)

        return {
            "audio_b64":  audio_b64,
            "voice":      VOICES["ar"],
            "lang":       "ar",
            "format":     "mp3",
            "segments":   [{"text": t, "lang": l} for t, l in segments],
            "words":      words,
            "wtimes":     wtimes,
            "wdurations": wdurations,
        }

    # 3. Cas simple FR / EN / AR pur
    print(f"🎙️ TTS simple [{detected}] -> {text[:70]}")
    mp3_bytes = await _synth_segment(text, detected)
    audio_b64 = base64.b64encode(mp3_bytes).decode("utf-8")
    words, wtimes, wdurations = _estimate_timings(text, audio_b64)

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


# ─────────────────────────────────────────────────────────────
# Interface synchrone
# ─────────────────────────────────────────────────────────────
def synthesize(text: str, lang: str = "auto") -> dict:
    """Point d'entrée synchrone."""
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(asyncio.run, synthesize_async(text, lang))
        return future.result()