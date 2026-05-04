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
    lang: str = "fr"  # fr | en | ar

class FeedbackRequest(BaseModel):
    question: str
    product: str
    sales_skill: str
    chosen: str
    correct: str
    explanation: str
    is_correct: bool
    lang: str = "fr"


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


# ══════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPTS — Rôle du modèle, règles absolues, langue forcée
# ══════════════════════════════════════════════════════════════════════════════
QUIZ_COMMERCIAL_SYSTEM_PROMPTS = {
    "fr": """Tu es un expert formateur en vente pharmaceutique terrain chez VITAL SA — 15 ans d'expérience, tu as accompagné des centaines de délégués en pharmacie et parapharmacie.

TON RÔLE : Générer des QCM de simulation de visite officinale ultra-réalistes qui entraînent les délégués commerciaux à gérer :
• des présentations produit convaincantes
• des objections terrain réelles (prix, concurrent, espace, scepticisme)
• des fermetures de commande sous pression
• la différenciation face à la concurrence

RÈGLES DE GÉNÉRATION NON NÉGOCIABLES :
1. Les scénarios se passent EXCLUSIVEMENT en pharmacie ou parapharmacie (jamais hôpital, cabinet médecin, patient direct)
2. Le délégué agit TOUJOURS en professionnel — pas de pression abusive, pas de mensonge
3. Les questions testent l'INTELLIGENCE COMMERCIALE, pas les connaissances médicales
4. Les réponses sont des formulations réalistes qu'un délégué dirait à voix haute
5. La réponse correcte reflète la MEILLEURE PRATIQUE de vente pharmaceutique terrain
6. Utilise UNIQUEMENT le nom commercial du produit (jamais la molécule seule)
7. Réponds UNIQUEMENT en JSON valide — aucun texte avant ni après
8. LANGUE : Rédige TOUT le contenu JSON exclusivement en FRANÇAIS""",

    "en": """You are an expert pharmaceutical field sales trainer at VITAL SA — 15 years of experience coaching hundreds of sales representatives in pharmacies and parapharmacies.

YOUR ROLE: Generate ultra-realistic pharmacy visit simulation MCQs that train commercial delegates to handle:
• convincing product presentations
• real field objections (price, competitor, shelf space, skepticism)
• closing orders under pressure
• differentiation against competitors

NON-NEGOTIABLE GENERATION RULES:
1. Scenarios take place EXCLUSIVELY in a pharmacy or parapharmacy (never hospital, doctor's office, direct patient)
2. The delegate ALWAYS acts professionally — no abusive pressure, no dishonesty
3. Questions test COMMERCIAL INTELLIGENCE, not medical knowledge
4. Answers are realistic phrasings a delegate would actually say out loud
5. The correct answer reflects the BEST PRACTICE in pharmaceutical field sales
6. Use ONLY the commercial product name (never the molecule name alone)
7. Reply ONLY with valid JSON — no text before or after
8. LANGUAGE: Write ALL JSON content exclusively in ENGLISH""",

    "ar": """أنت خبير في تدريب مبيعات الأدوية الميدانية في شركة VITAL SA — خبرة 15 سنة في تأهيل مئات المندوبين التجاريين في الصيدليات وشبه صيدلية.

دورك: توليد أسئلة اختيار من متعدد محاكاة لزيارة صيدلية فائقة الواقعية، تدرّب المندوبين على:
• عروض المنتجات المقنعة
• الاعتراضات الميدانية الحقيقية (السعر، المنافس، المساحة، التشكيك)
• إتمام الطلبات تحت الضغط
• التمييز في مواجهة المنافسة

قواعد التوليد غير القابلة للتفاوض:
1. السيناريوهات تجري حصراً في صيدلية أو شبه صيدلية (ليس مستشفى أو عيادة أو مريض مباشر)
2. المندوب يتصرف دائماً باحترافية — لا ضغط مفرط، لا كذب
3. الأسئلة تختبر الذكاء التجاري، ليس المعرفة الطبية
4. الإجابات صياغات واقعية يقولها مندوب بصوت عالٍ فعلاً
5. الإجابة الصحيحة تعكس أفضل الممارسات في المبيعات الصيدلانية الميدانية
6. استخدم فقط الاسم التجاري للمنتج (ليس اسم الجزيء وحده)
7. أجب فقط بـ JSON صالح — لا نص قبله أو بعده
8. اللغة: اكتب كل محتوى JSON باللغة العربية حصراً""",
}


# ══════════════════════════════════════════════════════════════════════════════
# COMMERCIAL ANGLES — Axes de formation testés
# ══════════════════════════════════════════════════════════════════════════════
COMMERCIAL_ANGLES = {
    "fr": [
        "pitch produit en 30 secondes au comptoir occupé",
        "gestion de l'objection prix — justification de la valeur",
        "différenciation face à un concurrent déjà référencé",
        "argumentation rotation de stock et rentabilité",
        "fermeture de commande après objection",
        "réponse à un pharmacien sceptique sur l'efficacité",
        "négociation de visibilité en rayon ou en vitrine",
        "profil patient idéal — conseil de recommandation active",
        "technique FAB appliquée au contexte officinal",
        "reframing d'une objection en opportunité commerciale",
        "gestion d'un pharmacien qui coupe la parole",
        "introduction d'un nouveau produit sans référence préalable",
    ],
    "en": [
        "30-second product pitch at a busy counter",
        "price objection handling — value justification",
        "differentiation against an already-listed competitor",
        "stock rotation and profitability argumentation",
        "order closing after objection",
        "responding to a pharmacist skeptical about effectiveness",
        "negotiating shelf or window visibility",
        "ideal patient profile — active recommendation counseling",
        "FAB technique applied in a pharmacy context",
        "reframing an objection into a commercial opportunity",
        "handling a pharmacist who interrupts the pitch",
        "introducing a new product with no prior listing",
    ],
    "ar": [
        "عرض تقديمي للمنتج في 30 ثانية أمام كاونتر مشغول",
        "التعامل مع اعتراض السعر — تبرير القيمة",
        "التمييز في مواجهة منافس موجود بالفعل",
        "الحجج حول دوران المخزون والربحية",
        "إتمام الطلب بعد الاعتراض",
        "الرد على صيدلاني متشكك في الفعالية",
        "التفاوض على الظهور في الرف أو الواجهة",
        "الملف المريض المثالي — نصيحة التوصية النشطة",
        "تقنية FAB مطبقة في سياق الصيدلية",
        "تحويل الاعتراض إلى فرصة تجارية",
        "التعامل مع صيدلاني يقاطع العرض التقديمي",
        "تقديم منتج جديد دون مرجع سابق",
    ],
}


# ══════════════════════════════════════════════════════════════════════════════
# SCENARIO CONTEXTS — Interlocuteurs et situations terrain
# ══════════════════════════════════════════════════════════════════════════════
SCENARIO_CONTEXTS = {
    "fr": [
        # Facile-compatible (neutres ou réceptifs)
        ("un pharmacien adjoint", "curieux, qui veut en savoir plus sur les nouveautés pour mieux conseiller ses clients"),
        ("une parapharmacienne", "qui cherche de nouvelles références à proposer au comptoir"),
        ("un pharmacien titulaire", "qui reçoit bien les délégués et pose des questions ouvertes sur les indications"),
        # Moyen-compatible (objections terrain)
        ("un pharmacien titulaire", "qui gère son officine depuis 20 ans et négocie dur sur les marges"),
        ("le responsable des achats d'une pharmacie", "qui compare systématiquement les prix et les rotations avec la concurrence"),
        ("une pharmacienne titulaire", "sceptique sur les nouveautés, fidèle à ses références habituelles depuis des années"),
        ("un pharmacien", "qui dit être déjà bien référencé et ne pas avoir de place en rayon pour un nouveau produit"),
        ("le gérant d'une parapharmacie", "focalisé sur la rotation des stocks et le prix d'achat, peu sensible aux arguments marketing"),
        ("une pharmacienne", "qui a eu une mauvaise expérience commerciale avec un produit similaire d'un concurrent"),
        # Expert-compatible (hostile, pression, pièges)
        ("un pharmacien titulaire", "qui est en train de servir un client et qui répond sans regarder le délégué"),
        ("une pharmacienne titulaire", "qui reçoit 5 délégués par semaine, lasse des discours génériques, qui coupe la parole"),
        ("le responsable des achats d'un groupement de pharmacies", "qui compare agressivement les marges et questionne la légitimité clinique"),
        ("un pharmacien", "qui demande des preuves cliniques avant de référencer quoi que ce soit, et cite un concurrent moins cher"),
        ("le chef de rayon parapharmacie d'une grande surface", "focalisé sur la rentabilité au m², qui rappelle un retour produit passé"),
        ("une pharmacienne", "cynique après une démarque récente sur un produit similaire, qui dit qu'elle ne veut pas de stock mort"),
    ],
    "en": [
        # Easy-compatible
        ("an assistant pharmacist", "curious, wanting to learn about new products to better advise customers"),
        ("a parapharmacy advisor", "looking for new references to recommend at the counter"),
        ("a head pharmacist", "receptive to reps and asking open questions about product indications"),
        # Intermediate-compatible
        ("a head pharmacist", "who has run their pharmacy for 20 years and negotiates hard on margins"),
        ("the purchasing manager of a pharmacy", "who systematically compares prices and turnover against competitors"),
        ("a head pharmacist", "skeptical about new products, loyal to her usual references for years"),
        ("a pharmacist", "who claims they are already well-stocked and have no shelf space for a new product"),
        ("the manager of a parapharmacy", "focused on stock turnover and purchase price, unmoved by marketing arguments"),
        ("a pharmacist", "who had a bad commercial experience with a similar competing product"),
        # Expert-compatible
        ("a head pharmacist", "currently serving a customer and answering without looking at the rep"),
        ("a head pharmacist", "who sees 5 reps a week, tired of generic pitches, who interrupts mid-sentence"),
        ("the purchasing director of a pharmacy group", "aggressively comparing margins and challenging clinical legitimacy"),
        ("a pharmacist", "demanding clinical proof before listing anything, and citing a cheaper competitor"),
        ("the parapharmacy department head of a supermarket", "focused on m² profitability, referencing a past product return"),
        ("a pharmacist", "cynical after a recent markdown on a similar product, saying she refuses dead stock"),
    ],
    "ar": [
        # مبتدئ
        ("صيدلاني مساعد", "فضولي، يريد معرفة المزيد عن المنتجات الجديدة لتقديم نصائح أفضل لعملائه"),
        ("مستشارة شبه صيدلية", "تبحث عن مراجع جديدة لاقتراحها عند الكاونتر"),
        ("صيدلاني مالك", "يرحب بالمندوبين ويطرح أسئلة مفتوحة حول مؤشرات المنتج"),
        # متوسط
        ("صيدلاني مالك", "يدير صيدليته منذ 20 عاماً ويتفاوض بشدة على الهوامش"),
        ("مسؤول المشتريات في صيدلية", "يقارن الأسعار ودوران المخزون مع المنافسين باستمرار"),
        ("صيدلانية مالكة", "متشككة في المنتجات الجديدة، وفية لمراجعها المعتادة منذ سنوات"),
        ("صيدلاني", "يقول إنه مكتفٍ بالمنتجات ولا مكان في الرف لمنتج جديد"),
        ("مستشار شبه صيدلي", "مركّز على دوران المخزون وسعر الشراء، غير مبالٍ بالحجج التسويقية"),
        ("صيدلانية", "لديها تجربة تجارية سيئة مع منتج منافس مماثل"),
        # خبير
        ("صيدلاني مالك", "يخدم عميلاً ويجيب المندوب دون أن ينظر إليه"),
        ("صيدلانية مالكة", "تستقبل 5 مندوبين أسبوعياً، ملّت من الخطابات العامة، وتقطع الكلام"),
        ("مدير مشتريات مجموعة صيدليات", "يقارن الهوامش بعدوانية ويشكك في الشرعية السريرية"),
        ("صيدلاني", "يطلب أدلة سريرية قبل إدراج أي منتج، ويستشهد بمنافس أرخص"),
        ("مسؤول شبه صيدلانية ", "مركّز على الربحية لكل متر مربع، يستحضر إرجاع منتج سابق"),
        ("صيدلانية", "ساخرة بعد تخفيض حديث على منتج مماثل، وتقول إنها لا تريد مخزوناً ميتاً"),
    ],
}


# ══════════════════════════════════════════════════════════════════════════════
# DIFFICULTY CONFIGURATIONS — Règles précises par niveau
# ══════════════════════════════════════════════════════════════════════════════
DIFFICULTY_CONFIGS = {
    "fr": {
        "facile": {
            "interlocutor_pool": slice(0, 3),   # contexts 0-2: neutral/receptive
            "scenario_guide": (
                "Le pharmacien est RÉCEPTIF et COOPÉRATIF. Il pose une question directe sur le produit, "
                "demande une clarification sur l'indication, ou veut savoir pourquoi le stocker. "
                "Il n'y a PAS d'objection hostile. L'atmosphère est professionnelle et détendue. "
                "EXEMPLES DE SITUATION : 'Qu'est-ce qui différencie ce produit ?' / 'À quel type de patient "
                "le recommandez-vous ?' / 'Pourquoi devrais-je le référencer ?'"
            ),
            "answer_guide": (
                "CONSTRUCTION DES RÉPONSES :\n"
                "• Réponse A (correcte) : argument clair, bénéfice principal bien formulé, ton professionnel\n"
                "• Réponse B : acceptable en surface mais trop vague ou incomplète — manque l'argument clé\n"
                "• Réponse C : maladroite — trop technique, trop agressive, ou hors contexte officinal\n"
                "• Réponse D : clairement incorrecte — esquive la question, ou réponse non commerciale\n"
                "NB : Les mauvaises réponses DOIVENT être reconnaissables comme sous-optimales après réflexion."
            ),
            "explanation_guide": (
                "Explication pédagogique (2 phrases) : cite le principe de base utilisé (ex: argument bénéfice-patient, "
                "technique d'accroche). Explique brièvement pourquoi les autres réponses sont moins adaptées."
            ),
            "word_range": "12-16 mots",
        },
        "moyen": {
            "interlocutor_pool": slice(3, 9),   # contexts 3-8: real objections
            "scenario_guide": (
                "Le pharmacien soulève une VRAIE OBJECTION TERRAIN. Il peut dire :\n"
                "— 'J'ai déjà [concurrent X], ça marche bien pour moi.'\n"
                "— 'Votre prix est trop élevé par rapport à [concurrent].'\n"
                "— 'Je n'ai pas la demande pour ça.'\n"
                "— 'Je n'ai plus de place en rayon.'\n"
                "— 'Les clients ne me demandent pas ce produit.'\n"
                "Le pharmacien n'est PAS hostile mais il est RÉSISTANT et a une vraie raison business. "
                "Le délégué doit employer une technique de vente précise pour surmonter l'objection. "
                "IMPORTANT : L'interlocuteur doit citer un détail concret (un concurrent, un prix, une contrainte réelle)."
            ),
            "answer_guide": (
                "CONSTRUCTION DES RÉPONSES — TOUTES DOIVENT SEMBLER PLAUSIBLES EN PREMIÈRE LECTURE :\n"
                "• Réponse A (correcte) : technique de vente précise nommée (FAB, pivot, reframing, comparaison ROI). "
                "Traite l'objection ET avance vers la commande. Ni trop longue ni trop courte.\n"
                "• Réponse B : plausible mais TROP VAGUE — bonne intention, pas de technique précise, pas de closing\n"
                "• Réponse C : plausible mais RÉPOND À CÔTÉ — traite un aspect mais oublie l'objection principale\n"
                "• Réponse D : plausible mais AGGRAVE LA SITUATION — concède trop, promet ce qu'on ne peut pas tenir, "
                "ou ignore complètement l'objection\n"
                "RÈGLE D'OR : Les 3 mauvaises réponses ne doivent PAS être éliminables au premier coup d'œil."
            ),
            "explanation_guide": (
                "Explication experte (2-3 phrases) : nomme la technique utilisée dans la bonne réponse (ex: 'Technique FAB', "
                "'Pivot-reframing', 'ROI-closing'). Explique le défaut précis de chacune des 3 mauvaises réponses. "
                "Donne le réflexe terrain à retenir."
            ),
            "word_range": "14-18 mots",
        },
        "difficile": {
            "interlocutor_pool": slice(9, 15),  # contexts 9-14: hostile/pressure
            "scenario_guide": (
                "SITUATION DE HAUTE PRESSION : le pharmacien est HOSTILE, PRESSÉ ou CYNIQUE — ou les deux. "
                "La situation comporte UNE DOUBLE CONTRAINTE : contrainte de temps + objection difficile simultanée. "
                "EXEMPLES DE SITUATION EXPERT :\n"
                "— Le pharmacien sert un client et répond sans regarder : 'Vous avez 30 secondes, j'écoute.'\n"
                "— Il coupe la parole : 'Attendez, j'ai déjà essayé quelque chose de similaire — ça n'a pas marché.'\n"
                "— Il compare les marges : 'Le [concurrent] me donne 3 points de marge de plus, pourquoi vous ?'\n"
                "— Il challenge la légitimité : 'Qu'est-ce que vous avez comme preuve que c'est mieux ?'\n"
                "— Il est blasé : 'Je reçois 5 délégués par semaine, tout le monde dit la même chose.'\n"
                "Le scénario doit PIÉGER le délégué — la formulation du pharmacien doit sembler bloquer toute réponse simple."
            ),
            "answer_guide": (
                "CONSTRUCTION EXPERT — LES 4 RÉPONSES DOIVENT TOUTES SEMBLER CORRECTES EN SURFACE :\n"
                "• Réponse A (correcte) : répond EXACTEMENT à la double contrainte (temps + objection). "
                "Utilise une technique double (ex: pivot + micro-closing). Ni condescendante ni servile. "
                "Concrète, courte, audacieuse. Elle surprend par son efficacité.\n"
                "• Réponse B : professionnelle, mais TROP LONGUE pour la contrainte de temps — bon fond, mauvaise forme\n"
                "• Réponse C : professionnelle, mais ESQUIVE L'OBJECTION principale — change de sujet trop vite\n"
                "• Réponse D : professionnelle, mais OUBLIE LE CLOSING — bonne réponse à l'objection mais ne fait pas avancer\n"
                "RÈGLE ABSOLUE : Les 4 réponses doivent avoir la MÊME LONGUEUR VISUELLE. "
                "La bonne réponse ne doit JAMAIS être la plus longue ni la plus détaillée. "
                "Un lecteur rapide ne doit PAS pouvoir identifier la bonne réponse par sa forme."
            ),
            "explanation_guide": (
                "Explication stratégique (3 phrases) : "
                "Phrase 1 — Nomme la technique double utilisée dans la bonne réponse (ex: 'Micro-pivot + closing conditionnel'). "
                "Phrase 2 — Analyse le défaut SUBTIL de chacune des 3 mauvaises réponses (ex: B trop longue, C esquive, D sans closing). "
                "Phrase 3 — Donne le principe terrain à retenir pour ce type de situation haute pression."
            ),
            "word_range": "14-18 mots",
        },
    },
    "en": {
        "facile": {
            "interlocutor_pool": slice(0, 3),
            "scenario_guide": (
                "The pharmacist is RECEPTIVE and COOPERATIVE. They ask a direct question about the product, "
                "request clarification on the indication, or want to know why they should stock it. "
                "There is NO hostile objection. The atmosphere is professional and relaxed. "
                "EXAMPLE SITUATIONS: 'What sets this product apart?' / 'Which patient type do you recommend it for?' "
                "/ 'Why should I list it?'"
            ),
            "answer_guide": (
                "ANSWER CONSTRUCTION:\n"
                "• Answer A (correct): clear argument, main benefit well-stated, professional tone\n"
                "• Answer B: acceptable on the surface but too vague or incomplete — missing the key argument\n"
                "• Answer C: awkward — too technical, too aggressive, or out of pharmacy context\n"
                "• Answer D: clearly incorrect — dodges the question or gives a non-commercial response\n"
                "NOTE: Wrong answers MUST be recognizable as suboptimal after reflection."
            ),
            "explanation_guide": (
                "Pedagogical explanation (2 sentences): cite the basic principle used (e.g., patient-benefit argument, "
                "hook technique). Briefly explain why the other answers are less appropriate."
            ),
            "word_range": "12-16 words",
        },
        "moyen": {
            "interlocutor_pool": slice(3, 9),
            "scenario_guide": (
                "The pharmacist raises a REAL FIELD OBJECTION. They may say:\n"
                "— 'I already stock [competitor X], it works well for me.'\n"
                "— 'Your price is too high compared to [competitor].'\n"
                "— 'I don't have enough demand for that.'\n"
                "— 'I have no more shelf space.'\n"
                "— 'Customers never ask for this product.'\n"
                "The pharmacist is NOT hostile but is RESISTANT with a genuine business reason. "
                "The rep must use a precise sales technique to overcome the objection. "
                "IMPORTANT: The interlocutor must cite a concrete detail (a competitor, a price, a real constraint)."
            ),
            "answer_guide": (
                "ANSWER CONSTRUCTION — ALL MUST SEEM PLAUSIBLE AT FIRST READ:\n"
                "• Answer A (correct): named precise sales technique (FAB, pivot, reframing, ROI comparison). "
                "Addresses the objection AND moves toward the order. Neither too long nor too short.\n"
                "• Answer B: plausible but TOO VAGUE — good intent, no precise technique, no closing\n"
                "• Answer C: plausible but MISSES THE POINT — addresses one aspect but ignores the main objection\n"
                "• Answer D: plausible but WORSENS THE SITUATION — concedes too much, overpromises, "
                "or ignores the objection entirely\n"
                "GOLDEN RULE: The 3 wrong answers must NOT be eliminable at first glance."
            ),
            "explanation_guide": (
                "Expert explanation (2-3 sentences): name the technique used in the correct answer (e.g., 'FAB technique', "
                "'Pivot-reframing', 'ROI-closing'). Explain the precise flaw in each of the 3 wrong answers. "
                "Give the field reflex to remember."
            ),
            "word_range": "14-18 words",
        },
        "difficile": {
            "interlocutor_pool": slice(9, 15),
            "scenario_guide": (
                "HIGH-PRESSURE SITUATION: the pharmacist is HOSTILE, RUSHED or CYNICAL — or both. "
                "The situation has a DOUBLE CONSTRAINT: time pressure + difficult objection simultaneously. "
                "EXPERT SITUATION EXAMPLES:\n"
                "— Pharmacist is serving a customer and replies without looking up: 'You have 30 seconds, go.'\n"
                "— Interrupts: 'Wait, I already tried something similar — it didn't work.'\n"
                "— Compares margins: '[Competitor] gives me 3 extra margin points — why should I choose you?'\n"
                "— Challenges legitimacy: 'What proof do you have that it's actually better?'\n"
                "— Is jaded: 'I see 5 reps a week — everyone says the same thing.'\n"
                "The scenario must TRAP the delegate — the pharmacist's wording must appear to block any simple answer."
            ),
            "answer_guide": (
                "EXPERT CONSTRUCTION — ALL 4 ANSWERS MUST SEEM CORRECT ON THE SURFACE:\n"
                "• Answer A (correct): responds EXACTLY to the double constraint (time + objection). "
                "Uses a double technique (e.g., pivot + micro-closing). Not condescending, not servile. "
                "Concrete, short, bold. Surprising in its effectiveness.\n"
                "• Answer B: professional, but TOO LONG for the time constraint — right substance, wrong form\n"
                "• Answer C: professional, but DODGES THE MAIN OBJECTION — changes subject too quickly\n"
                "• Answer D: professional, but FORGETS THE CLOSING — good objection response but doesn't move forward\n"
                "ABSOLUTE RULE: All 4 answers must have the SAME VISUAL LENGTH. "
                "The correct answer must NEVER be the longest or most detailed. "
                "A quick reader must NOT be able to identify the correct answer by its form."
            ),
            "explanation_guide": (
                "Strategic explanation (3 sentences): "
                "Sentence 1 — Name the double technique used in the correct answer (e.g., 'Micro-pivot + conditional closing'). "
                "Sentence 2 — Analyze the SUBTLE flaw of each of the 3 wrong answers (e.g., B too long, C dodges, D no closing). "
                "Sentence 3 — Give the field principle to remember for this type of high-pressure situation."
            ),
            "word_range": "14-18 words",
        },
    },
    "ar": {
        "facile": {
            "interlocutor_pool": slice(0, 3),
            "scenario_guide": (
                "الصيدلاني متقبّل ومتعاون. يطرح سؤالاً مباشراً حول المنتج، يطلب توضيحاً حول المؤشر، "
                "أو يريد أن يعرف لماذا يخزّنه. لا يوجد اعتراض عدائي. الأجواء مهنية وهادئة. "
                "أمثلة للمواقف: 'ما الذي يميز هذا المنتج؟' / 'لأي نوع من المرضى توصي به؟' / 'لماذا أدرجه؟'"
            ),
            "answer_guide": (
                "بناء الإجابات:\n"
                "• الإجابة أ (صحيحة): حجة واضحة، الفائدة الرئيسية محددة جيداً، نبرة مهنية\n"
                "• الإجابة ب: مقبولة في الظاهر لكن مبهمة أو غير مكتملة — تفتقر إلى الحجة الرئيسية\n"
                "• الإجابة ج: غير ملائمة — تقنية جداً أو عدوانية جداً أو خارج سياق الصيدلية\n"
                "• الإجابة د: خاطئة بوضوح — تتهرب من السؤال أو لا تقدم رداً تجارياً\n"
                "ملاحظة: يجب أن تكون الإجابات الخاطئة قابلة للتعرف عليها كأقل من المثالي بعد التفكير."
            ),
            "explanation_guide": (
                "شرح تعليمي (جملتان): اذكر المبدأ الأساسي المستخدم (مثال: حجة الفائدة للمريض، تقنية الإثارة). "
                "اشرح بإيجاز لماذا الإجابات الأخرى أقل ملاءمة."
            ),
            "word_range": "12-16 كلمة",
        },
        "moyen": {
            "interlocutor_pool": slice(3, 9),
            "scenario_guide": (
                "الصيدلاني يثير اعتراضاً ميدانياً حقيقياً. يمكن أن يقول:\n"
                "— 'لدي بالفعل [منافس X]، يعمل بشكل جيد معي.'\n"
                "— 'سعركم مرتفع جداً مقارنة بـ [المنافس].'\n"
                "— 'لا يوجد لديّ طلب كافٍ على هذا المنتج.'\n"
                "— 'لا مكان لديّ في الرف.'\n"
                "— 'العملاء لا يسألون عن هذا المنتج.'\n"
                "الصيدلاني ليس عدائياً لكنه مقاوم ولديه سبب تجاري حقيقي. "
                "يجب على المندوب استخدام تقنية بيع دقيقة للتغلب على الاعتراض. "
                "مهم: يجب أن يستشهد المحاور بتفصيل ملموس (منافس، سعر، قيد حقيقي)."
            ),
            "answer_guide": (
                "بناء الإجابات — يجب أن تبدو جميعها معقولة في القراءة الأولى:\n"
                "• الإجابة أ (صحيحة): تقنية بيع دقيقة مسماة (FAB، محور، إعادة صياغة، مقارنة ROI). "
                "تعالج الاعتراض وتتقدم نحو الطلب. ليست طويلة جداً ولا قصيرة جداً.\n"
                "• الإجابة ب: محتملة لكن مبهمة جداً — نية جيدة، لا تقنية دقيقة، لا إتمام\n"
                "• الإجابة ج: محتملة لكن تفوّت الهدف — تعالج جانباً لكن تتجاهل الاعتراض الرئيسي\n"
                "• الإجابة د: محتملة لكن تزيد الوضع سوءاً — تنازلات كثيرة أو وعود مبالغ فيها\n"
                "القاعدة الذهبية: يجب أن تكون الإجابات الثلاث الخاطئة غير قابلة للاستبعاد بنظرة أولى."
            ),
            "explanation_guide": (
                "شرح خبير (2-3 جمل): سمّ التقنية المستخدمة في الإجابة الصحيحة (مثال: 'تقنية FAB'، 'محور-إعادة صياغة'، 'ROI-إغلاق'). "
                "اشرح العيب الدقيق في كل من الإجابات الثلاث الخاطئة. أعطِ منعكس الميدان الواجب تذكّره."
            ),
            "word_range": "14-18 كلمة",
        },
        "difficile": {
            "interlocutor_pool": slice(9, 15),
            "scenario_guide": (
                "موقف ضغط عالٍ: الصيدلاني عدائي أو مستعجل أو ساخر — أو كل ذلك. "
                "الموقف يحمل قيداً مزدوجاً: ضغط الوقت + اعتراض صعب في آنٍ واحد. "
                "أمثلة لمواقف الخبير:\n"
                "— الصيدلاني يخدم عميلاً ويجيب دون أن ينظر: 'عندك 30 ثانية، تفضل.'\n"
                "— يقاطع: 'انتظر، جربت شيئاً مماثلاً — ما نجح.'\n"
                "— يقارن الهوامش: '[المنافس] يعطيني 3 نقاط هامش إضافية — لماذا أختاركم؟'\n"
                "— يتحدى الشرعية: 'ما هو الدليل أنه أفضل فعلاً؟'\n"
                "— ملّ: 'أستقبل 5 مندوبين أسبوعياً — الجميع يقول نفس الشيء.'\n"
                "يجب أن يُفخّخ السيناريو المندوب — صياغة الصيدلاني يجب أن تبدو وكأنها تحجب أي رد بسيط."
            ),
            "answer_guide": (
                "بناء الخبير — يجب أن تبدو الإجابات الأربعة صحيحة في الظاهر:\n"
                "• الإجابة أ (صحيحة): تجيب بدقة على القيد المزدوج (الوقت + الاعتراض). "
                "تستخدم تقنية مزدوجة (مثال: محور + إغلاق مصغر). ليست متعالية ولا متملقة. "
                "ملموسة، قصيرة، جريئة. مفاجئة في فعاليتها.\n"
                "• الإجابة ب: مهنية لكن طويلة جداً لقيد الوقت — محتوى جيد، شكل خاطئ\n"
                "• الإجابة ج: مهنية لكن تتهرب من الاعتراض الرئيسي — تغير الموضوع بسرعة\n"
                "• الإجابة د: مهنية لكن تنسى الإغلاق — رد جيد على الاعتراض لكن لا تتقدم\n"
                "القاعدة المطلقة: يجب أن تكون الإجابات الأربعة بنفس الطول البصري. "
                "يجب ألا تكون الإجابة الصحيحة أبداً الأطول أو الأكثر تفصيلاً. "
                "القارئ السريع يجب ألا يتمكن من تحديد الإجابة الصحيحة بشكلها."
            ),
            "explanation_guide": (
                "شرح استراتيجي (3 جمل): "
                "الجملة 1 — سمّ التقنية المزدوجة المستخدمة في الإجابة الصحيحة (مثال: 'محور مصغر + إغلاق مشروط'). "
                "الجملة 2 — حلّل العيب الدقيق في كل من الإجابات الثلاث الخاطئة (مثال: ب طويلة، ج تتهرب، د بلا إغلاق). "
                "الجملة 3 — أعطِ المبدأ الميداني الواجب تذكّره لهذا النوع من مواقف الضغط العالي."
            ),
            "word_range": "14-18 كلمة",
        },
    },
}


# ══════════════════════════════════════════════════════════════════════════════
# PROMPT BUILDER — Construction du prompt par question
# ══════════════════════════════════════════════════════════════════════════════
def build_commercial_question_prompt(
    product_name: str,
    context: str,
    difficulty: str,
    angle: str = None,
    scenario_ctx: tuple = None,
    lang: str = "fr",
) -> str:
    lang_cfgs = DIFFICULTY_CONFIGS.get(lang, DIFFICULTY_CONFIGS["fr"])
    cfg = lang_cfgs.get(difficulty, lang_cfgs["moyen"])

    # Select interlocutor from appropriate difficulty pool
    pool = SCENARIO_CONTEXTS.get(lang, SCENARIO_CONTEXTS["fr"])
    if scenario_ctx:
        interlocuteur, situation = scenario_ctx
    else:
        pool_slice = pool[cfg["interlocutor_pool"]]
        if pool_slice:
            interlocuteur, situation = random.choice(pool_slice)
        else:
            interlocuteur, situation = random.choice(pool)

    angle_line = f"\nCOMMERCIAL FOCUS — Axis to test: {angle}" if angle else ""

    # ── Language-specific labels ─────────────────────────────────────────────
    labels = {
        "fr": {
            "intro": f"Génère UNE question de simulation de visite officinale pour le produit {product_name}.",
            "product_section": "FICHE PRODUIT (utilise ces informations dans la mise en situation) :",
            "interlocutor_section": "INTERLOCUTEUR ET CONTEXTE :",
            "level_section": f"NIVEAU : {difficulty.upper()}",
            "scenario_section": "RÈGLE DE SCÉNARIO :",
            "answers_section": "RÈGLE DE CONSTRUCTION DES RÉPONSES :",
            "explanation_section": "RÈGLE D'EXPLICATION :",
            "format_section": "FORMAT DE SORTIE (JSON uniquement, aucun texte autour) :",
            "word_guide": f"Longueur cible par réponse : {cfg['word_range']}",
            "question_hint": (
                f"La question décrit exactement ce que dit ou fait {interlocuteur} dans la pharmacie, "
                f"et demande au délégué quelle est la meilleure réponse commerciale."
            ),
            "skill_hint": "sales_skill = compétence commerciale testée, 3 mots max (ex: 'Pivot-closing', 'Double-objection', 'FAB-terrain')",
            "final_reminder": (
                f"RAPPEL FINAL :\n"
                f"— Scénario uniquement en pharmacie ou parapharmacie\n"
                f"— Délégué toujours professionnel\n"
                f"— La bonne réponse (correct_index: 0) sera mélangée automatiquement\n"
                f"— {cfg['word_range']} par réponse — toutes visuellement similaires en longueur\n"
                f"— La réponse correcte ne doit JAMAIS être identifiable par sa longueur ou son niveau de détail\n"
                f"— TOUT le JSON doit être en FRANÇAIS"
            ),
        },
        "en": {
            "intro": f"Generate ONE pharmacy visit simulation question for the product {product_name}.",
            "product_section": "PRODUCT SHEET (use this information in the scenario):",
            "interlocutor_section": "INTERLOCUTOR AND CONTEXT:",
            "level_section": f"LEVEL: {difficulty.upper()}",
            "scenario_section": "SCENARIO RULE:",
            "answers_section": "ANSWER CONSTRUCTION RULE:",
            "explanation_section": "EXPLANATION RULE:",
            "format_section": "OUTPUT FORMAT (JSON only, no surrounding text):",
            "word_guide": f"Target length per answer: {cfg['word_range']}",
            "question_hint": (
                f"The question describes exactly what {interlocuteur} says or does in the pharmacy, "
                f"and asks the delegate what the best commercial response is."
            ),
            "skill_hint": "sales_skill = commercial skill tested, max 3 words (e.g. 'Pivot-closing', 'Double-objection', 'FAB-field')",
            "final_reminder": (
                f"FINAL REMINDER:\n"
                f"— Scenario only in pharmacy or parapharmacy\n"
                f"— Delegate always professional\n"
                f"— Correct answer (correct_index: 0) will be shuffled automatically\n"
                f"— {cfg['word_range']} per answer — all visually similar in length\n"
                f"— The correct answer must NEVER be identifiable by its length or detail level\n"
                f"— ALL JSON must be in ENGLISH"
            ),
        },
        "ar": {
            "intro": f"أنشئ سؤالاً واحداً لمحاكاة زيارة صيدلية للمنتج {product_name}.",
            "product_section": "ملف المنتج (استخدم هذه المعلومات في الموقف):",
            "interlocutor_section": "المحاور والسياق:",
            "level_section": f"المستوى: {difficulty.upper()}",
            "scenario_section": "قاعدة السيناريو:",
            "answers_section": "قاعدة بناء الإجابات:",
            "explanation_section": "قاعدة الشرح:",
            "format_section": "صيغة الإخراج (JSON فقط، بدون نص محيط):",
            "word_guide": f"الطول المستهدف لكل إجابة: {cfg['word_range']}",
            "question_hint": (
                f"السؤال يصف بدقة ما يقوله أو يفعله {interlocuteur} في الصيدلية، "
                f"ويسأل المندوب عن أفضل رد تجاري."
            ),
            "skill_hint": "sales_skill = المهارة التجارية المختبرة، 3 كلمات كحد أقصى (مثال: 'محور-إغلاق'، 'اعتراض-مزدوج'، 'FAB-ميدان')",
            "final_reminder": (
                f"التذكير النهائي:\n"
                f"— السيناريو فقط في الصيدلية أوشبه صيدلية\n"
                f"— المندوب دائماً محترف\n"
                f"— الإجابة الصحيحة (correct_index: 0) ستُخلط تلقائياً\n"
                f"— {cfg['word_range']} لكل إجابة — جميعها متشابهة بصرياً في الطول\n"
                f"— يجب ألا تكون الإجابة الصحيحة قابلة للتحديد بطولها أو مستوى تفصيلها\n"
                f"— يجب أن يكون كل JSON باللغة العربية"
            ),
        },
    }

    lb = labels.get(lang, labels["fr"])

    return f"""{lb["intro"]}{angle_line}

{lb["product_section"]}
{context}

{lb["interlocutor_section"]}
{interlocuteur}, {situation}.

{lb["level_section"]}

{lb["scenario_section"]}
{cfg["scenario_guide"]}

{lb["answers_section"]}
{cfg["answer_guide"]}
{lb["word_guide"]}

{lb["explanation_section"]}
{cfg["explanation_guide"]}

{lb["format_section"]}

{{
  "question": "{lb['question_hint']}",
  "choices": [
    "Réponse A — correcte ({cfg['word_range']})",
    "Réponse B — plausible mais défaillante ({cfg['word_range']})",
    "Réponse C — plausible mais défaillante ({cfg['word_range']})",
    "Réponse D — plausible mais défaillante ({cfg['word_range']})"
  ],
  "correct_index": 0,
  "explanation": "{lb['explanation_section']} — 2-3 phrases max",
  "product": "{product_name}",
  "sales_skill": "{lb['skill_hint']}"
}}

{lb["final_reminder"]}"""


# ══════════════════════════════════════════════════════════════════════════════
# QUESTION GENERATOR — Génération d'une question individuelle
# ══════════════════════════════════════════════════════════════════════════════
async def generate_one_commercial_question(
    engine,
    product_name: str,
    context: str,
    difficulty: str,
    angle: str = None,
    scenario_ctx: tuple = None,
    lang: str = "fr",
) -> Optional[dict]:
    from langchain_core.messages import SystemMessage, HumanMessage
    clean_ctx = clean_context(context, product_name)
    if not clean_ctx.strip():
        return None

    system_prompt = QUIZ_COMMERCIAL_SYSTEM_PROMPTS.get(lang, QUIZ_COMMERCIAL_SYSTEM_PROMPTS["fr"])
    prompt = build_commercial_question_prompt(product_name, clean_ctx, difficulty, angle, scenario_ctx, lang=lang)
    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: engine.llm.invoke([
                SystemMessage(content=system_prompt),
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


# ══════════════════════════════════════════════════════════════════════════════
# TASK DISTRIBUTION — Répartition des questions par produit et angle
# ══════════════════════════════════════════════════════════════════════════════
def _build_commercial_task_list(hits: dict, count: int, difficulty: str = "moyen", lang: str = "fr") -> list:
    products = list(hits.keys())
    if not products:
        return []

    # Select scenario contexts from the appropriate difficulty pool
    lang_cfgs = DIFFICULTY_CONFIGS.get(lang, DIFFICULTY_CONFIGS["fr"])
    cfg = lang_cfgs.get(difficulty, lang_cfgs["moyen"])
    pool = SCENARIO_CONTEXTS.get(lang, SCENARIO_CONTEXTS["fr"])
    pool_slice = pool[cfg["interlocutor_pool"]]
    if not pool_slice:
        pool_slice = pool

    angles = COMMERCIAL_ANGLES.get(lang, COMMERCIAL_ANGLES["fr"])[:]
    random.shuffle(angles)
    while len(angles) < count:
        extra = COMMERCIAL_ANGLES.get(lang, COMMERCIAL_ANGLES["fr"])[:]
        random.shuffle(extra)
        angles.extend(extra)

    contexts = list(pool_slice)[:]
    random.shuffle(contexts)
    while len(contexts) < count:
        extra = list(pool_slice)[:]
        random.shuffle(extra)
        contexts.extend(extra)

    tasks = []
    if len(products) == 1:
        pname = products[0]
        context = hits[pname]
        for i in range(count):
            tasks.append((pname, context, angles[i], contexts[i]))
    else:
        random.shuffle(products)
        for i in range(count):
            pname = products[i % len(products)]
            context = hits[pname]
            tasks.append((pname, context, angles[i], contexts[i]))
    return tasks


def _resolve_hits(engine, req: QuizCommercialRequest) -> dict:
    selected = req.products or ([req.product] if req.product else [])
    if selected:
        return _fetch_selected_products(engine, selected)
    return _fetch_all_products(engine)


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS — Génération streaming
# ══════════════════════════════════════════════════════════════════════════════
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

    lang = req.lang if req.lang in ("fr", "en", "ar") else "fr"
    task_list = _build_commercial_task_list(hits, count, difficulty=req.difficulty, lang=lang)

    async def event_generator():
        yield f'data: {json.dumps({"type": "loading", "total": len(task_list)})}\n\n'
        tasks = [
            generate_one_commercial_question(engine, pname, ctx, req.difficulty, angle, scenario_ctx, lang=lang)
            for pname, ctx, angle, scenario_ctx in task_list
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        questions = [r for r in results if isinstance(r, dict) and r]

        for result in questions:
            yield f"data: {json.dumps({'type': 'question', 'question': result, 'total': len(task_list)}, ensure_ascii=False)}\n\n"

        yield f'data: {json.dumps({"type": "done", "count": len(questions)})}\n\n'

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ══════════════════════════════════════════════════════════════════════════════
# FINAL FEEDBACK — Bilan constructif et personnalisé
# ══════════════════════════════════════════════════════════════════════════════
_FINAL_FEEDBACK_SYSTEMS = {
    "fr": """Tu es Vita, coach vente pharmaceutique VITAL SA. Tu écris un bilan de quiz en EXACTEMENT 3 phrases courtes. Pas une de plus.

PHRASE 1 — Score + verdict calibré au niveau (Ex: "7/10 en Expert, c'est solide." ou "4/10 en Débutant, le terrain pardonne moins.")
PHRASE 2 — Le point le plus critique : 1 compétence ou produit raté + 1 réflexe terrain précis et immédiatement applicable. Sois chirurgical, pas générique.
PHRASE 3 — Une phrase de relance courte, directe, sans flatterie.

RÈGLES ABSOLUES : 3 phrases. Jamais 4. Pas de liste, pas de tirets, pas de titres en gras. LANGUE : Réponds en FRANÇAIS.""",

    "en": """You are Vita, pharmaceutical sales coach at VITAL SA. Write a quiz review in EXACTLY 3 short sentences. No more.

SENTENCE 1 — Score + level-calibrated verdict (e.g. "7/10 at Expert level, that's solid." or "4/10 at Beginner, the field is less forgiving.")
SENTENCE 2 — The most critical point: 1 failed skill or product + 1 precise, immediately actionable field reflex. Be surgical, not generic.
SENTENCE 3 — A short, direct follow-up sentence, no flattery.

ABSOLUTE RULES: 3 sentences. Never 4. No lists, no dashes, no bold titles. LANGUAGE: Reply in ENGLISH.""",

    "ar": """أنت فيتا، مدربة مبيعات صيدلانية في VITAL SA. اكتبي تقرير الاختبار في 3 جمل قصيرة بالضبط. لا أكثر.

الجملة 1 — النتيجة + الحكم المعاير حسب المستوى (مثال: "7/10 في مستوى الخبير، هذا متين." أو "4/10 في مستوى المبتدئ، الميدان أقل رحمة.")
الجملة 2 — النقطة الأكثر أهمية: مهارة أو منتج فاشل + منعكس ميداني دقيق وقابل للتطبيق فوراً. كوني جراحية لا عامة.
الجملة 3 — جملة متابعة قصيرة ومباشرة، بدون إطراء.

القواعد المطلقة: 3 جمل. أبداً 4. لا قوائم، لا شرطات، لا عناوين بالخط العريض. اللغة: أجيبي بالعربية.""",
}

# ── Feedback prompt labels by language ───────────────────────────────────────
_FEEDBACK_PROMPT_LABELS = {
    "fr": {
        "level":         "Niveau",
        "score":         "Score",
        "perfect_score": "Score parfait",
        "skill_detail":  "Détail par compétence",
        "error_products":"Produits avec erreurs",
        "skills_improve":"Compétences à améliorer",
        "bad_examples":  "Exemples de mauvaises réponses",
        "chosen":        "Choisi",
        "correct":       "Correct",
        "write_review":  "Rédige le bilan constructif selon les règles.",
        "write_perfect": "Rédige un bilan qui félicite, cite les points forts avec %, et challenge vers le niveau supérieur.",
        "mastered":      "Compétences maîtrisées",
    },
    "en": {
        "level":         "Level",
        "score":         "Score",
        "perfect_score": "Perfect score",
        "skill_detail":  "Skill breakdown",
        "error_products":"Products with errors",
        "skills_improve":"Skills to improve",
        "bad_examples":  "Examples of wrong answers",
        "chosen":        "Chosen",
        "correct":       "Correct",
        "write_review":  "Write the constructive review according to the rules.",
        "write_perfect": "Write a review that congratulates, cites strengths with %, and challenges toward the next level.",
        "mastered":      "Mastered skills",
    },
    "ar": {
        "level":         "المستوى",
        "score":         "النتيجة",
        "perfect_score": "نتيجة مثالية",
        "skill_detail":  "تفصيل المهارات",
        "error_products":"المنتجات ذات الأخطاء",
        "skills_improve":"المهارات للتحسين",
        "bad_examples":  "أمثلة على الإجابات الخاطئة",
        "chosen":        "المختار",
        "correct":       "الصحيح",
        "write_review":  "اكتبي التقرير البنّاء وفق القواعد.",
        "write_perfect": "اكتبي تقريراً يهنئ، يستشهد بنقاط القوة مع النسب المئوية، ويتحدى نحو المستوى التالي.",
        "mastered":      "المهارات المتقنة",
    },
}

@router.post("/feedback/final/stream")
async def stream_final_feedback_commercial(req: dict):
    from backend.rag.engine import engine
    from langchain_core.messages import SystemMessage, HumanMessage
    engine.initialize()

    score = req.get("score", 0)
    total = req.get("total", 0)
    history = req.get("history", [])
    difficulty = req.get("difficulty", "moyen")
    lang_final = req.get("lang", "fr") if req.get("lang") in ("fr", "en", "ar") else "fr"

    _diff_labels = {
        "fr": {"facile": "Débutant",  "moyen": "Confirmé",     "difficile": "Expert"},
        "en": {"facile": "Beginner",  "moyen": "Intermediate", "difficile": "Expert"},
        "ar": {"facile": "مبتدئ",     "moyen": "متوسط",        "difficile": "خبير"},
    }
    difficulty_label = _diff_labels.get(lang_final, _diff_labels["fr"]).get(difficulty, difficulty)
    pct = round((score / total) * 100) if total > 0 else 0

    lb = _FEEDBACK_PROMPT_LABELS.get(lang_final, _FEEDBACK_PROMPT_LABELS["fr"])

    bad_items = [h for h in history if not h.get("ok")]
    good_items = [h for h in history if h.get("ok")]

    bad_products = list(set(h.get("product", "?") for h in bad_items))
    bad_skills   = list(set(h.get("sales_skill", "?") for h in bad_items))

    all_skills = {}
    for h in history:
        s = h.get("sales_skill", "?")
        if s not in all_skills:
            all_skills[s] = {"ok": 0, "total": 0}
        all_skills[s]["total"] += 1
        if h.get("ok"):
            all_skills[s]["ok"] += 1
    skill_summary = " | ".join(f"{s}: {v['ok']}/{v['total']}" for s, v in all_skills.items())

    if bad_items:
        prompt = (
            f"{lb['level']} : {difficulty_label}\n"
            f"{lb['score']} : {score}/{total} ({pct}%)\n"
            f"{lb['skill_detail']} : {skill_summary}\n"
            f"{lb['error_products']} : {', '.join(bad_products[:5])}\n"
            f"{lb['skills_improve']} : {', '.join(bad_skills[:5])}\n"
            f"{lb['bad_examples']} :\n"
            + "\n".join(
                f"- {lb['chosen']}: «{h.get('chosen','?')}» | {lb['correct']}: «{h.get('correct','?')}»"
                for h in bad_items[:3]
            )
            + f"\n\n{lb['write_review']}"
        )
    else:
        prompt = (
            f"{lb['level']} : {difficulty_label}\n"
            f"{lb['perfect_score']} : {score}/{total} (100%)\n"
            f"{lb['mastered']} : {skill_summary}\n\n"
            f"{lb['write_perfect']}"
        )

    final_system = _FINAL_FEEDBACK_SYSTEMS.get(lang_final, _FINAL_FEEDBACK_SYSTEMS["fr"])

    async def gen():
        try:
            for chunk in engine.llm.stream([
                SystemMessage(content=final_system),
                HumanMessage(content=prompt)
            ]):
                if chunk.content:
                    yield f"data: {json.dumps({'type': 'token', 'content': chunk.content}, ensure_ascii=False)}\n\n"
            yield f'data: {json.dumps({"type": "done"})}\n\n'
        except Exception as e:
            yield f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ══════════════════════════════════════════════════════════════════════════════
# UTILITIES — Parse, sanitize, fetch
# ══════════════════════════════════════════════════════════════════════════════
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
    except Exception:
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
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
    question_text = str(q.get("question", ""))
    return len(question_text) > 20