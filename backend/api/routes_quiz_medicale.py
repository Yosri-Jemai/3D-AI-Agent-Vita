"""
backend/api/routes_quiz_medicale.py
====================================
Quiz endpoints — VERSION REFONTE COMPLÈTE
Corrections :
  1. Génération en parallèle (asyncio)
  2. Prompt renforcé → questions pédagogiques, jamais de codes/IDs
  3. Contexte nettoyé → suppression codes articles, IDs numériques
  4. [FIX] 1 produit sélectionné → N questions UNIQUEMENT sur ce produit
  5. [FIX] Multi-produits → questions UNIQUEMENT sur les produits sélectionnés
"""

import json
import re
import random
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter()

class QuizRequest(BaseModel):
    product: Optional[str] = None
    products: Optional[List[str]] = None
    difficulty: str = "moyen"
    question_count: int = 10


def clean_context(text: str, product_name: str) -> str:
    lines = text.splitlines()
    clean_lines = []
    skip_patterns = [
        r"^code[_\s]article\s*:.*$",
        r"^id\s*:.*$",
        r"^source[_\s]id\s*:.*$",
        r"^\[source\s+\d+",
        r"^\s*\d{3,}\s*$",
        r"code article\s*:\s*\d+",
    ]
    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue
        skip = False
        for pat in skip_patterns:
            if re.search(pat, line_stripped, re.IGNORECASE):
                skip = True
                break
        if not skip:
            line_stripped = re.sub(r'\b\d{3,}\b', '', line_stripped).strip()
            if line_stripped:
                clean_lines.append(line_stripped)
    cleaned = "\n".join(clean_lines)
    return cleaned[:1200]


QUIZ_SYSTEM_PROMPT = """Tu es un formateur expert chez VITAL SA, spécialisé dans la formation des délégués médicaux.

Ta mission : créer des QCM pour ÉVALUER les connaissances d'un délégué médical sur les produits.
Le délégué répond à tes questions pour prouver qu'il maîtrise le produit avant d'aller voir les médecins.

RÈGLES ABSOLUES :
1. Utilise UNIQUEMENT le nom commercial du produit — JAMAIS de codes, IDs ou numéros
2. La question teste ce qu'un délégué doit savoir : indications, posologie, composition, mécanisme, contre-indications
3. Les réponses doivent être précises et professionnelles
4. Réponds UNIQUEMENT avec du JSON valide. Zéro texte avant ou après.
"""

QUESTION_ANGLES = [
    "les indications principales et la population cible",
    "la posologie et le mode d'administration",
    "la composition et les principes actifs",
    "le mécanisme d'action",
    "les contre-indications absolues et relatives",
    "les effets indésirables les plus fréquents",
    "les interactions médicamenteuses importantes",
    "les conseils pratiques à donner au patient",
    "la forme galénique et la présentation",
    "les avantages par rapport aux alternatives thérapeutiques",
    "les précautions d'emploi particulières",
    "la durée de traitement recommandée",
    "les populations à risque (personnes âgées, enfants, femmes enceintes)",
    "les conditions de conservation et de stockage",
    "les différences entre les dosages disponibles",
]


def build_question_prompt(product_name: str, context: str, difficulty: str, angle: str = None) -> str:
    difficulty_guide = {
        "facile": "Teste les indications principales, la forme galénique et la population cible.",
        "moyen": "Teste la posologie, le mécanisme d'action, les conseils pratiques et la composition.",
        "difficile": "Teste les contre-indications, les interactions médicamenteuses et les cas cliniques complexes.",
    }
    guide = difficulty_guide.get(difficulty, difficulty_guide["moyen"])
    angle_instruction = f"\nFOCUS OBLIGATOIRE : teste spécifiquement {angle}." if angle else ""

    return f"""Tu évalues les connaissances d'un délégué médical sur le produit {product_name}.

INFORMATIONS SUR LE PRODUIT :
{context}

NIVEAU DE DIFFICULTÉ : {difficulty.upper()}
{guide}{angle_instruction}

GÉNÈRE exactement 1 question QCM selon ce format JSON :

{{
  "question": "Question directe testant ce que le délégué doit savoir sur {product_name} ?",
  "choices": [
    "Réponse A complète et précise",
    "Réponse B plausible mais incorrecte",
    "Réponse C plausible mais incorrecte",
    "Réponse D plausible mais incorrecte"
  ],
  "correct_index": 0,
  "explanation": "Explication pédagogique en 1-2 phrases.",
  "product": "{product_name}"
}}

INTERDICTIONS STRICTES :
- JAMAIS "Docteur," au début
- Jamais de codes ou numéros dans la question
- Jamais "le produit" — toujours le nom exact : {product_name}
- La bonne réponse doit être la A (correct_index: 0)

Génère la question maintenant :"""


async def generate_one_question(engine, product_name: str, context: str, difficulty: str, angle: str = None) -> Optional[dict]:
    from langchain_core.messages import SystemMessage, HumanMessage
    clean_ctx = clean_context(context, product_name)
    if not clean_ctx.strip():
        return None
    prompt = build_question_prompt(product_name, clean_ctx, difficulty, angle)
    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: engine.llm.invoke([
                SystemMessage(content=QUIZ_SYSTEM_PROMPT),
                HumanMessage(content=prompt)
            ])
        )
        raw = response.content.strip()
        q = _safe_parse_one(raw)
        if not _is_valid_question(q, product_name):
            return None
        q = _sanitize_question(q)
        q = _shuffle_correct_position(q)
        return q
    except Exception as e:
        print(f"[Quiz] Erreur génération pour {product_name}: {e}")
        return None


def _build_task_list(hits: dict, count: int) -> list:
    """
    hits  = {product_name: context}  — ONLY the allowed products
    count = total questions to generate

    1 product  → count questions on THAT product with varied angles
    N products → questions distributed cyclically among the N products
    """
    products = list(hits.keys())
    if not products:
        return []

    angles = QUESTION_ANGLES[:]
    random.shuffle(angles)
    while len(angles) < count:
        extra = QUESTION_ANGLES[:]
        random.shuffle(extra)
        angles.extend(extra)

    tasks = []
    if len(products) == 1:
        pname   = products[0]
        context = hits[pname]
        for i in range(count):
            tasks.append((pname, context, angles[i]))
    else:
        random.shuffle(products)
        for i in range(count):
            pname   = products[i % len(products)]
            context = hits[pname]
            tasks.append((pname, context, angles[i]))

    return tasks


def _resolve_hits(engine, req: QuizRequest) -> dict:
    """Return {product_name: context} strictly matching the selection."""
    selected = []
    if req.products and len(req.products) > 0:
        selected = req.products
    elif req.product:
        selected = [req.product]

    if selected:
        return _fetch_selected_products(engine, selected)
    return _fetch_all_products(engine)


@router.post("/generate/stream")
async def generate_quiz_stream(req: QuizRequest):
    from backend.rag.engine import engine
    engine.initialize()

    count = min(max(req.question_count, 5), 15)
    hits  = _resolve_hits(engine, req)

    if not hits:
        async def error_gen():
            yield f'data: {json.dumps({"type": "error", "message": "Aucun produit trouvé dans la base"})}\n\n'
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    task_list = _build_task_list(hits, count)

    async def event_generator():
        yield f'data: {json.dumps({"type": "loading", "total": len(task_list)})}\n\n'
        tasks   = [generate_one_question(engine, pname, ctx, req.difficulty, angle)
                   for pname, ctx, angle in task_list]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        questions = []
        for result in results:
            if isinstance(result, dict) and result:
                questions.append(result)
                yield f"data: {json.dumps({'type': 'question', 'question': result, 'index': len(questions)-1, 'total': len(task_list)}, ensure_ascii=False)}\n\n"
        yield f'data: {json.dumps({"type": "done", "count": len(questions)})}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@router.post("/generate/full")
async def generate_quiz_full(req: QuizRequest):
    from backend.rag.engine import engine
    engine.initialize()
    count     = min(max(req.question_count, 5), 15)
    hits      = _resolve_hits(engine, req)
    if not hits:
        return {"error": "Aucun produit trouvé", "questions": []}
    task_list = _build_task_list(hits, count)
    tasks     = [generate_one_question(engine, pname, ctx, req.difficulty, angle)
                 for pname, ctx, angle in task_list]
    results   = await asyncio.gather(*tasks, return_exceptions=True)
    questions = [r for r in results if isinstance(r, dict) and r]
    return {"questions": questions, "count": len(questions)}


# ── FETCH ────────────────────────────────────────────────────────────────────

def _fetch_selected_products(engine, product_names: List[str]) -> dict:
    """
    Pull from ChromaDB only the chunks whose product_name matches
    one of the requested names — EXACT match, case-insensitive.
    No fuzzy / semantic search that could smuggle in other products.
    """
    wanted = {name.strip().lower(): name.strip() for name in product_names}
    result = {original: "" for original in wanted.values()}

    try:
        all_docs = engine.collection.get(include=["documents", "metadatas"])
        for doc, meta in zip(all_docs.get("documents", []), all_docs.get("metadatas", [])):
            pname = (
                meta.get("product_name", "").strip()
                or meta.get("name", "").strip()
            )
            if not pname:
                continue
            if pname.lower() not in wanted:
                continue                          # ← strict: skip anything else
            if meta.get("source_table", "") in ("doc", "annimation_fiches"):
                continue

            canonical = wanted[pname.lower()]
            result[canonical] += "\n" + doc

    except Exception as e:
        print(f"[Quiz] ChromaDB error in _fetch_selected_products: {e}")

    # Remove products with no data found
    for pname in list(result.keys()):
        text = result[pname].strip()
        if not text:
            print(f"[Quiz] WARNING: no chunks found for '{pname}'")
            del result[pname]
        else:
            result[pname] = text[:1500]

    print(f"[Quiz] Selected products loaded: {list(result.keys())}")
    return result


def _fetch_all_products(engine) -> dict:
    result = {}
    try:
        all_docs = engine.collection.get(include=["documents", "metadatas"])
        for doc, meta in zip(all_docs.get("documents", []), all_docs.get("metadatas", [])):
            pname = (
                meta.get("product_name", "").strip()
                or meta.get("name", "").strip()
            )
            if not pname or re.match(r'^\d+$', pname) or len(pname) < 3:
                continue
            if meta.get("source_table", "") in ("doc", "annimation_fiches"):
                continue
            if pname not in result:
                result[pname] = doc
            else:
                result[pname] += f"\n{doc}"
    except Exception as e:
        print(f"[Quiz] ChromaDB error in _fetch_all_products: {e}")

    for pname in list(result.keys()):
        if len(result[pname]) > 1500:
            result[pname] = result[pname][:1500]

    print(f"[Quiz] {len(result)} products loaded from ChromaDB")
    return result


# ── PARSE / SANITIZE / VALIDATE ──────────────────────────────────────────────

def _safe_parse_one(raw: str) -> Optional[dict]:
    raw = re.sub(r'```json\s*', '', raw)
    raw = re.sub(r'```\s*', '', raw)
    raw = raw.strip()
    try:
        return json.loads(raw)
    except Exception:
        pass
    match = re.search(r'\{[\s\S]*\}', raw)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass
    return None


def _sanitize_question(q: dict) -> dict:
    question = q.get("question", "")
    for pat in [r"^docteur\s*,\s*", r"^dr\.\s*,\s*", r"^dr\s*,\s*", r"^doctor\s*,\s*"]:
        question = re.sub(pat, "", question, flags=re.IGNORECASE)
    if question:
        question = question[0].upper() + question[1:]
    return {**q, "question": question}


def _shuffle_correct_position(q: dict) -> dict:
    choices     = q.get("choices", [])
    correct_idx = q.get("correct_index", 0)
    if not choices or not (0 <= correct_idx < len(choices)):
        return q
    correct_answer = choices[correct_idx]
    wrong_answers  = [c for i, c in enumerate(choices) if i != correct_idx]
    random.shuffle(wrong_answers)
    new_position = random.randint(0, min(3, len(choices) - 1))
    new_choices  = wrong_answers[:]
    new_choices.insert(new_position, correct_answer)
    return {**q, "choices": new_choices[:4], "correct_index": new_position}


def _is_valid_question(q: Optional[dict], expected_product: str) -> bool:
    if not q or not isinstance(q, dict):
        return False
    question = str(q.get("question", "")).strip()
    choices  = q.get("choices", [])
    product  = str(q.get("product", "")).strip()
    if len(question) < 30 or len(choices) != 4 or len(product) < 3:
        return False
    if re.search(r'\b\d{4,}\b', question):
        return False
    question_clean = re.sub(r'^docteur\s*,\s*', '', question, flags=re.IGNORECASE)
    if expected_product.lower() not in question_clean.lower():
        return False
    if any(len(str(c).strip()) < 5 for c in choices):
        return False
    return True