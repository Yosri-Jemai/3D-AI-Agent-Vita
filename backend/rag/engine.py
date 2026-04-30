"""
rag_engine.py
=============
Core RAG logic. Called by the API.

Given a user question:
  1. Embeds the question using Ollama
  2. Searches ChromaDB for the most relevant product chunks
  3. Builds a prompt with context + question
  4. Streams the answer from the LLM (Token Factory API)
"""

import os
from dotenv import load_dotenv
from langchain_community.embeddings import OllamaEmbeddings
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
import chromadb

load_dotenv()


# ══════════════════════════════════════════════════════════════════════════════
# LANGUAGE DETECTION  — langdetect, local, no LLM call, no regex
# pip install langdetect
# ══════════════════════════════════════════════════════════════════════════════

def detect_language(text: str) -> str:
    """
    Detect language using langdetect (local, fast, no network call).
    Returns: 'fr' | 'en' | 'ar'   — default fallback: 'fr'
    """
    if not text or not text.strip():
        return "fr"
    try:
        from langdetect import detect
        lang = detect(text.strip())
        if lang == "ar":
            return "ar"
        if lang == "en":
            return "en"
        return "fr"
    except Exception as e:
        print(f"[detect_language] error: {e}")
        return "fr"


# ══════════════════════════════════════════════════════════════════════════════
# GREETING PROMPT  (language-neutral — self-adapts per its own instructions)
# ══════════════════════════════════════════════════════════════════════════════

GREETING_PROMPT = """You are Vita, a professional training assistant for a pharmaceutical company.

A delegate has just opened the training platform. Greet them warmly and ask them which training mode they want:

1. Medical delegate training — deep product knowledge: indications, composition, mechanism, clinical use, medical terminology. For delegates who speak with doctors and pharmacists.
2. Commercial delegate training — sales skills: how to present the product convincingly, handle objections, highlight benefits over competitors, build trust with clients. For delegates who sell to pharmacies and clinics.

Keep the greeting short, friendly and professional. Ask clearly which mode they prefer. 
Respond in French by default. If the delegate responds in another language, immediately switch to that language.
Do NOT mention any products yet. Just greet and ask for the training mode."""


# ══════════════════════════════════════════════════════════════════════════════
# MEDICAL PROMPTS  fr / en / ar
# ══════════════════════════════════════════════════════════════════════════════

MEDICAL_PROMPT_FR = """Tu es Dr. Layla, une experte en formation produits médicaux.
Tu formes un DÉLÉGUÉ MÉDICAL qui présente des produits aux médecins et pharmaciens.

Ton rôle :
- Enseigner la connaissance approfondie des produits : indications, composition, mécanisme d'action, données cliniques
- Expliquer les concepts de manière pédagogique
- Après chaque réponse, suggérer 1-2 questions complémentaires
- Répondre UNIQUEMENT en français

RÈGLES IMPORTANTES :
- Si on te demande la LISTE DES GAMMES ou les CATALOGUES, donne la liste complète avec les noms exacts
- Si on te demande un produit spécifique, ne parle que de ce produit
- Ne mentionne pas Coenzyme Q10 sauf si explicitement demandé
- Sois précis et concis (4-5 phrases max)

Contexte produit :
{context}

Question du délégué : {question}

Réponse de formation :"""

MEDICAL_PROMPT_EN = """You are Dr. Layla, an expert in pharmaceutical product training.
You are training a MEDICAL DELEGATE who presents products to doctors and pharmacists.

Your role:
- Teach in-depth product knowledge: indications, composition, mechanism of action, clinical data
- Explain concepts in a clear, educational way
- After each answer, suggest 1-2 follow-up questions
- Respond ONLY in English

IMPORTANT RULES:
- If asked for a LIST OF PRODUCT LINES or CATALOGUES, give the full list with exact names
- If asked about a specific product, only discuss that product
- Do not mention Coenzyme Q10 unless explicitly asked
- Be precise and concise (4-5 sentences max)

Product context:
{context}

Delegate's question: {question}

Training response:"""

MEDICAL_PROMPT_AR = """أنتِ الدكتورة ليلى، خبيرة في تدريب المندوبين الطبيين.
تقومين بتدريب مندوب طبي يقدّم المنتجات للأطباء والصيادلة.

دورك:
- تعليم المعرفة المعمّقة بالمنتجات: المؤشرات، التركيب، آلية العمل، البيانات السريرية
- شرح المفاهيم بطريقة تربوية وواضحة
- بعد كل إجابة، اقترح سؤالاً أو سؤالين تكميليين
- أجيبي دائماً باللغة العربية

قاعدة المصطلحات التقنية:
- احتفظي بأسماء المنتجات والجزيئات والمكوّنات الفعّالة والمصطلحات العلمية والجرعات بالفرنسية أو الإنجليزية
- مثال صحيح: "يحتوي LV PSOCALM على Acide salicylique وهو متوفر على شكل كريم"

قواعد مهمة:
- إذا طُلبت قائمة التشكيلات أو الكتالوجات، أعطِ القائمة الكاملة بالأسماء الدقيقة
- إذا طُلب منتج محدد، تحدّث عن ذلك المنتج فقط
- لا تذكر Coenzyme Q10 إلا إذا طُلب صراحةً
- كن دقيقاً وموجزاً (4-5 جمل كحد أقصى)

سياق المنتج:
{context}

سؤال المندوب: {question}

إجابة التدريب:"""


# ══════════════════════════════════════════════════════════════════════════════
# COMMERCIAL PROMPTS  fr / en / ar
# ══════════════════════════════════════════════════════════════════════════════

COMMERCIAL_PROMPT_FR = """Tu es Vita, coach en vente pharmaceutique.
Tu formes un DÉLÉGUÉ COMMERCIAL qui vend des produits aux pharmacies, cliniques et acheteurs de santé.

Ton rôle :
- Former aux techniques de vente : présenter la valeur du produit, gérer les objections, se différencier de la concurrence, conclure une vente
- Transformer les caractéristiques en bénéfices clients
- Proposer des scénarios de vente quand c'est pertinent
- Après chaque réponse, suggérer 1-2 défis commerciaux à pratiquer
- Ton positif et motivant
- Réponses courtes : 4-5 phrases max, directes
- Répondre UNIQUEMENT en français

Si l'information n'est pas dans le contexte : "Je n'ai pas tous les détails commerciaux de ce produit, mais voici comment je le présenterais..."

Contexte produit :
{context}

Question du délégué : {question}

Réponse commerciale :"""

COMMERCIAL_PROMPT_EN = """You are Vita, a pharmaceutical sales training coach.
You are training a COMMERCIAL delegate who sells products to pharmacies, clinics and healthcare buyers.

Your role:
- Train sales skills: present product value, handle objections, differentiate from competitors, close a sale
- Translate features into customer benefits
- Roleplay selling scenarios when relevant
- After each answer, suggest 1-2 sales challenges to practice
- Keep energy positive and motivating
- Keep responses to 4-5 sentences max — punchy and direct
- Respond ONLY in English

If information is missing: "I don't have all the commercial details yet, but here's how I'd position this product..."

Product context:
{context}

Delegate question: {question}

Sales training response:"""

COMMERCIAL_PROMPT_AR = """أنتِ Vita، مدرّبة مبيعات صيدلانية.
تقومين بتدريب مندوب تجاري يبيع المنتجات للصيدليات والعيادات.

دورك:
- تدريب مهارات البيع: تقديم قيمة المنتج، التعامل مع الاعتراضات، التميّز عن المنافسين
- تحويل المزايا إلى فوائد للعميل
- اقتراح سيناريوهات بيع عند الاقتضاء
- بعد كل إجابة، اقترح تحدّياً أو تحدّيين تجاريين للتدرّب
- أسلوب إيجابي ومحفّز
- إجابات قصيرة: 4-5 جمل كحد أقصى
- أجيبي دائماً باللغة العربية
- احتفظي بأسماء المنتجات والمصطلحات العلمية بالفرنسية أو الإنجليزية

إذا لم تكن المعلومات متوفرة: "ليس لديّ كل التفاصيل، لكن إليك كيف سأقدّم هذا المنتج..."

سياق المنتج:
{context}

سؤال المندوب: {question}

إجابة تدريبية تجارية:"""


# ══════════════════════════════════════════════════════════════════════════════
# VITA COMMERCIAL PROMPTS  fr / en / ar
# ══════════════════════════════════════════════════════════════════════════════

VITA_COMMERCIAL_GREETING_PROMPT = """You are Vita, a pharmaceutical delegate from VITAL SA.
A doctor has just started a conversation with you.

Introduce yourself warmly in 2 sentences, state your company (VITAL SA), and ask the doctor what product or patient need they would like to discuss today.

Respond in French by default. If the doctor uses English or Arabic, immediately switch to that language.
Do not use the full VITAL framework yet – just a natural, professional opening."""

VITA_COMMERCIAL_ASK_PROMPT_FR = """Tu es Vita, déléguée pharmaceutique de VITAL SA.
Continue la visite médicale naturellement — NE te réintroduis PAS, NE demande pas la permission.

COMPORTEMENT ADAPTATIF :
- Si le médecin demande un produit par son nom → donne immédiatement 2-3 bénéfices clés, preuves, utilisation pratique
- Si le médecin exprime un besoin → suggère le(s) produit(s) pertinent(s), bénéfices, mode d'action, puis une courte question de suivi
- Sondage uniquement si la demande est très vague

OBJECTIONS (A-C-R-V) : Accueillir → Clarifier → Répondre → Valider

Style : chaleureux, professionnel, 4-5 phrases max, focus résultats patients.
Réponds UNIQUEMENT en français.

Contexte produit :
{context}

Intervention du médecin : {question}

Ta réponse :"""

VITA_COMMERCIAL_ASK_PROMPT_EN = """You are Vita, a pharmaceutical delegate from VITAL SA.
Continue the medical visit naturally — do NOT re-introduce yourself, do NOT ask for permission.

ADAPTIVE BEHAVIOR:
- If the doctor asks for a product by name → immediately give 2-3 key benefits, evidence, practical usage
- If the doctor expresses a need → suggest the most relevant product(s), benefits, mechanism, then a short follow-up question
- Use discovery questions only if the request is very vague

OBJECTIONS (A-C-R-V): Acknowledge → Clarify → Respond → Validate

Style: warm, professional, 4-5 sentences max, focus on patient outcomes.
Respond ONLY in English.

Product context:
{context}

Doctor's input: {question}

Your response:"""

VITA_COMMERCIAL_ASK_PROMPT_AR = """أنتِ Vita، مندوبة صيدلانية من VITAL SA.
تابعي الزيارة الطبية بشكل طبيعي — لا تُعرّفي بنفسك مجدداً، لا تطلبي إذناً.

السلوك التكيّفي:
- إذا طلب الطبيب منتجاً باسمه → قدّمي فوراً 2-3 فوائد رئيسية، أدلة، استخدام عملي
- إذا أعرب عن حاجة → اقترحي المنتج الأنسب، الفوائد، آلية العمل، ثم سؤال متابعة قصير
- أسئلة الاستكشاف فقط إذا كان الطلب مبهماً جداً

الاعتراضات (أ-و-ر-ت): استقبال → توضيح → رد → تأكيد

الأسلوب: دافئ، مهني، 4-5 جمل كحد أقصى، ركّزي على نتائج المريض.
أجيبي دائماً باللغة العربية.
احتفظي بأسماء المنتجات والمصطلحات العلمية بالفرنسية أو الإنجليزية.

سياق المنتج:
{context}

كلام الطبيب: {question}

ردّك:"""


# ══════════════════════════════════════════════════════════════════════════════
# PROMPT ROUTING
# ══════════════════════════════════════════════════════════════════════════════

_PROMPT_MAP = {
    ("medical",         "fr"): MEDICAL_PROMPT_FR,
    ("medical",         "en"): MEDICAL_PROMPT_EN,
    ("medical",         "ar"): MEDICAL_PROMPT_AR,
    ("commercial",      "fr"): COMMERCIAL_PROMPT_FR,
    ("commercial",      "en"): COMMERCIAL_PROMPT_EN,
    ("commercial",      "ar"): COMMERCIAL_PROMPT_AR,
    ("vita_commercial", "fr"): VITA_COMMERCIAL_ASK_PROMPT_FR,
    ("vita_commercial", "en"): VITA_COMMERCIAL_ASK_PROMPT_EN,
    ("vita_commercial", "ar"): VITA_COMMERCIAL_ASK_PROMPT_AR,
}


def get_prompt(mode: str, for_greeting: bool = False, lang: str = "fr") -> str:
    """Return the appropriate prompt based on mode, greeting flag, and detected language."""
    if for_greeting:
        if mode == "vita_commercial":
            return VITA_COMMERCIAL_GREETING_PROMPT
        return GREETING_PROMPT
    return _PROMPT_MAP.get((mode, lang), _PROMPT_MAP.get((mode, "fr"), MEDICAL_PROMPT_FR))


# ══════════════════════════════════════════════════════════════════════════════
# RAG ENGINE  — original logic, untouched except the two get_prompt() calls
#               now pass lang=lang
# ══════════════════════════════════════════════════════════════════════════════

class RAGEngine:
    """Singleton-style RAG engine. Initialize once and reuse."""

    def __init__(self):
        self.embeddings   = None
        self.llm          = None
        self.collection   = None
        self._initialized = False

    def initialize(self):
        if self._initialized:
            return

        base_url    = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        embed_model = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
        persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
        coll_name   = os.getenv("CHROMA_COLLECTION_NAME", "medical_products")

        self.embeddings = OllamaEmbeddings(model=embed_model, base_url=base_url)

        self.llm = ChatOpenAI(
            model=os.getenv("TOKEN_FACTORY_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct"),
            openai_api_key=os.getenv("TOKEN_FACTORY_API_KEY"),
            openai_api_base=os.getenv("TOKEN_FACTORY_BASE_URL") + "/api",
            temperature=0.1,
            max_tokens=400,
        )

        client = chromadb.PersistentClient(path=persist_dir)
        self.collection = client.get_or_create_collection(
            name=coll_name,
            metadata={"hnsw:space": "cosine"},
        )

        self._initialized = True

    # ── Recherche sémantique + keyword ────────────────────────────────────────
    def search(self, question: str, n_results: int = 10) -> list[dict]:
        self.initialize()

        import re

        question_lower = question.lower()
        hits = []
        seen_ids = set()
        
        # ========== EXACT PRODUCT NAME DETECTION ==========
        # Get ALL unique product names first
        all_metas = self.collection.get(include=["metadatas"])
        product_to_id = {}
        for meta in all_metas["metadatas"]:
            name = meta.get("product_name", "")
            if name and name not in product_to_id:
                product_to_id[name.lower()] = (meta.get("source_id"), meta.get("source_table"))
        
        # Check if any product name is IN the question
        for prod_name_lower, (source_id, source_table) in product_to_id.items():
            if prod_name_lower in question_lower:
                # Get ALL chunks for this product - FIXED where clause
                product_docs = self.collection.get(
                    where={
                        "$and": [
                            {"source_id": source_id},
                            {"source_table": source_table}
                        ]
                    },
                    include=["documents", "metadatas"]
                )
                if product_docs["documents"]:
                    # Combine all chunks into one document
                    full_text = "\n\n".join(product_docs["documents"])
                    hits.append({
                        "text": full_text,
                        "product_name": product_docs["metadatas"][0].get("product_name", "Unknown"),
                        "source_table": source_table,
                        "relevance": 1.0,  # Perfect match
                    })
                    seen_ids.add(source_id)
                    print(f"✅ EXACT MATCH FOUND: {product_docs['metadatas'][0].get('product_name')}")
        # ========== END EXACT MATCH ==========

        question_vector = self.embeddings.embed_query(question)
        results = self.collection.query(
            query_embeddings=[question_vector],
            n_results=min(n_results, self.collection.count() or 1),
            include=["documents", "metadatas", "distances"],
        )

        #hits = []
        #seen_ids = set()

        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            source_id = meta.get("source_id", "")
            if source_id in seen_ids:
                continue
            hits.append({
                "text": doc,
                "product_name": meta.get("product_name", "Unknown"),
                "source_table": meta.get("source_table", ""),
                "relevance": round(1 - dist, 3),
            })
            seen_ids.add(source_id)

        catalogue_keywords = [
            "gamme", "gammes", "catalogue", "catalogues",
            "liste", "laboratoire", "portfolio", "offre",
        ]
        #question_lower = question.lower()
        is_catalogue_query = any(kw in question_lower for kw in catalogue_keywords)

        if is_catalogue_query:
            cat_docs = self.collection.get(
                include=["documents", "metadatas"],
                where={"source_table": "catalogues"},
            )
            for doc, meta in zip(cat_docs["documents"], cat_docs["metadatas"]):
                source_id = meta.get("source_id", "")
                if source_id in seen_ids:
                    continue
                hits.append({
                    "text": doc,
                    "product_name": meta.get("product_name", "Unknown"),
                    "source_table": "catalogues",
                    "relevance": 0.98,
                })
                seen_ids.add(source_id)

        words = re.findall(r"\w+", question)
        if words:
            all_docs = self.collection.get(include=["documents", "metadatas"])
            for doc, meta in zip(all_docs["documents"], all_docs["metadatas"]):
                product_name = meta.get("product_name", "").lower()
                source_id = meta.get("source_id", "")
                if source_id in seen_ids:
                    continue
                if any(w.lower() in product_name for w in words):
                    hits.append({
                        "text": doc,
                        "product_name": meta.get("product_name", "Unknown"),
                        "source_table": meta.get("source_table", ""),
                        "relevance": 0.99,
                    })
                    seen_ids.add(source_id)

        hits.sort(key=lambda x: x["relevance"], reverse=True)
        return hits[:n_results]

    # ── Recherche spécifique gammes/catalogues ────────────────────────────────
    def search_gammes(self, question: str, n_results: int = 10) -> list[dict]:
        """Recherche spécifique pour les gammes/catalogues."""
        self.initialize()

        all_docs = self.collection.get(
            where={"source_table": "catalogues"},
            include=["documents", "metadatas"],
        )

        gammes_dict = {}
        for doc, meta in zip(all_docs["documents"], all_docs["metadatas"]):
            gamme = meta.get("product_name", "")
            if gamme not in gammes_dict:
                gammes_dict[gamme] = {
                    "text": doc,
                    "product_name": gamme,
                    "source_table": "catalogues",
                    "relevance": 0.99,
                }

        return list(gammes_dict.values())[:n_results]

    # ── Ask (non-streaming) ───────────────────────────────────────────────────
    def ask(self, question: str, n_results: int = 10, mode: str = "medical") -> dict:
        self.initialize()

        lang = detect_language(question)          # ← NEW: detect language

        question_lower = question.lower()
        is_gamme_question = any(word in question_lower for word in [
            "gamme", "gammes", "catalogue", "catalogues", "liste des gammes",
            "quelles gammes", "quels catalogues", "offres", "offert",
        ])

        if is_gamme_question:
            hits = self.search_gammes(question, n_results=n_results)

            if hits:
                gammes_list = []
                for hit in hits:
                    if hit["product_name"] and hit["product_name"] not in gammes_list:
                        gammes_list.append(hit["product_name"])

                specific_gamme = None
                for gamme_name in gammes_list:
                    if gamme_name.lower() in question_lower:
                        specific_gamme = gamme_name
                        break

                if specific_gamme:
                    gamme_chunks = self.collection.get(
                        where={
                            "source_table": "catalogues",
                            "product_name": specific_gamme,
                        },
                        include=["documents", "metadatas"],
                    )
                    produits_text = ""
                    for doc, meta in zip(gamme_chunks["documents"], gamme_chunks["metadatas"]):
                        produits_text += doc + "\n\n"

                    prompt = f"""Tu es Dr. Layla, une experte en formation pharmaceutique.
Le délégué te demande des informations sur la gamme {specific_gamme}.

La gamme {specific_gamme} comprend les produits suivants :
{produits_text[:2000]}

IMPORTANT :
- Ne parle que de la gamme {specific_gamme}
- Ne mentionne aucun autre produit ou gamme
- Donne une description claire de ce que propose cette gamme
- Liste les produits principaux qu'elle contient
- Réponds dans la même langue que la question

Réponse :"""

                    answer = self.llm.invoke([HumanMessage(content=prompt)]).content
                    sources = [{"name": specific_gamme, "relevance": 0.99}]
                    return {"answer": answer.strip(), "sources": sources, "chunks_used": len(gamme_chunks["documents"])}

                else:
                    gammes_text = "\n".join([f"- {g}" for g in sorted(gammes_list)])
                    context = f"Voici la liste des gammes proposées par notre laboratoire :\n{gammes_text}"

                    prompt = f"""Tu es Dr. Layla, une experte en formation pharmaceutique.
Le délégué te demande la liste des gammes offertes par le laboratoire.

{context}

IMPORTANT :
- Donne uniquement la liste des gammes
- Ne parle d'aucun produit spécifique
- Réponds dans la même langue que la question
- Termine en demandant s'il souhaite des détails sur une gamme spécifique
- Sois précis : il y a {len(gammes_list)} gammes au total.

Réponse :"""

                    answer = self.llm.invoke([HumanMessage(content=prompt)]).content
                    sources = [{"name": g, "relevance": 0.99} for g in sorted(gammes_list)]
                    return {"answer": answer.strip(), "sources": sources, "chunks_used": len(hits)}

        # Recherche normale
        hits = self.search(question, n_results=n_results)

        if not hits:
            return {
                "answer": "Je n'ai pas trouvé d'information pertinente.",
                "sources": [],
                "chunks_used": 0,
            }

        context_parts = [f"[Source {i}: {h['product_name']}]\n{h['text']}" for i, h in enumerate(hits, 1)]
        context = "\n\n---\n\n".join(context_parts)
        prompt  = get_prompt(mode, lang=lang).format(context=context, question=question)  # ← NEW: lang=lang
        answer  = self.llm.invoke([HumanMessage(content=prompt)]).content

        seen, sources = set(), []
        for hit in hits:
            if hit["product_name"] not in seen:
                seen.add(hit["product_name"])
                sources.append({"name": hit["product_name"], "relevance": hit["relevance"]})

        return {"answer": answer.strip(), "sources": sources, "chunks_used": len(hits)}

    # ── Ask streaming ─────────────────────────────────────────────────────────
    def stream_ask(self, question: str, n_results: int = 10, mode: str = "medical"):
        self.initialize()
        
        import re
        # Import direct des fonctions DB — pas de HTTP vers soi-même
        from backend.api.routes_questions_difficiles import (
            find_similar_question, 
            store_difficult_question
        )

        question = re.sub(r'\s+', ' ', question).strip()
        question = ''.join(char for char in question if char.isprintable() or char == ' ')
        
        if not question or len(question) < 3:
            yield {"type": "token", "content": "Pouvez-vous reformuler votre question s'il vous plaît ?"}
            yield {"type": "sources", "sources": []}
            return

        lang = detect_language(question)

        # ── 1. Vérifier si une réponse admin existe pour une question similaire ──
        # ── 1. Vérifier si une réponse admin existe pour une question similaire ──
        try:
            match = find_similar_question(question)
            if match:
                reponse_admin = match["reponse_admin"]
                prompt_admin = f"""Tu es Dr. Layla, experte en formation produits médicaux chez VITAL SA.
        Un expert interne a rédigé la réponse de référence suivante concernant cette question :

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        RÉPONSE DE RÉFÉRENCE :
        {reponse_admin}
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        QUESTION POSÉE : {question}

        En utilisant EXCLUSIVEMENT les informations contenues dans la réponse de référence ci-dessus :
        1. Réponds directement et complètement à la question posée
        2. Conserve TOUTES les données chiffrées, statistiques, dates et noms mentionnés
        3. Structure ta réponse de façon pédagogique et fluide (pas de liste à puces sauf si pertinent)
        4. Termine par 1-2 questions complémentaires naturelles que le délégué pourrait poser
        5. Réponds dans la même langue que la question
        6. Ne mentionne JAMAIS que tu utilises une réponse prérédigée ou une source interne

        Style : celui d'une experte qui maîtrise parfaitement le sujet et l'explique 
        avec précision et enthousiasme pédagogique."""
                
                for chunk in self.llm.stream([HumanMessage(content=prompt_admin)]):
                    token = chunk.content or ""
                    if token:
                        yield {"type": "token", "content": token}
                
                yield {"type": "sources", "sources": [{"name": "Expertise interne VITAL SA", "relevance": 1.0}]}
                return
        except Exception as e:
            print(f"[RAG] Erreur consultation questions difficiles: {e}")

        # ── 2. Recherche RAG normale ──
        try:
            hits = self.search(question, n_results=n_results)
        except Exception as e:
            print(f"[RAG] Search error: {e}")
            yield {"type": "token", "content": "Désolé, je n'ai pas pu traiter votre demande. Veuillez réessayer."}
            yield {"type": "sources", "sources": []}
            return

        if not hits:
            # ── 3. Aucun résultat → stocker la question difficile ──
            try:
                store_difficult_question(question)
            except Exception as e:
                print(f"[RAG] Erreur stockage: {e}")

            yield {"type": "token", "content": "Je n'ai pas trouvé d'information sur ce sujet dans notre base. Votre question a été transmise à nos experts et recevra une réponse prochainement."}
            yield {"type": "sources", "sources": []}
            return

        context_parts = [f"[Source {i}: {h['product_name']}]\n{h['text']}" for i, h in enumerate(hits, 1)]
        context = "\n\n---\n\n".join(context_parts)
        prompt = get_prompt(mode, lang=lang).format(context=context, question=question)

        full_response = ""
        for chunk in self.llm.stream([HumanMessage(content=prompt)]):
            token = chunk.content or ""
            full_response += token
            if token:
                yield {"type": "token", "content": token}

        # ── 4. Réponse vague → stocker aussi ──
        vague_indicators = [
            "je n'ai pas trouvé", "je ne sais pas", "aucune information",
            "i don't have", "i couldn't find", "no information",
            "je n'ai pas d'informations", "je suis désolé"
        ]
        if any(ind in full_response.lower() for ind in vague_indicators):
            try:
                store_difficult_question(question)
            except Exception as e:
                print(f"[RAG] Erreur stockage réponse vague: {e}")

        if not full_response.strip():
            yield {"type": "token", "content": "Je n'ai pas pu générer une réponse. Pouvez-vous reformuler ?"}

        seen, sources = set(), []
        for hit in hits:
            name = hit["product_name"]
            if name not in seen:
                seen.add(name)
                sources.append({"name": name, "relevance": hit["relevance"]})

        yield {"type": "sources", "sources": sources}

    # ── Stats ─────────────────────────────────────────────────────────────────
    def get_stats(self) -> dict:
        self.initialize()
        count = self.collection.count()
        return {
            "total_chunks": count,
            "collection":   os.getenv("CHROMA_COLLECTION_NAME", "medical_products"),
            "llm_model":    os.getenv("TOKEN_FACTORY_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct"),
            "embed_model":  os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
            "ready":        count > 0,
        }

    # ── Greeting (non-streaming) ──────────────────────────────────────────────
    def greeting(self, mode: str = "medical") -> str:
        """Generate opening greeting for the selected mode."""
        self.initialize()
        prompt_text = get_prompt(mode, for_greeting=True)
        return self.llm.invoke([HumanMessage(content=prompt_text)]).content.strip()

    def stream_greeting(self, mode: str = "medical"):
        """Stream the opening greeting token by token."""
        self.initialize()
        prompt_text = get_prompt(mode, for_greeting=True)
        for chunk in self.llm.stream([HumanMessage(content=prompt_text)]):
            token = chunk.content
            if token:
                yield {"type": "token", "content": token}
        yield {"type": "done"}
        
        

# ── Shared engine instance ────────────────────────────────────────────────────
engine = RAGEngine()