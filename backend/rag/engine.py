"""
rag_engine.py
=============
Core RAG logic. Called by the API.

Given a user question:
  1. Embeds the question using Ollama
  2. Searches ChromaDB for the most relevant product chunks
  3. Builds a prompt with context + question
  4. Streams the answer from the LLM
"""

import os
from dotenv import load_dotenv
from langchain_ollama import OllamaEmbeddings, OllamaLLM
import chromadb

load_dotenv()


# ── Greeting prompt — sent on first load, no product context needed ───────────
GREETING_PROMPT = """You are Vita, a professional training assistant for a pharmaceutical company.

A delegate has just opened the training platform. Greet them warmly and ask them which training mode they want:

1. Medical delegate training — deep product knowledge: indications, composition, mechanism, clinical use, medical terminology. For delegates who speak with doctors and pharmacists.
2. Commercial delegate training — sales skills: how to present the product convincingly, handle objections, highlight benefits over competitors, build trust with clients. For delegates who sell to pharmacies and clinics.

Keep the greeting short, friendly and professional. Ask clearly which mode they prefer. 
Respond in French by default. If the delegate responds in another language, immediately switch to that language.
Do NOT mention any products yet. Just greet and ask for the training mode."""


# ── Medical delegate prompt ────────────────────────────────────────────────────
# Dans engine.py, modifie MEDICAL_PROMPT :

MEDICAL_PROMPT = """Tu es Dr. Layla, une experte en formation produits médicaux.
Tu formes un DÉLÉGUÉ MÉDICAL qui présente des produits aux médecins et pharmaciens.

Ton rôle :
- Enseigner la connaissance approfondie des produits : indications, composition, mécanisme d'action, données cliniques
- Expliquer les concepts de manière pédagogique
- Après chaque réponse, suggérer 1-2 questions complémentaires
- Répondre dans la même langue que le délégué

RÈGLES IMPORTANTES :
- Si on te demande la LISTE DES GAMMES ou les CATALOGUES, donne la liste complète avec les noms exacts
- Si on te demande un produit spécifique, ne parle que de ce produit
- Ne mentionne pas Coenzyme Q10 sauf si explicitement demandé
- Sois précis et concis (4-5 phrases max)

Contexte produit :
{context}

Question du délégué : {question}

Réponse de formation :"""


# ── Commercial delegate prompt ─────────────────────────────────────────────────
COMMERCIAL_PROMPT = """You are Vita, a pharmaceutical sales training coach for a pharmaceutical company.
You are training a COMMERCIAL delegate — someone who sells products to pharmacies, clinics and healthcare buyers.

Your role:
- Train sales skills: how to present the product's value, handle objections, differentiate from competitors, close a sale.
- Translate product features into customer benefits. Example: "Contains 3x more bioavailable iron" becomes "Your clients will see results faster and come back to buy again."
- Roleplay selling scenarios when relevant: "Here's how you would introduce this product to a pharmacy owner..."
- After answering, suggest 1-2 sales challenges the delegate should practice: objections, comparison questions, pricing discussions.
- Keep energy positive and motivating — a good sales coach is enthusiastic.
- Focus on: unique selling points, target customer profile, shelf placement tips, seasonal opportunities, loyalty arguments.
- Keep responses to 4-5 sentences max. Be punchy and direct — no long paragraphs or bullet lists.

CRITICAL LANGUAGE RULE: Detect the language of the delegate's question and respond ONLY in that exact language. If they write/speak in French → respond in French. If English → respond in English. If Arabic → respond in Arabic. Never switch languages mid-response. Never respond in a different language than the one used in the question. This rule overrides everything else.

If information is not in the context:
- French: "Je n'ai pas tous les détails commerciaux de ce produit, mais voici comment je le présenterais..."
- English: "I don't have all the commercial details yet, but here's how I'd position this product..."
- Always reframe limited info into a sales opportunity, never just say "I don't know."

Context from product database:
{context}

Delegate question: {question}

Sales training response (be motivating, practical, suggest objection handling at the end):"""

# Commercial mode – vita acts as delegate
VITA_COMMERCIAL_PROMPT = """You are Vita, a pharmaceutical delegate from VITAL SA.
Your role is to conduct a natural, flowing medical visit with a doctor (the user). Follow the VITAL framework flexibly, not rigidly.

CRITICAL LANGUAGE RULE: 
- Detect the language of the doctor's input (French, English, or Arabic)
- Respond ONLY in that exact language throughout the entire conversation
- If the doctor switches language mid-conversation, you MUST switch to that new language immediately
- Never mix languages in a single response
- Do not explain which language you're using – just respond in that language

ADAPTIVE BEHAVIOR:
- If the doctor directly asks for a specific product by name (e.g., "Tell me about LV PSOCALM"), provide the information immediately: 2-3 key benefits, evidence, and practical usage.
- If the doctor expresses a need or condition (e.g., "I need a supplement for vitamin A", "What do you have for anxiety?"), **suggest the most relevant product(s)** from your knowledge or the context. Give its key benefits, how it works, and practical usage. Then optionally ask a short follow-up question to engage further (e.g., "Would this be suitable for your patients?", "Would you like to know more?").
- Only use Sondage (discovery questions) when the doctor's request is very vague or you truly lack enough information to make a recommendation. For example, if the doctor says "I have a patient with fatigue" without any specifics, you might ask about the type of fatigue, patient profile, etc. But if the need is clear, go straight to the product information.

THE VITAL FRAMEWORK (use flexibly, repeat as needed):

1. INTRODUCTION (Instant Zero)
   - Start with a warm greeting, state who you are, ask for permission
   - Be brief and respectful of time

2. SONDAGE (Discovery & Understanding)
   - Ask open questions to understand the doctor's needs, practice, patient profiles
   - Listen actively and adapt based on their answers
   - You may return to this at any time if you need more context

3. SYNTHÈSE (Reformulation)
   - Periodically summarize what you've understood to ensure alignment
   - Show that you're listening and value their input

4. ARGUMENTATION (Benefits & Evidence)
   - Present product benefits linked to the doctor's expressed needs
   - Provide evidence (studies, data, clinical experience) naturally
   - You may give multiple arguments over several exchanges
   - Focus on patient outcomes and practical value

5. OBJECTIONS (A-C-R-V)
   - When objections arise, handle them immediately:
        * Accueillir / Acknowledge with empathy
        * Clarifier / Clarify to understand the real concern
        * Répondre / Respond with facts + evidence
        * Valider / Validate that the objection is resolved
   - You may handle several objections throughout the conversation
   - Never ignore or dismiss concerns

6. CONCLUSION & ENGAGEMENT
   - When the conversation reaches a natural closing point, propose a micro-commitment
   - Look for signals: detailed questions, resolved objections, interest in samples, request for follow-up
   - Keep it light and professional

CONVERSATION STYLE:
- Be warm, professional, and empathetic
- Read the doctor's tone and adapt (busy → be brief; engaged → go deeper)
- Use natural transitions, not scripts
- Let the conversation flow organically
- You are a trusted partner, not a salesperson

If information is missing from the context databse, say you don't have all the details and the department will come back to them.

Context from product database:
{context}

Doctor's input: {question}

Your response (as Vita) – have a natural conversation. Follow the VITAL framework flexibly. Respond in the EXACT SAME LANGUAGE as the doctor. Keep it warm, professional, and adaptive."""
def get_prompt(mode: str) -> str:
    if mode == "commercial":
        return COMMERCIAL_PROMPT
    elif mode == "vita_commercial":
        return VITA_COMMERCIAL_PROMPT
    return MEDICAL_PROMPT


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
        llm_model   = os.getenv("OLLAMA_LLM_MODEL", "llama3.1")
        persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
        coll_name   = os.getenv("CHROMA_COLLECTION_NAME", "medical_products")

        self.embeddings = OllamaEmbeddings(model=embed_model, base_url=base_url)

        self.llm = OllamaLLM(
            model=llm_model,
            base_url=base_url,
            temperature=0.1,      # Low temperature = more factual, less creative
            num_predict=400,     # Max tokens in the answer
        )

        client = chromadb.PersistentClient(path=persist_dir)
        self.collection = client.get_or_create_collection(
            name=coll_name,
            metadata={"hnsw:space": "cosine"},
        )

        self._initialized = True

    def search(self, question: str, n_results: int = 10) -> list[dict]:
        self.initialize()

        # 1. Semantic search (meaning-based)
        question_vector = self.embeddings.embed_query(question)
        results = self.collection.query(
            query_embeddings=[question_vector],
            n_results=min(n_results, self.collection.count() or 1),
            include=["documents", "metadatas", "distances"],
        )

        hits = []
        seen_ids = set()

        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            hits.append(
                {
                    "text": doc,
                    "product_name": meta.get("product_name", "Unknown"),
                    "source_table": meta.get("source_table", ""),
                    "relevance": round(1 - dist, 3),
                }
            )
            seen_ids.add(meta.get("source_id", ""))

        # 2. Special case: question about gammes/catalogues → force-inject catalogue chunks
        import re

        catalogue_keywords = [
            "gamme",
            "gammes",
            "catalogue",
            "catalogues",
            "liste",
            "laboratoire",
            "portfolio",
            "offre",
        ]
        question_lower = question.lower()
        is_catalogue_query = any(kw in question_lower for kw in catalogue_keywords)

        if is_catalogue_query:
            cat_docs = self.collection.get(
                include=["documents", "metadatas"], where={"source_table": "catalogues"}
            )
            for doc, meta in zip(cat_docs["documents"], cat_docs["metadatas"]):
                source_id = meta.get("source_id", "")
                if source_id in seen_ids:
                    continue
                hits.append(
                    {
                        "text": doc,
                        "product_name": meta.get("product_name", "Unknown"),
                        "source_table": "catalogues",
                        "relevance": 0.98,
                    }
                )
                seen_ids.add(source_id)

        # 3. Keyword search — match product name against question words
        words = [w for w in re.findall(r"\w+", question) if len(w) > 3]
        if words:
            all_docs = self.collection.get(include=["documents", "metadatas"])
            for doc, meta in zip(all_docs["documents"], all_docs["metadatas"]):
                product_name = meta.get("product_name", "").lower()
                source_id = meta.get("source_id", "")
                if source_id in seen_ids:
                    continue
                if any(w.lower() in product_name for w in words):
                    hits.append(
                        {
                            "text": doc,
                            "product_name": meta.get("product_name", "Unknown"),
                            "source_table": meta.get("source_table", ""),
                            "relevance": 0.99,
                        }
                    )
                    seen_ids.add(source_id)

        hits.sort(key=lambda x: x["relevance"], reverse=True)
        return hits[:n_results]


    def ask(self, question: str, n_results: int = 10, mode: str = "medical") -> dict:
        self.initialize()
    
        # Détection des questions sur les gammes
        question_lower = question.lower()
        is_gamme_question = any(word in question_lower for word in [
            "gamme", "gammes", "catalogue", "catalogues", "liste des gammes", 
            "quelles gammes", "quels catalogues", "offres", "offert"
        ])
    
        if is_gamme_question:
            # Utilise la recherche spéciale pour les gammes
            hits = self.search_gammes(question, n_results=n_results)
        
            if hits:
                # Construit la liste des gammes
                gammes_list = []
                for hit in hits:
                    if hit["product_name"] and hit["product_name"] not in gammes_list:
                        gammes_list.append(hit["product_name"])
            
                # 🔍 Détecter si on demande une gamme spécifique
                specific_gamme = None
                for gamme_name in gammes_list:
                    if gamme_name.lower() in question_lower:
                        specific_gamme = gamme_name
                        break
            
                # 🎯 Cas 1: L'utilisateur demande une gamme spécifique
                if specific_gamme:
                    # Récupérer tous les chunks de cette gamme spécifique
                    gamme_chunks = self.collection.get(
                        where={
                            "source_table": "catalogues",
                            "product_name": specific_gamme
                        },
                        include=["documents", "metadatas"]
                    )
                
                    # Extraire les infos produits de cette gamme
                    produits_text = ""
                    for doc, meta in zip(gamme_chunks["documents"], gamme_chunks["metadatas"]):
                       produits_text += doc + "\n\n"
                    
                    prompt = f"""Tu es Dr. Layla, une experte en formation pharmaceutique.
    Le délégué te demande des informations sur la gamme {specific_gamme}.

    La gamme {specific_gamme} comprend les produits suivants :
    {produits_text[:2000]}  # Limite pour éviter de dépasser la taille du contexte

    IMPORTANT : 
    - Ne parle que de la gamme {specific_gamme}
    - Ne mentionne aucun autre produit ou gamme
    - Donne une description claire de ce que propose cette gamme
    - Liste les produits principaux qu'elle contient
    - Réponds dans la même langue que la question

    Réponse :"""
                
                    answer = self.llm.invoke(prompt)
                    sources = [{"name": specific_gamme, "relevance": 0.99}]
                    return {"answer": answer.strip(), "sources": sources, "chunks_used": len(gamme_chunks["documents"])}
            
                # 📋 Cas 2: L'utilisateur demande la liste de TOUTES les gammes
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

    Réponse :"""
                
                    answer = self.llm.invoke(prompt)
                    sources = [{"name": g, "relevance": 0.99} for g in sorted(gammes_list)]
                    return {"answer": answer.strip(), "sources": sources, "chunks_used": len(hits)}
    
        # Sinon, recherche normale (produits, etc.)
        hits = self.search(question, n_results=n_results)
        
        if not hits:
            return {
                "answer": "Je n'ai pas trouvé d'information pertinente.",
                "sources": [],
                "chunks_used": 0,
            }
    
        context_parts = [f"[Source {i}: {h['product_name']}]\n{h['text']}" for i, h in enumerate(hits, 1)]
        context = "\n\n---\n\n".join(context_parts)
        prompt  = get_prompt(mode).format(context=context, question=question)
        answer  = self.llm.invoke(prompt)
    
        seen, sources = set(), []
        for hit in hits:
            if hit["product_name"] not in seen:
                seen.add(hit["product_name"])
                sources.append({"name": hit["product_name"], "relevance": hit["relevance"]})
    
        return {"answer": answer.strip(), "sources": sources, "chunks_used": len(hits)}

    def stream_ask(self, question: str, n_results: int = 10, mode: str = "medical"):
        self.initialize()
        hits = self.search(question, n_results=n_results)

        if not hits:
            yield {"type": "token", "content": "I couldn't find relevant product information."}
            yield {"type": "sources", "sources": []}
            return

        context_parts = [f"[Source {i}: {h['product_name']}]\n{h['text']}" for i, h in enumerate(hits, 1)]
        context = "\n\n---\n\n".join(context_parts)
        prompt  = get_prompt(mode).format(context=context, question=question)

        for token in self.llm.stream(prompt):
            yield {"type": "token", "content": token}

        # Send sources at the end
        seen    = set()
        sources = []
        for hit in hits:
            name = hit["product_name"]
            if name not in seen:
                seen.add(name)
                sources.append({"name": name, "relevance": hit["relevance"]})

        yield {"type": "sources", "sources": sources}

    def get_stats(self) -> dict:
        self.initialize()
        count = self.collection.count()
        return {
            "total_chunks":   count,
            "collection":     os.getenv("CHROMA_COLLECTION_NAME", "medical_products"),
            "llm_model":      os.getenv("OLLAMA_LLM_MODEL", "llama3.1"),
            "embed_model":    os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
            "ready":          count > 0,
        }

    def greeting(self) -> str:
        """Generate opening greeting asking which training mode the delegate wants."""
        self.initialize()
        return self.llm.invoke(GREETING_PROMPT).strip()

    def stream_greeting(self):
        """Stream the opening greeting token by token."""
        self.initialize()
        for token in self.llm.stream(GREETING_PROMPT):
            yield {"type": "token", "content": token}
        yield {"type": "done"}


# Shared engine instance
engine = RAGEngine()


# Dans engine.py, après la classe RAGEngine, ajoute cette méthode :

def search_gammes(self, question: str, n_results: int = 10) -> list[dict]:
    """Recherche spécifique pour les gammes/catalogues."""
    self.initialize()
    
    # 1. Récupère TOUS les chunks de la table catalogues
    all_docs = self.collection.get(
        where={"source_table": "catalogues"},
        include=["documents", "metadatas"]
    )
    
    # 2. Groupe par gamme pour éviter les doublons
    gammes_dict = {}
    for doc, meta in zip(all_docs["documents"], all_docs["metadatas"]):
        gamme = meta.get("product_name", "")
        if gamme not in gammes_dict:
            gammes_dict[gamme] = {
                "text": doc,
                "product_name": gamme,
                "source_table": "catalogues",
                "relevance": 0.99
            }
    
    hits = list(gammes_dict.values())
    return hits[:n_results]
def ask(self, question: str, n_results: int = 10, mode: str = "medical") -> dict:
    self.initialize()
    
    # Détection des questions sur les gammes
    question_lower = question.lower()
    is_gamme_question = any(word in question_lower for word in [
        "gamme", "gammes", "catalogue", "catalogues", "liste des gammes", 
        "quelles gammes", "quels catalogues", "offres", "offert"
    ])
    
    if is_gamme_question:
        # Utilise la recherche spéciale pour les gammes
        hits = self.search_gammes(question, n_results=n_results)
        
        if hits:
            # Construit une réponse spéciale pour les gammes
            gammes_list = []
            for hit in hits:
                if hit["product_name"] and hit["product_name"] not in gammes_list:
                    gammes_list.append(hit["product_name"])
            
            # Crée un prompt spécifique pour les gammes
            gammes_text = "\n".join([f"- {g}" for g in sorted(gammes_list)])
            context = f"Voici la liste des gammes proposées par notre laboratoire :\n{gammes_text}"
            
            prompt = f"""Tu es Dr. Layla, une experte en formation pharmaceutique.
Le délégué te demande la liste des gammes offertes par le laboratoire.

{context}

Réponds de manière claire et structurée en listant toutes les gammes.
Termine en demandant s'il souhaite des détails sur une gamme spécifique.
Réponds dans la même langue que la question.
Sois précis : il y a {len(gammes_list)} gammes au total.

Réponse :"""
            
            answer = self.llm.invoke(prompt)
            
            sources = [{"name": g, "relevance": 0.99} for g in sorted(gammes_list)]
            return {"answer": answer.strip(), "sources": sources, "chunks_used": len(hits)}
    
    # Sinon, recherche normale
    hits = self.search(question, n_results=n_results)
    
    if not hits:
        return {
            "answer": "Je n'ai pas trouvé d'information pertinente.",
            "sources": [],
            "chunks_used": 0,
        }
    
    context_parts = [f"[Source {i}: {h['product_name']}]\n{h['text']}" for i, h in enumerate(hits, 1)]
    context = "\n\n---\n\n".join(context_parts)
    prompt  = get_prompt(mode).format(context=context, question=question)
    answer  = self.llm.invoke(prompt)
    
    seen, sources = set(), []
    for hit in hits:
        if hit["product_name"] not in seen:
            seen.add(hit["product_name"])
            sources.append({"name": hit["product_name"], "relevance": hit["relevance"]})
    
    return {"answer": answer.strip(), "sources": sources, "chunks_used": len(hits)}
