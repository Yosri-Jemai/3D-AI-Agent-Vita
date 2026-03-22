"""
backend/stt/transcriber.py
==========================
Speech-to-Text using OpenAI Whisper large-v3 (free, runs locally).
Uses faster-whisper for efficient CPU/GPU inference.

Install:
    pip install faster-whisper pyaudio
"""

import os
import io
import tempfile

_model = None

def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        print("Loading Whisper small...")
        _model = WhisperModel(
            "small",
            device="cpu",       # GPU if available, else CPU
            compute_type="int8", # float16 on GPU, int8 on CPU
        )
        print("Whisper ready.")
    return _model


def transcribe_audio_file(audio_bytes: bytes, language: str = None) -> dict:
    """
    Transcribe audio bytes (WAV, MP3, WebM, OGG).
    language: "fr", "en", "ar" or None for auto-detect.
    Returns: { text, language, segments }
    """
    model = get_model()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        segments, info = model.transcribe(
        tmp_path,
        language=language,
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        initial_prompt="Produits médicaux Vital Healthcare: LV PSOCALM, LV Psolcalm, FerBiotic Lipo, Pulmax Kids, Pulmax Anti-Tussif, Pédiakids, Pédiakids trio, Pédiakids Varispray, Pédiakids Apigrip, Pédiakids APITOU, Pédiakids COLIGAZ, Pédiakids Immunovit, Pédiakids Oméga 3, PHYTOFANE, PHYTOFANE Anti Chute, PHYTOFANE Antipelliculaire, PHYTOFANE Fortifiant Phanères, FONGIDERM, FONGIDERM Antifongique, VASELINE Urée, VITONIC, VITONIC Grossesse, OLIGOVIT, OLIGOVIT Trio, Oligovit magnésium, Vitosine Eosine, VITAL HEALTHCARE FERTICARE, VITAL HEALTHCARE SKINCARE, LV GINKO Extra, LV PHYTOVEINE, LV CYSPROTECT, LV Arthroforce, LV Fersang, LV Hemostop, LV Spasvit, LV Vitamine A, LV Vitamine D3, LV Tetra B, LV Sesa, LV Diabemin, LV Phytocalm, LV Mélatonuit, LV Migrainal, LV Normaprost, LV Tabastop, LV Lanorose, LV Crème Dalibour, HYDRAscreen, HYDRAfine, HYDRAVERA, HYDRA GEL, Hydra eau micellaire, Planthérapie Allergiplant, Planthérapie Planthiol, Planthérapie Plantexil, Plantex, Plantalgic, Plantyl, Angiplant, Rhinoplant, MULTIBON SOMMEIL, MULTIBON VITAMINE C Acérola, MULTIBON CALCIUM, MULTIBON OMEGA 3, MULTIBON APIGORGE, MULTIBON IMMUNITÉ, SWEET slim, SWEET health fer, SWEET bronzage, Minciligne, Minciligne Postnatale, Minciligne Homme, Mincivit, Mincivit Detox, Mincicare, Omevie Omega 3, Omevie Articulation, Omevie Cardio, Omevie Grossesse, Dermacné, Dermagyn, DermaGyn, Dermalo, DERMADOUCE, Dermasoufre, ARGIDERM, Uniderme, Uniderm, Grossivit, Grossivit vitaminé, Gelée Royale, Spiruline, Millepertuis, Guarana, Coenzyme Q10, Phytofibres, Phytodraine, LiftCaféine, TC 2000, CALMO dent, Ventre Plat, Ventre Ultra Plat, Levure de Riz Rouge, Levure de bière, Pectine de pomme, Lécithine de Soja, Vinaigre de cidre, Pollen d'abeilles, Stimul plus",
        )

        full_text    = []
        segment_list = []
        for seg in segments:
            full_text.append(seg.text.strip())
            segment_list.append({
                "start": round(seg.start, 2),
                "end":   round(seg.end, 2),
                "text":  seg.text.strip(),
            })

        return {
            "text":     " ".join(full_text),
            "language": info.language,
            "segments": segment_list,
        }
    finally:
        os.unlink(tmp_path)


def transcribe_microphone(duration_seconds: int = 5, language: str = None) -> dict:
    """
    Record from microphone and transcribe.
    Requires: pip install pyaudio
    """
    try:
        import pyaudio
        import wave
    except ImportError:
        raise ImportError("Run: pip install pyaudio")

    CHUNK    = 1024
    FORMAT   = pyaudio.paInt16
    CHANNELS = 1
    RATE     = 16000

    audio  = pyaudio.PyAudio()
    stream = audio.open(format=FORMAT, channels=CHANNELS,
                        rate=RATE, input=True, frames_per_buffer=CHUNK)

    print(f"Recording {duration_seconds}s...")
    frames = [stream.read(CHUNK) for _ in range(int(RATE / CHUNK * duration_seconds))]
    stream.stop_stream()
    stream.close()
    audio.terminate()

    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(audio.get_sample_size(FORMAT))
        wf.setframerate(RATE)
        wf.writeframes(b''.join(frames))

    return transcribe_audio_file(buf.getvalue(), language=language)


if __name__ == "__main__":
    result = transcribe_microphone(duration_seconds=5)
    print(f"Transcribed: {result['text']}")
    print(f"Language:    {result['language']}")
