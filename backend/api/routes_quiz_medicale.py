import json
import re
import random
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

class QuizRequest(BaseModel):
    product: Optional[str] = None
    difficulty: str = "moyen"
    question_count: int = 10

QUIZ_SYSTEM_PROMPT = (
    "Tu es un expert en formation pharmaceutique. "
    "Tu génères des QCM précis, professionnels et pédagogiques basés UNIQUEMENT sur les données fournies. "
    "Réponds UNIQUEMENT avec du JSON brut (un tableau d'objets). Zéro texte avant ou après."
)

BATCH_Q_PROMPT = """CONTEXTE PRODUITS :
{context}

MISSION : Génère exactement {count} questions QCM professionnelles pour former un délégué médical VITAL SA.
NIVEAU : {difficulty_desc}

RÈGLES STRICTES :
- Utilise toujours le vrai nom complet du produit (ex: LV PSOCALM, FerBiotic Lipo, PHYTOFANE Anti Chute...)
- Varie les sujets : indications, composition, mécanisme d’action, posologie, forme galénique, contre-indications, conseils, avantages
- Maximum 2 questions par produit
- 4 choix réalistes par question, une seule bonne réponse
- L’explication doit citer clairement le contexte
- NE parle JAMAIS de médecins, ordonnances, clients, ventes ou chiffres

FORMAT JSON EXACT (un tableau uniquement) :
[
  {{
    "question": "Quelle est l’indication principale de LV PSOCALM ?",
    "choices": ["Choix 1", "Choix 2", "Choix 3", "Choix 4"],
    "correct_index": 0,
    "explanation": "LV PSOCALM est indiqué dans...",
    "product": "LV PSOCALM"
  }}
]
"""

DIFFICULTY_DESCRIPTIONS = {
    "facile": "Questions simples sur les indications principales, forme et population cible.",
    "moyen": "Questions sur composition, mécanisme d’action, posologie et associations.",
    "difficile": "Questions pointues sur contre-indications, posologies précises et arguments différenciants.",
}

@router.post("/generate/stream")
def generate_quiz_stream(req: QuizRequest):
    from backend.rag.engine import engine
    engine.initialize()

    count = min(max(req.question_count, 1), 15)
    all_hits = _fetch_all_products(engine, req.product)

    if not all_hits:
        def error_gen():
            yield f'data: {json.dumps({"type": "error", "message": "Aucun produit trouvé."})}\n\n'
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    difficulty_desc = DIFFICULTY_DESCRIPTIONS.get(req.difficulty, DIFFICULTY_DESCRIPTIONS["moyen"])

    def event_generator():
        # Construire un contexte varié
        product_list = list(all_hits.keys())
        random.shuffle(product_list)

        context_parts = []
        char_count = 0
        for pname in product_list:
            block = all_hits[pname]
            if char_count + len(block) > 4500:
                break
            context_parts.append(block)
            char_count += len(block)

        context = "\n\n".join(context_parts)

        prompt = BATCH_Q_PROMPT.format(
            context=context,
            count=count,
            difficulty_desc=difficulty_desc
        )

        original_max = engine.llm.max_tokens
        original_temp = getattr(engine.llm, 'temperature', 0.1)
        engine.llm.max_tokens = min(count * 380 + 300, 4000)
        engine.llm.temperature = 0.2

        try:
            from langchain_core.messages import SystemMessage, HumanMessage
            response = engine.llm.invoke([
                SystemMessage(content=QUIZ_SYSTEM_PROMPT),
                HumanMessage(content=prompt),
            ])

            raw = response.content.strip()
            questions = _parse_batch_questions(raw)

            if not questions:
                yield f'data: {json.dumps({"type": "error", "message": "Impossible de générer les questions."})}\n\n'
                return

            # Shuffle correct_index + validation
            valid_questions = []
            for q in questions:
                if _is_valid_question(q):
                    q = _shuffle_correct_position(q)
                    valid_questions.append(q)

            valid_questions = valid_questions[:count]

            # Envoi progressif pour garder l'effet "chargement"
            for i, q in enumerate(valid_questions):
                event = {
                    "type": "question",
                    "question": q,
                    "index": i,
                    "total": len(valid_questions),
                }
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

            yield f'data: {json.dumps({"type": "done", "count": len(valid_questions)})}\n\n'

        except Exception as e:
            print(f"[quiz batch] Error: {e}")
            yield f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'
        finally:
            engine.llm.max_tokens = original_max
            engine.llm.temperature = original_temp

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ====================== HELPERS ======================
def _fetch_all_products(engine, product_filter: Optional[str]) -> dict:
    result = {}
    if product_filter:
        hits = engine.search(product_filter, n_results=30)
        for h in hits:
            pname = h.get("product_name", "").strip()
            if not pname: continue
            if pname not in result:
                result[pname] = f"=== {pname} ===\n{h['text']}"
            else:
                result[pname] += "\n\n" + h['text']
        return result

    # Tous les produits
    try:
        docs = engine.collection.get(where={"source_table": "products"}, include=["documents", "metadatas"])
        for doc, meta in zip(docs["documents"], docs["metadatas"]):
            pname = meta.get("product_name", "").strip() or meta.get("name", "").strip()
            if not pname: continue
            if pname not in result:
                result[pname] = f"=== {pname} ===\n{doc}"
            else:
                result[pname] += "\n\n" + doc
    except Exception as e:
        print(f"[quiz] products error: {e}")

    try:
        docs = engine.collection.get(where={"source_table": "annimation_fiches"}, include=["documents", "metadatas"])
        for doc, meta in zip(docs["documents"], docs["metadatas"]):
            pname = meta.get("product_name", "").strip()
            if not pname: continue
            if pname not in result:
                result[pname] = f"=== {pname} ===\n{doc}"
            else:
                result[pname] += "\n\n" + doc
    except Exception as e:
        print(f"[quiz] fiches error: {e}")

    for pname in list(result.keys()):
        if len(result[pname]) > 800:
            result[pname] = result[pname][:800] + "..."

    return result


def _parse_batch_questions(raw: str):
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "questions" in data:
            return data["questions"]
    except:
        pass

    # Nettoyage regex
    match = re.search(r'\[\s*\{.*\}\s*\]', raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except:
            pass
    return []


def _shuffle_correct_position(q: dict) -> dict:
    choices = q.get("choices", [])
    correct_idx = q.get("correct_index", 0)
    if not choices or not (0 <= correct_idx < len(choices)):
        return q
    correct_answer = choices[correct_idx]
    wrong = [c for i, c in enumerate(choices) if i != correct_idx]
    random.shuffle(wrong)
    new_idx = random.randint(0, 3)
    new_choices = wrong[:]
    new_choices.insert(new_idx, correct_answer)
    return {**q, "choices": new_choices, "correct_index": new_idx}


def _is_valid_question(q: dict) -> bool:
    question = str(q.get("question", "")).strip()
    product = str(q.get("product", "")).strip()
    choices = q.get("choices", [])
    correct = q.get("correct_index", -1)

    if not question or len(question) < 25: return False
    if len(choices) != 4: return False
    if not (0 <= correct <= 3): return False
    if not product or len(product) < 3 or product.lower() in ["35", "le produit", "unknown"]:
        return False
    return True