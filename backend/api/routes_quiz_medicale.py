"""
backend/api/routes_quiz_medicale.py
====================================
Quiz endpoints — VERSION REFONTE COMPLÈTE
Corrections :
  1. Génération en parallèle (asyncio) → toutes les questions prêtes d'un coup
  2. Prompt renforcé → questions pédagogiques, jamais de codes/IDs
  3. Contexte nettoyé → suppression codes articles, IDs numériques
  4. Cache questions côté serveur → "suivante" est instantané
"""

import json
import re
import random
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

# ════════════════════════════════════════════════════════════════════════════
# MODÈLES
# ════════════════════════════════════════════════════════════════════════════

class QuizRequest(BaseModel):
    product: Optional[str] = None
    difficulty: str = "moyen"
    question_count: int = 10


# ════════════════════════════════════════════════════════════════════════════
# NETTOYAGE DU CONTEXTE — supprime codes, IDs, numéros parasites
# ════════════════════════════════════════════════════════════════════════════

def clean_context(text: str, product_name: str) -> str:
    """
    Nettoie le contexte produit avant de l'envoyer au LLM :
    - Supprime les lignes contenant uniquement des codes/IDs
    - Supprime les numéros d'article (ex: Code Article: 3690)
    - Garde uniquement les informations médicales/commerciales utiles
    """
    lines = text.splitlines()
    clean_lines = []
    skip_patterns = [
        r"^code[_\s]article\s*:.*$",
        r"^id\s*:.*$",
        r"^source[_\s]id\s*:.*$",
        r"^\[source\s+\d+",           # [Source 1: ...]
        r"^\s*\d{3,}\s*$",            # ligne = rien qu'un numéro
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
            # Remplace les numéros orphelins collés au nom produit
            line_stripped = re.sub(r'\b\d{3,}\b', '', line_stripped).strip()
            if line_stripped:
                clean_lines.append(line_stripped)

    cleaned = "\n".join(clean_lines)
    # Tronquer à 1200 caractères max
    return cleaned[:1200]


# ════════════════════════════════════════════════════════════════════════════
# PROMPTS
# ════════════════════════════════════════════════════════════════════════════

QUIZ_SYSTEM_PROMPT = """Tu es un formateur expert chez VITAL SA, spécialisé dans la formation des délégués médicaux.

Ta mission : créer des QCM professionnels et pédagogiques pour former les délégués à présenter les produits aux médecins et pharmaciens.

RÈGLES ABSOLUES :
1. Utilise UNIQUEMENT le nom commercial du produit (ex: "Doliprane", "Augmentin") — JAMAIS de codes, IDs ou numéros
2. Les questions doivent tester des connaissances réelles qu'un délégué médical doit maîtriser
3. Les réponses doivent être crédibles et professionnelles
4. Réponds UNIQUEMENT avec du JSON valide. Zéro texte avant ou après.
"""

def build_question_prompt(product_name: str, context: str, difficulty: str) -> str:
    difficulty_guide = {
        "facile": "Teste les indications principales, la forme galénique et la population cible. Questions directes et accessibles.",
        "moyen": "Teste la posologie, le mécanisme d'action, les conseils pratiques et la composition. Questions de niveau intermédiaire.",
        "difficile": "Teste les contre-indications, les interactions médicamenteuses, la différenciation concurrentielle et les cas cliniques complexes.",
    }
    guide = difficulty_guide.get(difficulty, difficulty_guide["moyen"])

    return f"""Tu formes un délégué médical sur le produit {product_name}.

INFORMATIONS SUR LE PRODUIT :
{context}

NIVEAU DE DIFFICULTÉ : {difficulty.upper()}
{guide}

GÉNÈRE exactement 1 question QCM selon ce format JSON :

{{
  "question": "[question réaliste en situation de visite médicale] concernant {product_name} ?",
  "choices": [
    "Réponse A complète et précise",
    "Réponse B plausible mais incorrecte",
    "Réponse C plausible mais incorrecte", 
    "Réponse D plausible mais incorrecte"
  ],
  "correct_index": 0,
  "explanation": "Explication pédagogique en 1-2 phrases pour que le délégué retienne l'information clé.",
  "product": "{product_name}"
}}

EXEMPLES DE BONNES QUESTIONS (adapte au produit) :
- "quelle est la posologie recommandée de {product_name} chez l'adulte ?"
- "dans quelles situations {product_name} est-il particulièrement indiqué ?"
- "quel est le principal avantage de {product_name} par rapport aux alternatives ?"
- "y a-t-il des contre-indications à connaître avec {product_name} ?"

INTERDICTIONS STRICTES :
- Jamais de codes ou numéros dans la question
- Jamais "le produit" ou "ce produit" — toujours le nom exact : {product_name}
- Jamais de question sur le prix ou le code article
- La bonne réponse doit être la A (correct_index: 0) — le shuffle est fait côté serveur

Génère la question maintenant :"""


# ════════════════════════════════════════════════════════════════════════════
# GÉNÉRATION PARALLÈLE
# ════════════════════════════════════════════════════════════════════════════

async def generate_one_question(engine, product_name: str, context: str, difficulty: str) -> Optional[dict]:
    """Génère une question pour un produit donné de manière asynchrone."""
    from langchain_core.messages import SystemMessage, HumanMessage

    clean_ctx = clean_context(context, product_name)
    if not clean_ctx.strip():
        return None

    prompt = build_question_prompt(product_name, clean_ctx, difficulty)

    try:
        # Appel synchrone dans un thread pour ne pas bloquer l'event loop
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

        q = _shuffle_correct_position(q)
        return q

    except Exception as e:
        print(f"[Quiz] Erreur génération pour {product_name}: {e}")
        return None


# ════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════════════════════════════════

@router.post("/generate/stream")
async def generate_quiz_stream(req: QuizRequest):
    """
    Génère TOUTES les questions en parallèle, puis les envoie via SSE.
    Le frontend reçoit d'abord un événement 'loading' pendant la génération,
    puis toutes les questions arrivent en rafale → navigation instantanée.
    """
    from backend.rag.engine import engine
    engine.initialize()

    count = min(max(req.question_count, 5), 15)
    all_hits = _fetch_products_from_chroma(engine, req.product)

    if not all_hits:
        async def error_gen():
            yield f'data: {json.dumps({"type": "error", "message": "Aucun produit trouvé dans la base"})}\n\n'
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    # Sélection aléatoire des produits
    product_list = list(all_hits.keys())
    random.shuffle(product_list)
    selected_products = product_list[:count]

    async def event_generator():
        # Signal de démarrage
        yield f'data: {json.dumps({"type": "loading", "total": len(selected_products)})}\n\n'

        # Génération PARALLÈLE de toutes les questions
        tasks = [
            generate_one_question(engine, pname, all_hits[pname], req.difficulty)
            for pname in selected_products
        ]

        # Gather avec gestion d'erreurs
        results = await asyncio.gather(*tasks, return_exceptions=True)

        questions = []
        for i, result in enumerate(results):
            if isinstance(result, dict) and result:
                questions.append(result)
                # Envoyer chaque question dès qu'elle est prête (ordre de génération)
                event = {
                    "type": "question",
                    "question": result,
                    "index": len(questions) - 1,
                    "total": len(selected_products),
                }
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

        yield f'data: {json.dumps({"type": "done", "count": len(questions)})}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@router.post("/generate/full")
async def generate_quiz_full(req: QuizRequest):
    """Endpoint batch — retourne toutes les questions d'un coup (pas SSE)."""
    from backend.rag.engine import engine
    engine.initialize()

    count = min(max(req.question_count, 5), 15)
    all_hits = _fetch_products_from_chroma(engine, req.product)

    if not all_hits:
        return {"error": "Aucun produit trouvé", "questions": []}

    product_list = list(all_hits.keys())
    random.shuffle(product_list)
    selected = product_list[:count]

    tasks = [
        generate_one_question(engine, pname, all_hits[pname], req.difficulty)
        for pname in selected
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    questions = [r for r in results if isinstance(r, dict) and r]
    return {"questions": questions, "count": len(questions)}


# ════════════════════════════════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════════════════════════════════

def _fetch_products_from_chroma(engine, product_filter=None) -> dict:
    """
    Récupère les produits depuis ChromaDB.
    Retourne: {product_name: context_text}
    Filtre les entrées sans nom ou avec uniquement des IDs numériques.
    """
    result = {}

    if product_filter:
        hits = engine.search(product_filter, n_results=30)
        for h in hits:
            pname = h.get("product_name", "").strip()
            # Ignore les noms qui sont juste des IDs numériques
            if pname and not re.match(r'^\d+$', pname) and pname not in result:
                result[pname] = h.get("text", "")
        return result

    try:
        all_docs = engine.collection.get(include=["documents", "metadatas"])
        for doc, meta in zip(all_docs.get("documents", []), all_docs.get("metadatas", [])):
            pname = (
                meta.get("product_name", "").strip()
                or meta.get("name", "").strip()
            )
            # Filtre strict : nom doit être un vrai nom (pas un ID, pas vide)
            if not pname:
                continue
            if re.match(r'^\d+$', pname):  # Ignore les IDs purs
                continue
            if len(pname) < 3:              # Ignore les noms trop courts
                continue
            # Ignore les tables non-produits (doc, annimation_fiches)
            source_table = meta.get("source_table", "")
            if source_table in ("doc", "annimation_fiches"):
                continue

            if pname not in result:
                result[pname] = doc
            else:
                result[pname] += f"\n{doc}"
    except Exception as e:
        print(f"[Quiz] ChromaDB error: {e}")

    # Nettoyage final
    for pname in list(result.keys()):
        if len(result[pname]) > 1500:
            result[pname] = result[pname][:1500]

    print(f"[Quiz] {len(result)} produits chargés depuis ChromaDB")
    return result


def _safe_parse_one(raw: str) -> Optional[dict]:
    """Parse JSON depuis la réponse LLM, avec fallback regex."""
    # Nettoyage markdown si présent
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


def _shuffle_correct_position(q: dict) -> dict:
    """Mélange la position de la bonne réponse pour éviter que A soit toujours correct."""
    choices = q.get("choices", [])
    correct_idx = q.get("correct_index", 0)

    if not choices or not (0 <= correct_idx < len(choices)):
        return q

    correct_answer = choices[correct_idx]
    wrong_answers = [c for i, c in enumerate(choices) if i != correct_idx]
    random.shuffle(wrong_answers)

    new_position = random.randint(0, min(3, len(choices) - 1))
    new_choices = wrong_answers[:]
    new_choices.insert(new_position, correct_answer)

    return {**q, "choices": new_choices[:4], "correct_index": new_position}


def _is_valid_question(q: Optional[dict], expected_product: str) -> bool:
    """Valide qu'une question est exploitable par un délégué médical."""
    if not q or not isinstance(q, dict):
        return False

    question = str(q.get("question", "")).strip()
    choices = q.get("choices", [])
    product = str(q.get("product", "")).strip()

    # Validations de base
    if len(question) < 30:
        return False
    if len(choices) != 4:
        return False
    if len(product) < 3:
        return False

    # Refus des questions avec codes/IDs numériques longs
    if re.search(r'\b\d{4,}\b', question):
        return False

    # Le nom du produit doit être dans la question
    if expected_product.lower() not in question.lower():
        return False

    # Chaque choix doit avoir du contenu
    if any(len(str(c).strip()) < 5 for c in choices):
        return False

    return True