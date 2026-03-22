# VitalAgent — 3D AI Medical Delegate Training Agent

A voice-enabled AI agent that trains medical delegates on pharmaceutical products.

## Pipeline
Microphone → STT (Whisper large-v3) → RAG (ChromaDB + Ollama) → LLM → TTS → 3D Avatar

## Stack
| Layer | Technology |
|---|---|
| STT | Whisper large-v3 (free, local) |
| RAG | ChromaDB + nomic-embed-text |
| LLM | Ollama (llama3.1 / llama3.2) |
| TTS | Coqui TTS (coming soon) |
| Avatar | Three.js + VRM (coming soon) |
| API | FastAPI |
| DB | MySQL + ChromaDB |

## Setup

```bash
# 1. Clone and enter project
git clone https://github.com/yourname/vital-agent
cd vital-agent

# 2. Create virtual environment
python -m venv venv
venv\Scripts\activate       # Windows
source venv/bin/activate    # Mac/Linux

# 3. Install dependencies
pip install -r backend/requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env with your MySQL credentials

# 5. Install and start Ollama
# Download: https://ollama.com/download
ollama pull llama3.1
ollama pull nomic-embed-text

# 6. Ingest your product data
python scripts/ingest.py

# 7. Start the API
python backend/main.py

# 8. Open frontend
# Open frontend/index.html in browser
```

## Team Structure
| Member | Module |
|---|---|
| - | `backend/rag/` — RAG pipeline (done) |
| - | `backend/stt/` — Whisper STT (done) |
| - | `backend/tts/` — Text to Speech |
| - | `frontend/avatar/` — 3D Avatar |
| - | `frontend/voice/` — Mic UI |

## Git LFS (for 3D avatar files)
```bash
git lfs install
git lfs track "*.glb"
git lfs track "*.vrm"
```
