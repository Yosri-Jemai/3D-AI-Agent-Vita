import json
import re
import random
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter()

class QuizCommercialRequest(BaseModel):
    product: Optional[str] = None
    products: Optional[List[str]] = None
    difficulty: str = "moyen"
    question_count: int = 10

class FeedbackRequest(BaseModel):
    question: str
    product: str
    sales_skill: str
    chosen: str
    correct: str
    explanation: str
    is_correct: bool


# ── Nettoyage du contexte ─────────────────────────────────────────────────────
def clean_context(text: str, product_name: str) -> str:
    lines = text.splitlines()
    clean_lines = []
    skip_patterns = [
        r"^code[_\s]article\s*:.*$", r"^id\s*:.*$", r"^source[_\s]id\s*:.*$",
        r"^\[source\s+\d+", r"^\s*\d{3,}\s*$", r"code article\s*:\s*\d+",
    ]
    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue
        skip = any(re.search(pat, line_stripped, re.IGNORECASE) for pat in skip_patterns)
        if not skip:
            line_stripped = re.sub(r'\b\d{3,}\b', '', line_stripped).strip()
            if line_stripped:
                clean_lines.append(line_stripped)
    cleaned = "\n".join(clean_lines)
    return cleaned[:1200]


# ── Prompt système pour la génération des questions ───────────────────────────
QUIZ_COMMERCIAL_SYSTEM_PROMPT = """Tu es un coach en vente pharmaceutique chez VITAL SA.
Ta mission : créer des QCM pour évaluer les compétences commerciales des délégués.
RÈGLES ABSOLUES : Utilise uniquement le nom commercial du produit. Réponds UNIQUEMENT en JSON valide."""

# ── Angles commerciaux ────────────────────────────────────────────────────────
COMMERCIAL_ANGLES = [
    "l'argument de vente principal", "le pitch en 30 secondes", "gestion de l'objection prix",
    "différenciation vs concurrence", "profil client idéal", "conseil au comptoir",
    "technique FAB", "closing de la vente", "gestion d'objection concurrence",
]

# ── Construction du prompt question ───────────────────────────────────────────
def build_commercial_question_prompt(product_name: str, context: str, difficulty: str, angle: str = None) -> str:
    difficulty_guide = {
        "facile": "Questions simples sur les arguments de base et le pitch.",
        "moyen": "Gestion des objections courantes et technique FAB.",
        "difficile": "Scénarios complexes avec pharmacien réticent ou négociation.",
    }
    guide = difficulty_guide.get(difficulty, difficulty_guide["moyen"])
    angle_instruction = f"\nFOCUS : {angle}" if angle else ""

    return f"""Tu évalues les compétences commerciales sur le produit {product_name}.

INFORMATIONS PRODUIT :
{context}

NIVEAU : {difficulty.upper()} {guide}{angle_instruction}

Génère **exactement 1 question QCM** au format JSON suivant :

{{
  "question": "Scénario réaliste de vente avec un pharmacien sur {product_name} ?",
  "choices": [
    "Meilleure réponse commerciale et professionnelle",
    "Réponse plausible mais moins efficace",
    "Réponse incorrecte ou maladroite",
    "Réponse contre-productive"
  ],
  "correct_index": 0,
  "explanation": "Explication courte de pourquoi c'est la meilleure approche (1-2 phrases).",
  "product": "{product_name}",
  "sales_skill": "Nom court de la compétence (ex: Pitch, Objection prix, FAB)"
}}

Règles :
- Toujours le nom exact du produit
- Bonne réponse en position 0 au départ
- Toutes les réponses doivent avoir une longueur similaire

Génère maintenant :"""

# ── Génération d'une question ─────────────────────────────────────────────────
async def generate_one_commercial_question(engine, product_name: str, context: str, difficulty: str, angle: str = None) -> Optional[dict]:
    from langchain_core.messages import SystemMessage, HumanMessage
    clean_ctx = clean_context(context, product_name)
    if not clean_ctx.strip():
        return None

    prompt = build_commercial_question_prompt(product_name, clean_ctx, difficulty, angle)
    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: engine.llm.invoke([
                SystemMessage(content=QUIZ_COMMERCIAL_SYSTEM_PROMPT),
                HumanMessage(content=prompt)
            ])
        )
        raw = response.content.strip()
        q = _safe_parse_one(raw)
        if not _is_valid_commercial_question(q, product_name):
            return None
        q = _sanitize_question(q)
        q = _shuffle_correct_position(q)
        return q
    except Exception as e:
        print(f"[QuizCommercial] Erreur pour {product_name}: {e}")
        return None


# ── Distribution des tâches ───────────────────────────────────────────────────
def _build_commercial_task_list(hits: dict, count: int) -> list:
    products = list(hits.keys())
    if not products:
        return []

    angles = COMMERCIAL_ANGLES[:]
    random.shuffle(angles)
    while len(angles) < count:
        extra = COMMERCIAL_ANGLES[:]
        random.shuffle(extra)
        angles.extend(extra)

    tasks = []
    if len(products) == 1:
        pname = products[0]
        context = hits[pname]
        for i in range(count):
            tasks.append((pname, context, angles[i]))
    else:
        random.shuffle(products)
        for i in range(count):
            pname = products[i % len(products)]
            context = hits[pname]
            tasks.append((pname, context, angles[i]))
    return tasks


def _resolve_hits(engine, req: QuizCommercialRequest) -> dict:
    selected = req.products or ([req.product] if req.product else [])
    if selected:
        return _fetch_selected_products(engine, selected)
    return _fetch_all_products(engine)


# ── Endpoints génération ─────────────────────────────────────────────────────
@router.post("/generate/stream")
async def generate_commercial_quiz_stream(req: QuizCommercialRequest):
    from backend.rag.engine import engine
    engine.initialize()

    count = min(max(req.question_count, 5), 15)
    hits = _resolve_hits(engine, req)

    if not hits:
        async def error_gen():
            yield f'data: {json.dumps({"type": "error", "message": "Aucun produit trouvé"})}\n\n'
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    task_list = _build_commercial_task_list(hits, count)

    async def event_generator():
        yield f'data: {json.dumps({"type": "loading", "total": len(task_list)})}\n\n'
        tasks = [generate_one_commercial_question(engine, pname, ctx, req.difficulty, angle) 
                 for pname, ctx, angle in task_list]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        questions = [r for r in results if isinstance(r, dict) and r]

        for result in questions:
            yield f"data: {json.dumps({'type': 'question', 'question': result, 'total': len(task_list)}, ensure_ascii=False)}\n\n"

        yield f'data: {json.dumps({"type": "done", "count": len(questions)})}\n\n'

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ══════════════════════════════════════════════════════════════════════════════
# FEEDBACK FINAL COURT (3 lignes maximum) - Identique en style au médical
# ══════════════════════════════════════════════════════════════════════════════

_FINAL_FEEDBACK_SYSTEM = """Tu es Vita, coach experte en vente pharmaceutique chez VITAL SA.

Génère un bilan **très court** (maximum 3 lignes).

Commence TOUJOURS par la ligne du score :

- Score parfait (100%) : "Score [X]/[X] (100%). Parfait ! Vous maîtrisez très bien les produits. Continuez comme ça !"
- Score < 100% : "Score [X]/[Y] ([Z]%). Lacunes sur [compétence courte] de [produit]. Reprenez les arguments de [produits ratés]. [Encouragement court.]"

RÈGLES STRICTES :
- Maximum 3 lignes au total
- Première ligne = score obligatoire
- Langage direct, professionnel et motivant
- Pas de liste, pas de puce, pas de titre
- Prose fluide en français"""

@router.post("/feedback/final/stream")
async def stream_final_feedback_commercial(req: dict):
    from backend.rag.engine import engine
    from langchain_core.messages import SystemMessage, HumanMessage
    engine.initialize()

    score = req.get("score", 0)
    total = req.get("total", 0)
    history = req.get("history", [])
    pct = round((score / total) * 100) if total > 0 else 0

    # Résumé rapide des lacunes
    bad_products = [h.get("product", "?") for h in history if not h.get("ok")]
    bad_skills = [h.get("sales_skill", "vente") for h in history if not h.get("ok")]

    if bad_products:
        prompt = (f"Score : {score}/{total} ({pct}%)\n"
                  f"Produits faibles : {', '.join(set(bad_products))}\n"
                  f"Compétences à revoir : {', '.join(set(bad_skills))[:80]}\n\n"
                  f"Génère un bilan très court en suivant exactement les règles ci-dessus (max 3 lignes).")
    else:
        prompt = (f"Score : {score}/{total} (100%)\n"
                  f"Tous les produits maîtrisés\n\n"
                  f"Génère un bilan très court en suivant exactement les règles ci-dessus (max 3 lignes).")

    async def gen():
        try:
            for chunk in engine.llm.stream([
                SystemMessage(content=_FINAL_FEEDBACK_SYSTEM),
                HumanMessage(content=prompt)
            ]):
                if chunk.content:
                    yield f"data: {json.dumps({'type': 'token', 'content': chunk.content}, ensure_ascii=False)}\n\n"
            yield f'data: {json.dumps({"type": "done"})}\n\n'
        except Exception as e:
            yield f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Utilitaires (parse, sanitize, fetch...) ───────────────────────────────────
def _fetch_selected_products(engine, product_names: List[str]) -> dict:
    wanted = {name.strip().lower(): name.strip() for name in product_names}
    result = {original: "" for original in wanted.values()}
    try:
        all_docs = engine.collection.get(include=["documents", "metadatas"])
        for doc, meta in zip(all_docs.get("documents", []), all_docs.get("metadatas", [])):
            pname = meta.get("product_name", "") or meta.get("name", "")
            if pname.strip().lower() in wanted and meta.get("source_table") not in ("doc", "annimation_fiches"):
                result[wanted[pname.strip().lower()]] += "\n" + doc
    except Exception as e:
        print(f"[QuizCommercial] Fetch error: {e}")

    for k in list(result.keys()):
        if not result[k].strip():
            del result[k]
        else:
            result[k] = result[k][:1500]
    return result


def _fetch_all_products(engine) -> dict:
    result = {}
    try:
        all_docs = engine.collection.get(include=["documents", "metadatas"])
        for doc, meta in zip(all_docs.get("documents", []), all_docs.get("metadatas", [])):
            pname = (meta.get("product_name", "") or meta.get("name", "")).strip()
            if pname and len(pname) >= 3 and meta.get("source_table") not in ("doc", "annimation_fiches"):
                result[pname] = result.get(pname, "") + "\n" + doc
    except Exception:
        pass

    for pname in list(result.keys()):
        if len(result[pname]) > 1500:
            result[pname] = result[pname][:1500]
    return result


def _safe_parse_one(raw: str) -> Optional[dict]:
    raw = re.sub(r'```json\s*|\s*```', '', raw).strip()
    try:
        return json.loads(raw)
    except:
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            try:
                return json.loads(match.group(0))
            except:
                pass
    return None


def _sanitize_question(q: dict) -> dict:
    return q


def _shuffle_correct_position(q: dict) -> dict:
    choices = q.get("choices", [])
    correct_idx = q.get("correct_index", 0)
    if len(choices) != 4:
        return q
    correct = choices[correct_idx]
    wrongs = [c for i, c in enumerate(choices) if i != correct_idx]
    random.shuffle(wrongs)
    pos = random.randint(0, 3)
    new_choices = wrongs[:]
    new_choices.insert(pos, correct)
    return {**q, "choices": new_choices, "correct_index": pos}


def _is_valid_commercial_question(q: Optional[dict], expected_product: str) -> bool:
    if not q or len(q.get("choices", [])) != 4:
        return False
    return expected_product.lower() in str(q.get("question", "")).lower()