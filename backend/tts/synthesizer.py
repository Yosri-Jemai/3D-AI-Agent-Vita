"""
backend/tts/synthesizer.py
==========================
TTS intelligent : segmentation contextuelle 100% naturelle
Supports : Français (Denise), Anglais (Jenny), Arabe (Zariyah)
Prononciation fluide comme Google Translate
"""

import asyncio
import base64
import os
import re
import tempfile
from transformers import pipeline

# =====================================
# Chargement du modèle de détection de langue
# =====================================
print("Chargement du modèle de détection de langue...")
lang_classifier = pipeline(
    "text-classification",
    model="papluca/xlm-roberta-base-language-detection",
    top_k=None,
    device=-1  # CPU
)

# =====================================
# Voix TTS
# =====================================
VOICES = {
    "fr": "fr-FR-DeniseNeural",
    "en": "en-US-JennyNeural",
    "ar": "ar-SA-ZariyahNeural",
}

# =====================================
# Fonction : détection langue avec fallback et score
# =====================================
def get_lang_from_model(text_chunk: str, fallback_lang="fr") -> str:
    if not text_chunk.strip():
        return fallback_lang

    # Détection arabe par script (très fiable)
    if re.search(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]', text_chunk):
        return 'ar'

    try:
        results = lang_classifier(text_chunk[:200])
        top = results[0][0]
        lang = top['label']
        score = top['score']

        # Si confiance faible, on utilise fallback
        if score < 0.90:
            return fallback_lang

        if lang in ["fr", "en", "ar"]:
            return lang

        return fallback_lang

    except:
        return fallback_lang

# =====================================
# Fonction : segmentation intelligente
# =====================================
def smart_segment(text: str) -> list[tuple[str, str]]:
    segments = []

    # Découpage en phrases
    sentences = re.split(r'(?<=[.!?])\s+', text)

    for sentence in sentences:
        if not sentence.strip():
            continue

        # langue globale de la phrase
        sentence_lang = get_lang_from_model(sentence)

        words = sentence.split()

        # phrases courtes → direct
        if len(words) <= 6:
            segments.append((sentence, sentence_lang))
            continue

        current_chunk = []
        current_lang = sentence_lang
        i = 0

        while i < len(words):
            # analyser petit groupe de mots (contextuel)
            chunk_test = " ".join(words[i:i+3])
            detected_lang = get_lang_from_model(chunk_test, fallback_lang=sentence_lang)

            # si changement réel
            if detected_lang != current_lang:
                if current_chunk:
                    segments.append((" ".join(current_chunk), current_lang))
                current_chunk = [words[i]]
                current_lang = detected_lang
            else:
                current_chunk.append(words[i])

            i += 1

        if current_chunk:
            segments.append((" ".join(current_chunk), current_lang))

    return segments

# =====================================
# Fonction : synthèse d’un segment en mp3
# =====================================
async def synthesize_segment_async(text: str, lang: str) -> bytes:
    import edge_tts
    voice = VOICES.get(lang, VOICES["fr"])

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        out_path = f.name

    try:
        communicate = edge_tts.Communicate(text.strip(), voice, rate="+10%")
        await communicate.save(out_path)
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(out_path):
            os.unlink(out_path)

# =====================================
# Fonction : TTS asynchrone multi-segments
# =====================================
async def synthesize_async(text: str, lang: str = "auto") -> dict:
    if lang != "auto" and lang in VOICES:
        return await _single_tts(text, lang)

    segments_info = smart_segment(text)

    print(f"🎙️ TTS intelligent → {len(segments_info)} segment(s)")
    for seg_text, seg_lang in segments_info:
        print(f"   [{seg_lang}] {seg_text[:80].strip()}...")

    if len(segments_info) == 1:
        seg_text, seg_lang = segments_info[0]
        return await _single_tts(seg_text, seg_lang)

    audio_parts = []
    segments_meta = []

    for seg_text, seg_lang in segments_info:
        if not seg_text.strip():
            continue
        mp3_bytes = await synthesize_segment_async(seg_text, seg_lang)
        audio_parts.append(mp3_bytes)
        segments_meta.append({"text": seg_text, "lang": seg_lang})

    if not audio_parts:
        return await _single_tts(text, "fr")

    # ajouter pause naturelle entre segments
    silence = b'\x00' * 2000
    combined = silence.join(audio_parts)
    audio_b64 = base64.b64encode(combined).decode("utf-8")

    # Création des timings pour le frontend
    all_words = []
    all_wtimes = []
    all_wdurations = []
    time_offset = 0
    total_duration_est = max(len(combined) / 16000 * 1000, 1000)

    for seg in segments_meta:
        units = seg["text"].strip().split()
        if not units:
            units = [" "]
        seg_dur = total_duration_est * (len(seg["text"]) / max(len(text), 1))
        unit_dur = seg_dur / len(units)

        for w in units:
            all_words.append(w)
            all_wtimes.append(time_offset)
            all_wdurations.append(unit_dur)
            time_offset += unit_dur

    dominant_lang = max(
        set(s["lang"] for s in segments_meta),
        key=lambda l: sum(len(s["text"]) for s in segments_meta if s["lang"] == l)
    )

    return {
        "audio_b64": audio_b64,
        "voice": VOICES.get(dominant_lang, VOICES["fr"]),
        "lang": dominant_lang,
        "format": "mp3",
        "segments": [{"text": s["text"], "lang": s["lang"]} for s in segments_meta],
        "words": all_words,
        "wtimes": all_wtimes,
        "wdurations": all_wdurations
    }

# =====================================
# Fonction : TTS d’un texte entier (simple)
# =====================================
async def _single_tts(text: str, lang: str) -> dict:
    import edge_tts
    voice = VOICES.get(lang, VOICES["fr"])
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        out_path = f.name
    try:
        communicate = edge_tts.Communicate(text, voice, rate="+10%")
        await communicate.save(out_path)
        with open(out_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("utf-8")

        words = text.strip().split()
        duration_est = max(len(audio_b64) / 200, 1000)
        unit_dur = duration_est / max(len(words), 1)

        return {
            "audio_b64": audio_b64,
            "voice": voice,
            "lang": lang,
            "format": "mp3",
            "segments": [{"text": text, "lang": lang}],
            "words": words,
            "wtimes": [i * unit_dur for i in range(len(words))],
            "wdurations": [unit_dur] * len(words)
        }
    finally:
        if os.path.exists(out_path):
            os.unlink(out_path)

# =====================================
# Fonction synchrone pour appeler l’async
# =====================================
def synthesize(text: str, lang: str = "auto") -> dict:
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(asyncio.run, synthesize_async(text, lang))
        return future.result()