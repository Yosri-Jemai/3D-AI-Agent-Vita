"""
backend/api/routes_quiz_commercial.py
======================================
Quiz Commercial endpoints — Formation Vente Pharmacien / Para

Objectif : entraîner le délégué commercial à VENDRE les produits
aux pharmaciens et para-pharmaciens.

Les questions testent :
  - Arguments de vente & bénéfices clients
  - Gestion des objections (prix, concurrence, habitudes)
  - Techniques de pitch (accroche, SONCAS, FAB)
  - Avantages différenciants vs concurrents
  - Conseils au comptoir pour le pharmacien
  - Profil du patient / client cible
  - Positionnement prix & valeur
  - Rebonds sur questions difficiles

Basé sur les données de la base ChromaDB uniquement.
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


class QuizCommercialRequest(BaseModel):
    product: Optional[str] = None
    products: Optional[List[str]] = None
    difficulty: str = "moyen"
    question_count: int = 10


# ── Nettoyage du contexte ─────────────────────────────────────────────────────

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


# ── Prompt système commercial ─────────────────────────────────────────────────

QUIZ_COMMERCIAL_SYSTEM_PROMPT = """Tu es un coach en vente pharmaceutique chez VITAL SA, spécialisé dans la formation des délégués commerciaux.

Ta mission : créer des QCM pour ÉVALUER les compétences de vente d'un délégué qui présente les produits aux pharmaciens et para-pharmaciens.
Le délégué doit savoir comment VENDRE, CONVAINCRE et FIDÉLISER — pas seulement connaître le produit.

RÈGLES ABSOLUES :
1. Utilise UNIQUEMENT le nom commercial du produit — JAMAIS de codes, IDs ou numéros
2. La question teste des compétences COMMERCIALES : pitch, objections, avantages, profil client, conseil comptoir
3. Intègre des informations scientifiques SEULEMENT comme arguments de vente (ex: "grâce à sa formule X, vous pouvez dire au pharmacien que…")
4. Les questions doivent être réalistes : scénarios de vente, dialogues, situations au comptoir
5. Réponds UNIQUEMENT avec du JSON valide. Zéro texte avant ou après.
"""

# ── Angles commerciaux ────────────────────────────────────────────────────────

COMMERCIAL_ANGLES = [
    "l'argument de vente principal à utiliser avec un pharmacien réticent",
    "comment présenter le bénéfice patient en 30 secondes (elevator pitch)",
    "la gestion de l'objection prix : 'c'est trop cher par rapport à la concurrence'",
    "comment différencier le produit des alternatives disponibles en pharmacie",
    "le profil de patient / client idéal à cibler en priorité",
    "les conseils pratiques que le pharmacien peut donner à ses clients",
    "comment conclure la vente face à un pharmacien hésitant",
    "l'argument scientifique clé transformé en bénéfice commercial",
    "comment répondre à l'objection 'j'ai déjà un produit similaire qui marche bien'",
    "la technique FAB (Feature-Avantage-Bénéfice) appliquée à ce produit",
    "comment créer un sens d'urgence ou d'opportunité pour le pharmacien",
    "les questions à poser au pharmacien pour identifier ses besoins (méthode SPIN)",
    "comment positionner le produit dans le rayon pharmacie",
    "la gestion de l'objection 'mes clients ne me demandent jamais ce produit'",
    "comment former le pharmacien pour qu'il recommande le produit à ses clients",
    "les arguments pour augmenter la commande initiale (upsell / cross-sell)",
    "comment reprendre contact après un premier refus (relance commerciale)",
    "les mots-clés à utiliser pour déclencher l'achat chez le pharmacien",
    "comment présenter la rentabilité / marge pour le pharmacien",
    "la gestion de l'objection 'je dois en parler avec mon équipe / chef de rayon'",
]


# ── Construction du prompt par question ──────────────────────────────────────

def build_commercial_question_prompt(product_name: str, context: str, difficulty: str, angle: str = None) -> str:
    difficulty_guide = {
        "facile": (
            "Teste les arguments de vente de base, le profil client et le bénéfice principal. "
            "Questions simples et directes sur le pitch produit."
        ),
        "moyen": (
            "Teste la gestion des objections courantes, la technique FAB et le conseil au comptoir. "
            "Situations réalistes de vente avec un pharmacien neutre."
        ),
        "difficile": (
            "Teste des scénarios complexes : pharmacien très réticent, concurrence agressive, "
            "négociation sur les conditions. Demande une maîtrise avancée des techniques de vente."
        ),
    }
    guide = difficulty_guide.get(difficulty, difficulty_guide["moyen"])
    angle_instruction = f"\nFOCUS OBLIGATOIRE : teste spécifiquement {angle}." if angle else ""

    return f"""Tu évalues les compétences commerciales d'un délégué qui vend {product_name} à des pharmaciens et para-pharmaciens.

INFORMATIONS PRODUIT DISPONIBLES (base de données VITAL SA) :
{context}

NIVEAU DE DIFFICULTÉ : {difficulty.upper()}
{guide}{angle_instruction}

GÉNÈRE exactement 1 question QCM de formation commerciale :

{{
  "question": "Scénario ou situation de vente concrète testant la compétence commerciale sur {product_name} ?",
  "choices": [
    "Meilleure réponse commerciale — la plus efficace et professionnelle",
    "Réponse plausible mais sous-optimale ou maladroite",
    "Réponse incorrecte ou contre-productive dans ce contexte de vente",
    "Réponse erronée ou hors sujet"
  ],
  "correct_index": 0,
  "explanation": "Explication de la technique de vente et pourquoi c'est la meilleure approche. 1-2 phrases.",
  "product": "{product_name}",
  "sales_skill": "Nom de la compétence testée (ex: Gestion d'objection, Pitch, FAB, etc.)"
}}

RÈGLE ANTI-BIAIS LONGUEUR (CRITIQUE) :
- Toutes les réponses (A, B, C, D) doivent avoir une longueur SIMILAIRE (±20% max)
- La bonne réponse ne doit PAS être plus longue que les mauvaises
- Les distracteurs doivent sembler aussi crédibles et complets que la bonne réponse
- Si la bonne réponse fait 15 mots, les mauvaises doivent faire entre 12 et 18 mots
- Un délégué ne doit PAS pouvoir deviner la bonne réponse par sa longueur

TYPES DE QUESTIONS AUTORISÉES :
- "Un pharmacien vous dit [objection]. Quelle est votre meilleure réponse ?"
- "Vous avez 30 secondes pour pitcher {product_name}. Que dites-vous en premier ?"
- "Comment présentez-vous [caractéristique] comme un bénéfice pour le pharmacien ?"
- "Le pharmacien hésite à commander. Quelle technique utilisez-vous ?"
- "Quel profil de client le pharmacien devrait-il conseiller en priorité ?"
- "Comment différenciez-vous {product_name} de [concurrent générique] ?"

INTERDICTIONS :
- JAMAIS de questions purement scientifiques sans lien avec la vente
- JAMAIS de codes ou numéros dans la question
- Jamais "le produit" — toujours le nom exact : {product_name}
- La bonne réponse doit être la A (correct_index: 0)
- Toujours formuler la question comme un scénario ou une situation réelle

Génère la question maintenant :"""


# ── Génération d'une question ─────────────────────────────────────────────────

async def generate_one_commercial_question(
    engine, product_name: str, context: str, difficulty: str, angle: str = None
) -> Optional[dict]:
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
        # Marquer comme question commerciale
        q["quiz_type"] = "commercial"
        return q
    except Exception as e:
        print(f"[QuizCommercial] Erreur génération pour {product_name}: {e}")
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
    selected = []
    if req.products and len(req.products) > 0:
        selected = req.products
    elif req.product:
        selected = [req.product]

    if selected:
        return _fetch_selected_products(engine, selected)
    return _fetch_all_products(engine)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate/stream")
async def generate_commercial_quiz_stream(req: QuizCommercialRequest):
    from backend.rag.engine import engine
    engine.initialize()

    count = min(max(req.question_count, 5), 15)
    hits  = _resolve_hits(engine, req)

    if not hits:
        async def error_gen():
            yield f'data: {json.dumps({"type": "error", "message": "Aucun produit trouvé dans la base"})}\n\n'
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    task_list = _build_commercial_task_list(hits, count)

    async def event_generator():
        yield f'data: {json.dumps({"type": "loading", "total": len(task_list)})}\n\n'
        tasks = [
            generate_one_commercial_question(engine, pname, ctx, req.difficulty, angle)
            for pname, ctx, angle in task_list
        ]
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
async def generate_commercial_quiz_full(req: QuizCommercialRequest):
    from backend.rag.engine import engine
    engine.initialize()
    count     = min(max(req.question_count, 5), 15)
    hits      = _resolve_hits(engine, req)
    if not hits:
        return {"error": "Aucun produit trouvé", "questions": []}
    task_list = _build_commercial_task_list(hits, count)
    tasks     = [
        generate_one_commercial_question(engine, pname, ctx, req.difficulty, angle)
        for pname, ctx, angle in task_list
    ]
    results   = await asyncio.gather(*tasks, return_exceptions=True)
    questions = [r for r in results if isinstance(r, dict) and r]
    return {"questions": questions, "count": len(questions)}


# ── FETCH ─────────────────────────────────────────────────────────────────────

def _fetch_selected_products(engine, product_names: List[str]) -> dict:
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
                continue
            if meta.get("source_table", "") in ("doc", "annimation_fiches"):
                continue
            canonical = wanted[pname.lower()]
            result[canonical] += "\n" + doc
    except Exception as e:
        print(f"[QuizCommercial] ChromaDB error in _fetch_selected_products: {e}")

    for pname in list(result.keys()):
        text = result[pname].strip()
        if not text:
            print(f"[QuizCommercial] WARNING: no chunks found for '{pname}'")
            del result[pname]
        else:
            result[pname] = text[:1500]

    print(f"[QuizCommercial] Selected products loaded: {list(result.keys())}")
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
        print(f"[QuizCommercial] ChromaDB error in _fetch_all_products: {e}")

    for pname in list(result.keys()):
        if len(result[pname]) > 1500:
            result[pname] = result[pname][:1500]

    print(f"[QuizCommercial] {len(result)} products loaded from ChromaDB")
    return result


# ── PARSE / SANITIZE / VALIDATE ───────────────────────────────────────────────

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
    q = {**q, "question": question}

    # ── Normaliser la longueur des réponses pour éviter le biais ────────────
    choices = q.get("choices", [])
    if len(choices) == 4:
        lengths = [len(c) for c in choices]
        median_len = sorted(lengths)[1]  # 2e plus court ≈ médiane
        # Tronquer les réponses trop longues (>1.5× médiane) sauf si toutes sont longues
        if max(lengths) > median_len * 1.5 and median_len > 20:
            truncated = []
            for c in choices:
                if len(c) > median_len * 1.5:
                    # Couper à la fin d'un mot proche du seuil
                    cutoff = int(median_len * 1.4)
                    trunc = c[:cutoff].rsplit(" ", 1)[0]
                    truncated.append(trunc + ".")
                else:
                    truncated.append(c)
            q = {**q, "choices": truncated}
    return q


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


# ── Endpoints feedback & verdict (via engine.llm = Token Factory / Ollama) ───

class FeedbackRequest(BaseModel):
    question:    str
    product:     str
    sales_skill: str
    chosen:      str
    correct:     str
    explanation: str
    is_correct:  bool

class VerdictRequest(BaseModel):
    score:             int
    total:             int
    pct:               int
    difficulty:        str
    selected_products: List[str]
    history:           List[dict]


@router.post("/feedback")
async def feedback_endpoint(req: FeedbackRequest):
    """
    Appelé par le quiz après chaque réponse.
    Retourne un coaching personnalisé généré par le LLM (engine.llm).
    """
    from backend.rag.engine import engine
    from langchain_core.messages import SystemMessage, HumanMessage
    engine.initialize()

    system = (
        "Tu es Vita, coach commerciale pharmaceutique chez VITAL SA. "
        "Tu donnes un feedback de coaching court, chaleureux et actionnable "
        "(2-3 phrases MAX) après qu'un délégué ait répondu à une question de vente. "
        "Si correct : félicite et renforce la technique utilisée. "
        "Si incorrect : explique brièvement pourquoi la bonne réponse est plus efficace. "
        "Parle directement au délégué (tutoiement ou vouvoiement selon le contexte). "
        "Sois concrète, humaine. JAMAIS de markdown, JAMAIS de liste à puces."
    )

    result_label = "CORRECT ✓" if req.is_correct else "INCORRECT ✗"
    user = (
        f"Scénario de vente : \"{req.question}\"\n"
        f"Produit : {req.product} | Compétence testée : {req.sales_skill}\n"
        f"Réponse du délégué : \"{req.chosen}\"\n"
        f"Bonne réponse : \"{req.correct}\"\n"
        f"Explication technique : {req.explanation}\n"
        f"Résultat : {result_label}\n\n"
        f"Donne ton feedback de coaching (2-3 phrases, direct, sans markdown) :"
    )

    loop = asyncio.get_event_loop()
    try:
        response = await loop.run_in_executor(
            None,
            lambda: engine.llm.invoke([
                SystemMessage(content=system),
                HumanMessage(content=user),
            ])
        )
        return {"text": response.content.strip()}
    except Exception as e:
        print(f"[QuizCommercial] feedback error: {e}")
        return {"text": ""}


@router.post("/verdict")
async def verdict_endpoint(req: VerdictRequest):
    """
    Appelé à la fin du quiz.
    Retourne un bilan personnalisé généré par le LLM.
    """
    from backend.rag.engine import engine
    from langchain_core.messages import SystemMessage, HumanMessage
    engine.initialize()

    system = (
        "Tu es Vita, coach commerciale pharmaceutique experte chez VITAL SA. "
        "Tu fais le bilan final d'un quiz de formation commerciale. "
        "Ton message est PERSONNEL, CHALEUREUX, motivant et très concret — 3 à 5 phrases. "
        "Tu identifies les forces du délégué et 1 à 2 axes d'amélioration spécifiques. "
        "Tu termines toujours sur une note d'encouragement. "
        "JAMAIS de markdown, JAMAIS de liste, juste du texte naturel et fluide."
    )

    # Résumé des erreurs
    wrong_items = [h for h in req.history if not h.get("ok")][:5]
    if wrong_items:
        wrong_lines = "\n".join(
            f"- {h.get('sales_skill', '?')} sur {h.get('product', '?')} : "
            f"répondu \"{str(h.get('chosen',''))[:60]}\" "
            f"au lieu de \"{str(h.get('correct',''))[:60]}\""
            for h in wrong_items
        )
    else:
        wrong_lines = "Aucune erreur — score parfait !"

    # Résumé des compétences
    skill_counts: dict = {}
    skill_ok: dict = {}
    for h in req.history:
        s = h.get("sales_skill") or "Autre"
        skill_counts[s] = skill_counts.get(s, 0) + 1
        skill_ok[s]     = skill_ok.get(s, 0) + (1 if h.get("ok") else 0)
    skill_summary = ", ".join(
        f"{s}: {skill_ok.get(s,0)}/{skill_counts[s]}"
        for s in skill_counts
    )

    products_str = ", ".join(req.selected_products) if req.selected_products else "Tous les produits"

    user = (
        f"Score final : {req.pct}% ({req.score}/{req.total} réponses correctes)\n"
        f"Niveau testé : {req.difficulty}\n"
        f"Produits : {products_str}\n"
        f"Compétences évaluées : {skill_summary}\n\n"
        f"Points à améliorer :\n{wrong_lines}\n\n"
        f"Fais le bilan personnalisé (3-5 phrases, motivant, concret, sans markdown) :"
    )

    loop = asyncio.get_event_loop()
    try:
        response = await loop.run_in_executor(
            None,
            lambda: engine.llm.invoke([
                SystemMessage(content=system),
                HumanMessage(content=user),
            ])
        )
        return {"text": response.content.strip()}
    except Exception as e:
        print(f"[QuizCommercial] verdict error: {e}")
        return {"text": ""}


def _is_valid_commercial_question(q: Optional[dict], expected_product: str) -> bool:
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