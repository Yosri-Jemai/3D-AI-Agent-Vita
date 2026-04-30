"""
backend/api/routes_chat.py
===========================
Chat endpoints:
  GET  /chat/health
  GET  /chat/stats
  GET  /chat/greeting/stream   — opening greeting, streams token by token
  POST /chat/ask
  POST /chat/ask/stream
  POST /chat/suggestions       — ★ NEW: adaptive follow-up questions
"""

import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional
from pydantic import BaseModel

router = APIRouter()


class QuestionRequest(BaseModel):
    question:  str
    n_results: int = 10
    mode:      str = "medical"   # "medical" or "commercial"
    session_id: Optional[str] = None


class SuggestionsRequest(BaseModel):
    question:  str
    answer:    str
    mode:      str = "medical"
    lang:      str = "fr"
    n:         int = 3


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/stats")
def stats():
    from backend.rag.engine import engine
    try:
        return engine.get_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/greeting/stream")
def greeting_stream():
    """Stream the opening greeting from Dr. Layla."""
    from backend.rag.engine import engine

    def event_generator():
        try:
            for chunk in engine.stream_greeting():
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/ask")
def ask(req: QuestionRequest):
    from backend.rag.engine import engine
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    try:
        return engine.ask(req.question, n_results=req.n_results, mode=req.mode)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ask/stream")
async def ask_stream(req: QuestionRequest):
    from backend.rag.engine import engine
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    def event_generator():
        try:
            for chunk in engine.stream_ask(req.question, n_results=req.n_results, mode=req.mode, session_id=req.session_id):
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/products")
def get_products():
    import pymysql, os
    try:
        conn = pymysql.connect(
            host=os.getenv("MYSQL_HOST","localhost"),
            port=int(os.getenv("MYSQL_PORT",3306)),
            user=os.getenv("MYSQL_USER"),
            password=os.getenv("MYSQL_PASSWORD"),
            database=os.getenv("MYSQL_DATABASE"),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
        )
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM products ORDER BY name")
            rows = cur.fetchall()
        conn.close()
        return {"products": [r["name"] for r in rows if r.get("name")]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/mode-intro/stream")
def mode_intro_stream(mode: str = "medical"):
    """Stream a mode-specific intro message from Vita."""
    from backend.rag.engine import engine
    from fastapi.responses import StreamingResponse

    def event_generator():
        try:
            for chunk in engine.stream_greeting(mode):
                import json
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            import json
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/gammes")
def get_gammes():
    """Retourne la liste des gammes depuis la table catalogues."""
    import pymysql, os
    try:
        conn = pymysql.connect(
            host=os.getenv("MYSQL_HOST","localhost"),
            port=int(os.getenv("MYSQL_PORT",3306)),
            user=os.getenv("MYSQL_USER"),
            password=os.getenv("MYSQL_PASSWORD"),
            database=os.getenv("MYSQL_DATABASE"),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
        )
        with conn.cursor() as cur:
            cur.execute("SELECT gamme FROM catalogues ORDER BY gamme")
            rows = cur.fetchall()
        conn.close()
        return {"gammes": [r["gamme"] for r in rows if r.get("gamme")]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════════════════════════════════════
# ★ NOUVEAU : Suggestions adaptives
# ══════════════════════════════════════════════════════════════════════════════

# Prompts de génération — un par (mode, langue)
# Prompts de génération — un par (mode, langue)
_SUGGEST_PROMPTS = {

    # ── MEDICAL ──────────────────────────────────────────────────────────────
    ("medical", "fr"): """Tu es Dr. Layla, formatrice en produits pharmaceutiques.
Un délégué médical vient de poser cette question : {question}
Et tu as répondu ceci : {answer}

En te basant UNIQUEMENT sur ce qui est mentionné dans la réponse ci-dessus, génère exactement {n} questions de suivi que le délégué poserait naturellement pour approfondir CE SUJET PRÉCIS.

RÈGLES STRICTES :
- Chaque question doit porter sur un élément SPÉCIFIQUE cité dans la réponse (un ingrédient, un mécanisme, un effet, une indication concrète...)
- INTERDIT de générer des questions sur posologie/contre-indications/études cliniques si ces sujets ne sont PAS explicitement mentionnés dans la réponse
- Les questions doivent sembler naturelles, comme si le délégué voulait en savoir plus sur ce qui vient d'être dit
- Courtes et précises (max 12 mots)

Réponds UNIQUEMENT avec un JSON valide, sans texte avant ni après :
{{"suggestions": ["question 1", "question 2", "question 3"]}}""",

    ("medical", "en"): """You are Dr. Layla, a pharmaceutical product trainer.
A medical delegate just asked this question: {question}
And you answered: {answer}

Based ONLY on what is mentioned in the answer above, generate exactly {n} follow-up questions the delegate would naturally ask to go deeper on THIS SPECIFIC TOPIC.

STRICT RULES:
- Each question must focus on a SPECIFIC element cited in the answer (an ingredient, a mechanism, an effect, a concrete indication...)
- FORBIDDEN to generate questions about dosage/contraindications/clinical studies if those topics are NOT explicitly in the answer
- Questions must feel natural, as if the delegate wants to know more about what was just said
- Short and precise (max 12 words each)

Respond ONLY with valid JSON, no text before or after:
{{"suggestions": ["question 1", "question 2", "question 3"]}}""",

    ("medical", "ar"): """أنتِ الدكتورة ليلى، مدرّبة في المنتجات الصيدلانية.
طرح مندوب طبي هذا السؤال: {question}
وأجبتِ بما يلي: {answer}

استناداً فقط إلى ما ورد في الإجابة أعلاه، اقترحي بالضبط {n} أسئلة متابعة يطرحها المندوب بشكل طبيعي لتعميق هذا الموضوع تحديداً.

قواعد صارمة:
- كل سؤال يجب أن يتناول عنصراً محدداً مذكوراً في الإجابة (مكوّن، آلية عمل، تأثير، مؤشر...)
- ممنوع طرح أسئلة عن الجرعة/موانع الاستعمال/الدراسات السريرية إذا لم تُذكر صراحةً في الإجابة
- الأسئلة يجب أن تبدو طبيعية كأن المندوب يريد معرفة المزيد مما قيل للتو
- قصيرة ودقيقة (12 كلمة كحد أقصى)
- احتفظي بأسماء المنتجات والمصطلحات العلمية بالفرنسية أو الإنجليزية

أجيبي فقط بـ JSON صحيح، بدون أي نص قبله أو بعده:
{{"suggestions": ["سؤال 1", "سؤال 2", "سؤال 3"]}}""",

    # ── COMMERCIAL ───────────────────────────────────────────────────────────
    ("commercial", "fr"): """Tu es Vita, coach en vente pharmaceutique.
Un délégué commercial vient de poser cette question : {question}
Et tu as répondu ceci : {answer}

En te basant UNIQUEMENT sur ce qui est mentionné dans la réponse ci-dessus, génère exactement {n} questions de suivi commerciales que le délégué poserait naturellement pour progresser sur CE POINT PRÉCIS.

RÈGLES STRICTES :
- Chaque question doit porter sur un élément SPÉCIFIQUE cité dans la réponse (une technique mentionnée, un type d'objection évoqué, un argument donné, un client cible nommé...)
- INTERDIT de générer des questions génériques non liées au contenu de la réponse
- Les questions doivent sembler naturelles, comme une réaction directe à ce qui vient d'être dit
- Courtes et directes (max 12 mots)

Réponds UNIQUEMENT avec un JSON valide, sans texte avant ni après :
{{"suggestions": ["question 1", "question 2", "question 3"]}}""",

    ("commercial", "en"): """You are Vita, a pharmaceutical sales coach.
A commercial delegate just asked this question: {question}
And you answered: {answer}

Based ONLY on what is mentioned in the answer above, generate exactly {n} commercial follow-up questions the delegate would naturally ask to go deeper on THIS SPECIFIC POINT.

STRICT RULES:
- Each question must focus on a SPECIFIC element cited in the answer (a technique mentioned, an objection type raised, an argument given, a named customer target...)
- FORBIDDEN to generate generic questions unrelated to the answer content
- Questions must feel natural, like a direct reaction to what was just said
- Short and direct (max 12 words each)

Respond ONLY with valid JSON, no text before or after:
{{"suggestions": ["question 1", "question 2", "question 3"]}}""",

    ("commercial", "ar"): """أنتِ Vita، مدرّبة مبيعات صيدلانية.
طرح مندوب تجاري هذا السؤال: {question}
وأجبتِ بما يلي: {answer}

استناداً فقط إلى ما ورد في الإجابة أعلاه، اقترحي بالضبط {n} أسئلة متابعة تجارية يطرحها المندوب بشكل طبيعي لتعميق هذه النقطة تحديداً.

قواعد صارمة:
- كل سؤال يجب أن يتناول عنصراً محدداً مذكوراً في الإجابة (تقنية مذكورة، نوع اعتراض، حجة معطاة، عميل مستهدف...)
- ممنوع طرح أسئلة عامة غير مرتبطة بمحتوى الإجابة
- الأسئلة يجب أن تبدو طبيعية كردّ فعل مباشر على ما قيل
- قصيرة ومباشرة (12 كلمة كحد أقصى)

أجيبي فقط بـ JSON صحيح، بدون أي نص قبله أو بعده:
{{"suggestions": ["سؤال 1", "سؤال 2", "سؤال 3"]}}""",

    # ── VITA COMMERCIAL ───────────────────────────────────────────────────────
    ("vita_commercial", "fr"): """Tu es Vita, déléguée pharmaceutique de VITAL SA.
Un médecin vient de dire ceci lors d'une visite médicale : {question}
Et tu as répondu : {answer}

En te basant UNIQUEMENT sur ce qui est mentionné dans ta réponse ci-dessus, génère exactement {n} réactions que le médecin pourrait avoir ensuite — questions, doutes, objections ou demandes de précision sur CE QUI VIENT D'ÊTRE DIT.

RÈGLES STRICTES :
- Chaque suggestion doit réagir à un élément SPÉCIFIQUE de ta réponse (un produit nommé, un bénéfice cité, une donnée mentionnée, une affirmation faite...)
- INTERDIT de générer des réactions génériques non liées à ta réponse
- Simule des réactions réelles de médecin : scepticisme, curiosité, demande de preuve, comparaison...
- Courtes (max 12 mots)

Réponds UNIQUEMENT avec un JSON valide :
{{"suggestions": ["réaction 1", "réaction 2", "réaction 3"]}}""",

    ("vita_commercial", "en"): """You are Vita, a pharmaceutical delegate from VITAL SA.
A doctor just said this during a medical visit: {question}
And you responded: {answer}

Based ONLY on what is mentioned in your response above, generate exactly {n} reactions the doctor might have next — questions, doubts, objections or requests for clarification about WHAT WAS JUST SAID.

STRICT RULES:
- Each suggestion must react to a SPECIFIC element of your response (a named product, a cited benefit, a mentioned data point, a claim made...)
- FORBIDDEN to generate generic reactions unrelated to your response
- Simulate real doctor reactions: skepticism, curiosity, request for proof, comparison...
- Short (max 12 words)

Respond ONLY with valid JSON:
{{"suggestions": ["reaction 1", "reaction 2", "reaction 3"]}}""",

    ("vita_commercial", "ar"): """أنتِ Vita، مندوبة صيدلانية من VITAL SA.
قال الطبيب خلال الزيارة: {question}
وردّكِ كان: {answer}

استناداً فقط إلى ما ورد في ردّك أعلاه، اقترحي بالضبط {n} ردود فعل يمكن أن يبديها الطبيب بعد ذلك — أسئلة، شكوك، اعتراضات أو طلبات توضيح حول ما قيل للتو.

قواعد صارمة:
- كل اقتراح يجب أن يتفاعل مع عنصر محدد في ردّك (منتج مسمّى، فائدة مذكورة، بيانات معطاة، ادّعاء قُدِّم...)
- ممنوع توليد ردود فعل عامة غير مرتبطة بردّك
- قصيرة (12 كلمة كحد أقصى)

أجيبي فقط بـ JSON صحيح:
{{"suggestions": ["ردّ 1", "ردّ 2", "ردّ 3"]}}""",
}

# Suggestions de secours si le LLM échoue
_FALLBACK_SUGGESTIONS = {
    "medical": [
        "Quelles sont les contre-indications ?",
        "Quelle est la posologie recommandée ?",
        "Y a-t-il des interactions médicamenteuses ?",
    ],
    "commercial": [
        "Comment répondre à l'objection sur le prix ?",
        "Quels sont les arguments différenciants ?",
        "Quel est le profil du client idéal ?",
    ],
    "vita_commercial": [
        "Avez-vous des études cliniques à l'appui ?",
        "Comment se compare-t-il aux alternatives ?",
        "Quelle est la posologie habituelle ?",
    ],
}


@router.post("/suggestions")
async def get_suggestions(req: SuggestionsRequest):
    """
    ★ Génère des questions de suivi adaptives basées sur la dernière interaction.

    Appelle directement le LLM Token Factory (pas de RAG).
    Les suggestions sont affichées dans le frontend comme chips cliquables —
    elles ne sont PAS lues à voix haute par l'avatar.
    """
    import os, re
    import json as _json
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage

    if not req.question.strip() or not req.answer.strip():
        raise HTTPException(status_code=400, detail="question and answer are required")

    lang = req.lang if req.lang in ("fr", "en", "ar") else "fr"
    mode = req.mode if req.mode in ("medical", "commercial", "vita_commercial") else "medical"

    # Choisir le prompt le plus adapté
    prompt_template = (
        _SUGGEST_PROMPTS.get((mode, lang))
        or _SUGGEST_PROMPTS.get((mode, "fr"))
        or _SUGGEST_PROMPTS[("medical", "fr")]
    )

    prompt = prompt_template.format(
        question=req.question[:600],
        answer=req.answer[:1000],
        n=req.n,
    )

    try:
        llm = ChatOpenAI(
            model=os.getenv("TOKEN_FACTORY_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct"),
            openai_api_key=os.getenv("TOKEN_FACTORY_API_KEY"),
            openai_api_base=os.getenv("TOKEN_FACTORY_BASE_URL") + "/api",
            temperature=0.8,
            max_tokens=300,
        )

        response = llm.invoke([HumanMessage(content=prompt)])
        raw = response.content.strip()

        # Nettoyer les éventuels blocs markdown ```json ... ```
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip().strip("`")

        # Extraire le premier objet JSON dans la réponse
        match = re.search(r'\{.*?\}', raw, re.DOTALL)
        if not match:
            raise ValueError(f"No JSON in response: {raw[:150]}")

        data = _json.loads(match.group())
        suggestions = [str(s).strip() for s in data.get("suggestions", []) if str(s).strip()]
        suggestions = suggestions[:req.n]

        if not suggestions:
            raise ValueError("Empty suggestions list")

        return {"suggestions": suggestions, "lang": lang, "mode": mode}

    except Exception as e:
        print(f"[/chat/suggestions] LLM error, using fallback: {e}")
        fallback = _FALLBACK_SUGGESTIONS.get(mode, _FALLBACK_SUGGESTIONS["medical"])[:req.n]
        return {"suggestions": fallback, "lang": lang, "mode": mode, "fallback": True}
