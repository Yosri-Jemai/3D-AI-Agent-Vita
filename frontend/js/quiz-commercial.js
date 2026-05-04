// ═══════════════════════════════════════════════════════════════════════════
// quiz-commercial.js — Quiz Délégué Commercial · VitalAgent
// v2 : Multilingue (FR/EN/AR) + Niveaux contrastés + Bilan commercial
// ═══════════════════════════════════════════════════════════════════════════

import { BehavioralAnalyzer } from "./behavioral-analysis.js";
import {
  initBehavioralPanel,
  updateLiveFrame,
  startTimer,
  stopTimer,
  destroyPanel,
} from "./behavioral-ui.js";

const API_BASE = window.API_BASE || "http://localhost:8000";

// ══════════════════════════════════════════════════════════════════════════
// BEHAVIORAL ANALYSIS
// ══════════════════════════════════════════════════════════════════════════
let _baAnalyzer  = null;  // BehavioralAnalyzer instance
let _baEnabled   = false; // camera granted + active
let _baConsent   = true;  // lu depuis le toggle setup

// Per-question behavioral snapshots: Array of { avgStress, avgConf, dominantExpr, avgGaze, signals, thinkMs }
let _baSessions  = [];
let _baQStart    = 0; // ms timestamp when question started

function _baStartQuestion(idx) {
  if (!_baEnabled || !_baAnalyzer) return;
  _baQStart = Date.now();
  startTimer();
  _baAnalyzer.startQuestion(idx);
}

function _baStopQuestion(idx) {
  if (!_baEnabled || !_baAnalyzer) return;
  stopTimer();
  const result = _baAnalyzer.endQuestion(idx);
  if (result) {
    _baSessions[idx] = {
      avgStress:    result.avgStress,
      avgConf:      result.avgConf,
      dominantExpr: result.dominantExpression,
      avgGaze:      result.dominantGaze,
      signals:      result.persistentSignals || [],
      thinkMs:      Date.now() - _baQStart,
    };
  }
}

function _baBuildReport() {
  const valid = _baSessions.filter(Boolean);
  if (!valid.length) return null;
  const avgStress = valid.reduce((a, b) => a + b.avgStress, 0) / valid.length;
  const avgConf   = valid.reduce((a, b) => a + b.avgConf,   0) / valid.length;
  const allSignals = {};
  valid.forEach(s => s.signals.forEach(sig => allSignals[sig] = (allSignals[sig] || 0) + 1));
  const topSignals = Object.entries(allSignals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const exprCounts = {};
  valid.forEach(s => exprCounts[s.dominantExpr] = (exprCounts[s.dominantExpr] || 0) + 1);
  const topExpr = Object.entries(exprCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "neutral";
  const avgThinkSec = Math.round(valid.reduce((a, b) => a + b.thinkMs, 0) / valid.length / 1000);
  return { avgStress: Math.round(avgStress * 100), avgConf: Math.round(avgConf * 100), topExpr, topSignals, avgThinkSec, perQuestion: _baSessions };
}

// ── État global ────────────────────────────────────────────────────────────
let state = {
  questions:        [],
  current:          0,
  score:            0,
  answered:         false,
  difficulty:       "facile",
  questionCount:    10,
  selectedProducts: [],
  history:          [],
  streamDone:       false,
  totalExpected:    10,
  generating:       false,
  lang:             "fr",   // "fr" | "en" | "ar"
};

let allProducts = [];

const $ = id => document.getElementById(id);

// ══════════════════════════════════════════════════════════════════════════
// TRADUCTIONS
// ══════════════════════════════════════════════════════════════════════════
const T = {
  fr: {
    dir: "ltr",
    loading_avatar: "Chargement de l'avatar…",
    quiz_title: "Quiz de Formation Commerciale",
    quiz_subtitle: "Vita va vous entraîner à vendre les produits VITAL SA.\nPitchs, objections, arguments clients — maîtrisez l'art de la vente.",
    label_products: "Produit(s)",
    all_products: "Tous les produits",
    n_products: n => `${n} produits sélectionnés`,
    search_product: "Rechercher un produit…",
    reset: "Réinitialiser",
    label_level: "Niveau commercial",
    level_facile: "Débutant",
    level_moyen: "Confirmé",
    level_difficile: "Expert",
    level_facile_desc: "Connaissances de base · Pharmacien réceptif",
    level_moyen_desc: "Objections terrain · 4 réponses plausibles",
    level_difficile_desc: "Mode hostile · Toutes les réponses piègent",
    label_count: "Nombre de questions",
    start: "Commencer le Quiz",
    generating_1: prod => `Je génère des scénarios sur ${prod}…`,
    generating_n: n => `Je génère des scénarios sur ${n} produits…`,
    generating_all: "Je prépare vos scénarios de vente, un moment…",
    loading_scenarios: (loaded, total) => `Scénarios prêts : ${loaded} / ${total}`,
    q_counter: (cur, tot) => `Question ${cur} / ${tot}`,
    ready_to_sell: "Prêt à vendre ?",
    mute_vita: "Couper la voix de Vita",
    score_label: "Score",
    coach_role: "Coach Vente Pharmaceutique",
    q_short_bubble: (n, prod) => `Question ${n} · ${prod} — Je vous lis le scénario…`,
    answer_ok: "Bonne réponse ! Excellente approche.",
    answer_bad: "Pas tout à fait. La meilleure approche était différente.",
    bubble_ok: "✓ Excellente approche !",
    bubble_bad: "✗ Voici la meilleure approche…",
    bubble_analyzing: isOk => isOk ? "📊 Analyse de votre technique…" : "📋 Décryptage de la situation…",
    verdict_ok: "Excellente approche !",
    verdict_bad: "Voici la meilleure approche :",
    next: "Scénario suivant",
    prev: "Précédent",
    see_results: "Voir mes résultats",
    waiting: "Chargement…",
    error_server: "Erreur de connexion au serveur.",
    error_connect: msg => `Impossible de contacter le serveur : ${msg}`,
    error_products: "Erreur chargement produits",
    results_top: "Top vendeur ! 🏆",
    results_good: "Bon commercial ! 👍",
    results_low: "À renforcer 📚",
    results_msg: (pct, s, t) => `Score : ${pct}% · ${s}/${t} correctes`,
    level_tested: diff => `Niveau ${diff} · Compétences testées`,
    q_label: i => `Q${i+1}`,
    your_answer: "✗ Votre réponse :",
    best_approach: "✓ Meilleure approche :",
    vita_bilan: "Bilan de formation commerciale",
    vita_loading: "Vita rédige votre bilan…",
    bilan_unavail: "Bilan indisponible.",
    cert_title: "Félicitations !",
    cert_subtitle: "Vous avez atteint le seuil de validation (≥ 60%)",
    cert_download: "Télécharger mon certificat",
    restart: "Recommencer",
    home: "Accueil",
    vita_conseil: "Conseil de Vita",
    diff_labels: { facile: "Débutant", moyen: "Confirmé", difficile: "Expert" },
    cert_atteste: name => `Ce certificat atteste que le délégué\n${name}\na validé avec succès le quiz de formation commerciale VitalAgent.`,
    cert_products: "Produits maîtrisés :",
    cert_score_lbl: (s, t) => `Score obtenu\n${s} / ${t} scénarios`,
    cert_sig_role: "Coach Vente Pharmaceutique · VitalAgent",
    cert_delivered: date => `Délivré le ${date}`,
    lang_label: "Langue",
    back: "Retour",
    brand_module: "Quiz Délégué Commercial",
    waiting_text: "Génération de vos scénarios de vente…",
    vita_conseil_lbl: "Conseil de Vita",
    cert_header: "Certificat de Formation",
    cert_download_png: "Télécharger PNG",
    cert_copy_link: "🔗 Copier lien",
    cert_link_copied: "✓ Lien copié !",
    modal_title_cert: "Formation des Délégués Commerciaux",
    cert_wm: "VITAL SA · Formation Commerciale · Certifié VitalAgent",
  },

  en: {
    dir: "ltr",
    loading_avatar: "Loading avatar…",
    quiz_title: "Commercial Training Quiz",
    quiz_subtitle: "Vita will train you to sell VITAL SA products.\nPitches, objections, client arguments — master the art of selling.",
    label_products: "Product(s)",
    all_products: "All products",
    n_products: n => `${n} products selected`,
    search_product: "Search a product…",
    reset: "Reset",
    label_level: "Sales level",
    level_facile: "Beginner",
    level_moyen: "Intermediate",
    level_difficile: "Expert",
    level_facile_desc: "Basic knowledge · Receptive pharmacist",
    level_moyen_desc: "Real objections · 4 plausible answers",
    level_difficile_desc: "Hostile mode · Every answer is a trap",
    label_count: "Number of questions",
    start: "Start Quiz",
    generating_1: prod => `Generating scenarios on ${prod}…`,
    generating_n: n => `Generating scenarios on ${n} products…`,
    generating_all: "Preparing your sales scenarios, one moment…",
    loading_scenarios: (loaded, total) => `Scenarios ready: ${loaded} / ${total}`,
    q_counter: (cur, tot) => `Question ${cur} / ${tot}`,
    ready_to_sell: "Ready to sell?",
    mute_vita: "Mute Vita's voice",
    score_label: "Score",
    coach_role: "Pharmaceutical Sales Coach",
    q_short_bubble: (n, prod) => `Question ${n} · ${prod} — Reading your scenario…`,
    answer_ok: "Correct! Excellent approach.",
    answer_bad: "Not quite. The best approach was different.",
    bubble_ok: "✓ Excellent approach!",
    bubble_bad: "✗ Here's the best approach…",
    bubble_analyzing: isOk => isOk ? "📊 Analyzing your technique…" : "📋 Decoding the situation…",
    verdict_ok: "Excellent approach!",
    verdict_bad: "Here's the best approach:",
    next: "Next scenario",
    prev: "Previous",
    see_results: "See my results",
    waiting: "Loading…",
    error_server: "Server connection error.",
    error_connect: msg => `Unable to reach server: ${msg}`,
    error_products: "Error loading products",
    results_top: "Top seller! 🏆",
    results_good: "Good rep! 👍",
    results_low: "Needs work 📚",
    results_msg: (pct, s, t) => `Score: ${pct}% · ${s}/${t} correct`,
    level_tested: diff => `${diff} level · Skills tested`,
    q_label: i => `Q${i+1}`,
    your_answer: "✗ Your answer:",
    best_approach: "✓ Best approach:",
    vita_bilan: "Commercial training review",
    vita_loading: "Vita is writing your review…",
    bilan_unavail: "Review unavailable.",
    cert_title: "Congratulations!",
    cert_subtitle: "You have reached the validation threshold (≥ 60%)",
    cert_download: "Download my certificate",
    restart: "Restart",
    home: "Home",
    vita_conseil: "Vita's tip",
    diff_labels: { facile: "Beginner", moyen: "Intermediate", difficile: "Expert" },
    cert_atteste: name => `This certificate confirms that the delegate\n${name}\nhas successfully completed the VitalAgent commercial training quiz.`,
    cert_products: "Products mastered:",
    cert_score_lbl: (s, t) => `Score obtained\n${s} / ${t} scenarios`,
    cert_sig_role: "Pharmaceutical Sales Coach · VitalAgent",
    cert_delivered: date => `Issued on ${date}`,
    lang_label: "Language",
    back: "Back",
    brand_module: "Commercial Sales Quiz",
    waiting_text: "Generating your sales scenarios…",
    vita_conseil_lbl: "Vita's tip",
    cert_header: "Training Certificate",
    cert_download_png: "Download PNG",
    cert_copy_link: "🔗 Copy link",
    cert_link_copied: "✓ Link copied!",
    modal_title_cert: "Commercial Delegate Training",
    cert_wm: "VITAL SA · Commercial Training · Certified by VitalAgent",
  },

  ar: {
    dir: "rtl",
    loading_avatar: "جارٍ تحميل الصورة الرمزية…",
    quiz_title: "اختبار التدريب التجاري",
    quiz_subtitle: "ستدرّبك فيتا على تسويق منتجات VITAL SA.\nالعروض التجارية، معالجة الاعتراضات، وإقناع العملاء — أتقن مهارات البيع.",
    label_products: "المنتج / المنتجات",
    all_products: "جميع المنتجات",
    n_products: n => `${n} منتجات محددة`,
    search_product: "ابحث عن منتج…",
    reset: "إعادة التعيين",
    label_level: "المستوى التجاري",
    level_facile: "مبتدئ",
    level_moyen: "متوسط",
    level_difficile: "خبير",
    level_facile_desc: "أساسيات البيع · صيدلاني متعاون",
    level_moyen_desc: "اعتراضات ميدانية واقعية · أربع إجابات متقاربة",
    level_difficile_desc: "ضغط ميداني مرتفع · فخاخ دقيقة",
    label_count: "عدد الأسئلة",
    start: "ابدأ الاختبار",
    generating_1: prod => `جارٍ إنشاء سيناريوهات لـ ${prod}…`,
    generating_n: n => `جارٍ إنشاء سيناريوهات لـ ${n} منتجات…`,
    generating_all: "جارٍ إعداد سيناريوهات البيع، يرجى الانتظار…",
    loading_scenarios: (loaded, total) => `السيناريوهات الجاهزة: ${loaded} / ${total}`,
    q_counter: (cur, tot) => `السؤال ${cur} / ${tot}`,
    ready_to_sell: " مستعد للبيع؟",
    mute_vita: "كتم صوت فيتا",
    score_label: "النتيجة",
    coach_role: "مدربة المبيعات الصيدلانية",
    q_short_bubble: (n, prod) => `السؤال ${n} · ${prod} — جارٍ قراءة السيناريو…`,
    answer_ok: "إجابة صحيحة! نهج احترافي.",
    answer_bad: "ليست الأفضل. كان هناك نهج أكثر فعالية.",
    bubble_ok: "✓ نهج احترافي!",
    bubble_bad: "✗ هذا هو النهج الأفضل…",
    bubble_analyzing: isOk => isOk ? "📊 تحليل أسلوبك…" : "📋 تحليل الموقف…",
    verdict_ok: "نهج ممتاز!",
    verdict_bad: "أفضل استجابة:",
    next: "السيناريو التالي",
    prev: "السابق",
    see_results: "عرض النتائج",
    waiting: "جارٍ التحميل…",
    error_server: "حدث خطأ في الاتصال بالخادم.",
    error_connect: msg => `تعذر الاتصال بالخادم: ${msg}`,
    error_products: "تعذر تحميل المنتجات",
    results_top: "أفضل مندوب!",
    results_good: "مندوب جيد!",
    results_low: "يحتاج إلى تطوير",
    results_msg: (pct, s, t) => `النتيجة: ${pct}% · ${s}/${t} إجابات صحيحة`,
    level_tested: diff => `المستوى ${diff} · المهارات المُختبرة`,
    q_label: i => `س${i+1}`,
    your_answer: "✗ إجابتك:",
    best_approach: "✓ أفضل نهج:",
    vita_bilan: "تقرير الأداء التجاري",
    vita_loading: "فيتا تكتب تقريرك…",
    bilan_unavail: "التقرير غير متوفر.",
    cert_title: "تهانينا!",
    cert_subtitle: "لقد اجتزت بنجاح عتبة التحقق (60٪ فأكثر)",
    cert_download: "تحميل الشهادة",
    restart: "إعادة الاختبار",
    home: "الرئيسية",
    vita_conseil: "نصيحة فيتا",
    diff_labels: { facile: "مبتدئ", moyen: "متوسط", difficile: "خبير" },
    cert_atteste: name => `تشهد هذه الوثيقة أن المندوب\n${name}\nقد اجتاز بنجاح اختبار التدريب التجاري VitalAgent`,
    cert_products: "المنتجات المُتقنة:",
    cert_score_lbl: (s, t) => `النتيجة المحققة\n${s} / ${t} سيناريو`,
    cert_sig_role: "VitalAgent · مدربة المبيعات الصيدلانية",
    cert_delivered: date => `صادرة بتاريخ ${date}`,
    lang_label: "اللغة",
    back: "رجوع",
    brand_module: "اختبار المندوب التجاري",
    waiting_text: "جارٍ إنشاء سيناريوهات البيع…",
    vita_conseil_lbl: "نصيحة فيتا",
    cert_header: "شهادة التدريب",
    cert_download_png: "تنزيل PNG",
    cert_copy_link: "نسخ الرابط 🔗",
    cert_link_copied: "✓ تم نسخ الرابط",
    modal_title_cert: "تدريب المندوبين التجاريين",
    cert_wm: "VITAL SA · التدريب التجاري · معتمد من VitalAgent",
}
};

function t(key, ...args) {
  const lang = state.lang || "fr";
  const val = T[lang]?.[key];
  if (typeof val === "function") return val(...args);
  return val || T["fr"][key] || key;
}

// ══════════════════════════════════════════════════════════════════════════
// TYPING ENGINE
// ══════════════════════════════════════════════════════════════════════════
const TypingEngine = {
  queue: "", timer: null, element: null, cursor: null, onDone: null, _sealed: false,

  start(element, cursor, onDone) {
    this.element = element; this.cursor = cursor || null;
    this.onDone = onDone || null; this._sealed = false;
    if (this.cursor) this.cursor.style.display = "inline-block";
    if (!this.timer) this._tick();
  },

  push(text) { this.queue += text; },
  finish() { this._sealed = true; },

  reset() {
    clearTimeout(this.timer);
    this.timer = null; this.queue = ""; this.element = null;
    this._sealed = false;
    if (this.cursor) this.cursor.style.display = "none";
    this.cursor = null; this.onDone = null;
  },

  _tick() {
    this.timer = null;
    if (!this.element) return;
    if (this.queue.length === 0) {
      if (this._sealed) {
        if (this.cursor) this.cursor.style.display = "none";
        if (this.onDone) this.onDone();
        this.reset(); return;
      }
      this.timer = setTimeout(() => this._tick(), 40); return;
    }
    const burst = Math.min(this.queue.length, Math.random() < 0.25 ? 2 : 1);
    this.element.textContent += this.queue.slice(0, burst);
    this.queue = this.queue.slice(burst);
    const last = this.element.textContent.slice(-1);
    let delay = 18 + Math.random() * 16;
    if (last === "," || last === ";") delay = 95;
    else if ("·.!?".includes(last))  delay = 180;
    else if (last === "\n")           delay = 120;
    else if (last === " ")            delay = 28;
    this.timer = setTimeout(() => this._tick(), delay);
  },
};

// ══════════════════════════════════════════════════════════════════════════
// AVATAR
// ══════════════════════════════════════════════════════════════════════════
function moveAvatarToQuizPanel() {
  const avatarDiv = document.getElementById("avatarDiv");
  const slot      = document.getElementById("avatar-scene-slot");
  if (!avatarDiv || !slot || slot.contains(avatarDiv)) return;
  slot.innerHTML = "";
  slot.appendChild(avatarDiv);
}

function moveAvatarToSetup() {
  const avatarDiv = document.getElementById("avatarDiv");
  const setupWrap = document.querySelector(".setup-avatar-wrap");
  if (!avatarDiv || !setupWrap || setupWrap.contains(avatarDiv)) return;
  setupWrap.insertBefore(avatarDiv, setupWrap.firstChild);
}

function moveAvatarToResults() {
  const avatarDiv = document.getElementById("avatarDiv");
  const ring      = document.getElementById("results-ring");
  if (!avatarDiv || !ring || ring.contains(avatarDiv)) return;
  ring.innerHTML = "";
  ring.appendChild(avatarDiv);
}

// ══════════════════════════════════════════════════════════════════════════
// TTS / PAROLE
// ══════════════════════════════════════════════════════════════════════════
let _avatarMuted = false;
let _speakToken  = 0;

function stopSpeaking() {
  _speakToken++;
  if (window._head && typeof window._head.stopSpeaking === "function") window._head.stopSpeaking();
  if (window._head?.audioCtx) { try { window._head.audioCtx.suspend(); window._head.audioCtx.resume(); } catch (_) {} }
  if (window._ttsAudio) { try { window._ttsAudio.pause(); window._ttsAudio.currentTime = 0; } catch (_) {} }
  if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (_) {} }
}

function speak(ttsText, delay = 0, bubbleText = null) {
  stopSpeaking();
  const token = _speakToken;
  const el = $("bubble-text");
  if (el) {
    el.style.opacity = "0";
    setTimeout(() => {
      if (_speakToken !== token) return;
      el.textContent = bubbleText !== null ? bubbleText : ttsText;
      el.style.opacity = "1";
    }, 150);
  }
  if (_avatarMuted || !ttsText?.trim()) return;
  const fire = () => {
    if (_speakToken !== token) return;
    if (typeof window.speakWithAvatar === "function") {
      const langCode = state.lang === "ar" ? "ar" : state.lang === "en" ? "en" : "fr";
      window.speakWithAvatar(ttsText, langCode);
    }
  };
  delay > 0 ? setTimeout(fire, delay) : fire();
}

function speakFinalFeedback(text) {
  if (_avatarMuted || !text?.trim()) return;
  if (typeof window.speakWithAvatar === "function") {
    window.speakWithAvatar(text, state.lang === "ar" ? "ar" : state.lang === "en" ? "en" : "fr");
  }
}

function toggleMuteAvatar() {
  _avatarMuted = !_avatarMuted;
  const btn    = $("mute-btn");
  const iconOn = $("mute-icon-sound");
  const iconOff= $("mute-icon-muted");
  if (btn)    btn.classList.toggle("muted", _avatarMuted);
  if (iconOn)  iconOn.style.display  = _avatarMuted ? "none"  : "block";
  if (iconOff) iconOff.style.display = _avatarMuted ? "block" : "none";
  if (_avatarMuted) stopSpeaking();
}

function waitForAvatar(callback) {
  const iv = setInterval(() => {
    if (window._avatarReady === true) { clearInterval(iv); callback(); }
  }, 200);
  setTimeout(() => { clearInterval(iv); callback(); }, 12000);
}

// ══════════════════════════════════════════════════════════════════════════
// LANGUE — sélecteur
// ══════════════════════════════════════════════════════════════════════════
function setLang(lang) {
  state.lang = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir  = T[lang].dir;
  refreshUILabels();

  document.querySelectorAll(".lang-pill").forEach(b => {
    b.classList.toggle("active", b.dataset.lang === lang);
  });
}

function refreshUILabels() {
  // Status
  const st = $("status-text");
  if (st && st.textContent !== t("loading_avatar")) { /* keep dynamic */ }

  // Setup texts
  const tit = document.querySelector(".setup-title");
  if (tit) tit.textContent = t("quiz_title");

  const sub = document.querySelector(".setup-subtitle");
  if (sub) sub.textContent = t("quiz_subtitle");

  // Option labels
  document.querySelectorAll(".option-label").forEach((el, i) => {
    const labels = [t("label_products"), t("label_level"), t("label_count")];
    if (labels[i]) el.textContent = labels[i];
  });

  // Product search placeholder
  const ps = $("product-search");
  if (ps) ps.placeholder = t("search_product");

  const cr = $("clear-selection");
  if (cr) cr.textContent = t("reset");

  // Difficulty pills
  document.querySelectorAll(".diff-pill").forEach(btn => {
    const lvl = btn.dataset.level;
    const nameEl = btn.querySelector(".diff-name");
    const descEl = btn.querySelector(".diff-desc");
    if (nameEl) nameEl.textContent = t(`level_${lvl}`);
    if (descEl) descEl.textContent = t(`level_${lvl}_desc`);
  });

  // Start button
  const sb = $("start-btn");
  if (sb) {
    const txt = sb.querySelector(".start-label");
    if (txt) txt.textContent = t("start");
    else sb.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = t("start"); });
  }

  // Selection label
  updateSelectionLabel();

  // Coach role
  const role = document.querySelector(".agent-role");
  if (role) role.textContent = t("coach_role");

  // Bubble
  const bubble = $("bubble-text");
  if (bubble && (bubble.textContent === "Prêt(e) à vendre ?" || bubble.textContent === "Ready to sell?" || bubble.textContent === "مستعد للبيع؟"))
    bubble.textContent = t("ready_to_sell");

  const muteBtn = $("mute-btn");
  if (muteBtn) muteBtn.title = t("mute_vita");

  const donutLbl = document.querySelector(".donut-label");
  if (donutLbl) donutLbl.textContent = t("score_label");

  // Product dropdown trigger
  updateSelectionLabel();

  // ── Back button & brand module ──
  const backLabel = document.getElementById("back-label");
  if (backLabel) backLabel.textContent = t("back");
  const brandModule = document.querySelector(".brand-module");
  if (brandModule) brandModule.textContent = t("brand_module");

  // ── Waiting state text ──
  const waitingTxt = document.querySelector(".waiting-text");
  if (waitingTxt) waitingTxt.textContent = t("waiting_text");

  // ── Vita conseil label ──
  const vitaConseilLabel = document.getElementById("vita-conseil-label");
  if (vitaConseilLabel) vitaConseilLabel.textContent = t("vita_conseil_lbl");

  // ── Prev button ──
  const prevLabelEl = document.getElementById("prev-label");
  if (prevLabelEl) prevLabelEl.textContent = t("prev");

  // ── Next button (only when not dynamically set) ──
  const nextLabelEl = document.getElementById("next-label");
  if (nextLabelEl) nextLabelEl.textContent = t("next");

  // ── Results screen ──
  const restartLabel = document.getElementById("restart-label");
  if (restartLabel) restartLabel.textContent = t("restart");

  const homeLabel = document.getElementById("home-label");
  if (homeLabel) homeLabel.textContent = t("home");

  const vitaBilanRole = document.getElementById("vita-bilan-role");
  if (vitaBilanRole) vitaBilanRole.textContent = t("vita_bilan");

  const certTitleTxt = document.getElementById("cert-title-txt");
  if (certTitleTxt) certTitleTxt.textContent = t("cert_title");

  const certSubtitleTxt = document.getElementById("cert-subtitle-txt");
  if (certSubtitleTxt) certSubtitleTxt.textContent = t("cert_subtitle");

  const certDlLabel = document.getElementById("cert-dl-label");
  if (certDlLabel) certDlLabel.textContent = t("cert_download");

  // ── Certificate modal buttons ──
  const certModalDl = document.getElementById("cert-modal-dl-label");
  if (certModalDl) certModalDl.textContent = t("cert_download_png");

  const certModalCopy = document.getElementById("cert-modal-copy-label");
  if (certModalCopy) certModalCopy.textContent = t("cert_copy_link");

  // ── lang-label in setup ──
  const langLabel = document.getElementById("lang-label");
  if (langLabel) langLabel.textContent = t("lang_label");

  // ── Difficulty banner (refresh current level) ──
  const activeDiff = document.querySelector(".diff-pill.active");
  if (activeDiff) {
    const level = activeDiff.dataset.level;
    const banner = document.getElementById("diff-banner");
    if (banner) banner.className = `diff-context-banner ${level} visible`;
    // banner inner HTML is handled by the inline script using bannerTexts
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PRODUITS
// ══════════════════════════════════════════════════════════════════════════
async function loadProducts() {
  try {
    const res  = await fetch(`${API_BASE}/products`);
    const data = await res.json();
    allProducts = (data.products || []).sort();
    renderProductList(allProducts);
    updateSelectionLabel();
  } catch {
    $("product-list").innerHTML = `<div>${t("error_products")}</div>`;
  }
}

function renderProductList(products) {
  const list = $("product-list");
  list.innerHTML = "";
  products.forEach(name => {
    const isChecked = state.selectedProducts.includes(name);
    const item      = document.createElement("label");
    item.className  = "product-item" + (isChecked ? " checked" : "");
    item.innerHTML  = `
      <input type="checkbox" class="product-checkbox" value="${escHtml(name)}" ${isChecked ? "checked" : ""}>
      <span>${escHtml(name)}</span>`;
    item.querySelector("input").addEventListener("change", (e) => {
      toggleProduct(name, e.target.checked);
      item.classList.toggle("checked", e.target.checked);
    });
    list.appendChild(item);
  });
}

function toggleProduct(name, checked) {
  if (checked) { if (!state.selectedProducts.includes(name)) state.selectedProducts.push(name); }
  else { state.selectedProducts = state.selectedProducts.filter(p => p !== name); }
  updateSelectionLabel();
}

function updateSelectionLabel() {
  const label = $("selection-label");
  if (!label) return;
  const count = state.selectedProducts.length;
  if (count === 0)      label.textContent = t("all_products");
  else if (count === 1) label.textContent = state.selectedProducts[0];
  else                  label.textContent = t("n_products", count);
}

function setupProductSearch() {
  const s = $("product-search");
  if (!s) return;
  s.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    renderProductList(q ? allProducts.filter(p => p.toLowerCase().includes(q)) : allProducts);
  });
}

$("product-dropdown-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  $("product-dropdown").classList.toggle("open");
});

document.addEventListener("click", (e) => {
  const d = $("product-dropdown");
  if (d && !d.contains(e.target)) d.classList.remove("open");
});

$("clear-selection")?.addEventListener("click", (e) => {
  e.stopPropagation();
  state.selectedProducts = [];
  renderProductList(allProducts);
  updateSelectionLabel();
});

// ══════════════════════════════════════════════════════════════════════════
// OPTIONS SETUP
// ══════════════════════════════════════════════════════════════════════════
document.querySelectorAll(".diff-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".diff-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.difficulty = btn.dataset.level;
    applyDifficultyTheme(state.difficulty);
  });
});

function applyDifficultyTheme(level) {
  document.body.setAttribute("data-difficulty", level);
}

document.querySelectorAll(".qc-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".qc-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.questionCount = parseInt(btn.dataset.count);
  });
});

// Language pills
document.querySelectorAll(".lang-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    setLang(btn.dataset.lang);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// DÉMARRAGE DU QUIZ
// ══════════════════════════════════════════════════════════════════════════
$("start-btn").addEventListener("click", startQuiz);

async function startQuiz() {
  stopSpeaking();
  Object.assign(state, {
    current: 0, score: 0, answered: false, history: [],
    questions: [], streamDone: false, generating: true,
    totalExpected: state.questionCount,
  });
  // Reset behavioral sessions
  _baSessions = [];

  // === ANALYSE COMPORTEMENTALE (comme quiz-medical) ===
  if (document.getElementById("ba-consent-toggle")) {
    _baConsent = document.getElementById("ba-consent-toggle").checked;
  }
  if (_baConsent) {
    if (!_baAnalyzer) _baAnalyzer = new BehavioralAnalyzer();
    _baEnabled = await _baAnalyzer.init();
    if (_baEnabled) {
      _baAnalyzer.onFrame((frame) => updateLiveFrame(frame));
      initBehavioralPanel(_baAnalyzer.videoElement, _baAnalyzer.overlayCanvas);
    }
  }

  $("product-dropdown")?.classList.remove("open");
  moveAvatarToQuizPanel();
  applyDifficultyTheme(state.difficulty);

  $("setup-screen").style.display    = "none";
  $("quiz-screen").style.display     = "flex";
  $("progress-header").style.display = "flex";
  $("score-badge").style.display     = "flex";

  showLoadingState();

  const selCount = state.selectedProducts.length;
  if (selCount === 1)    speak(t("generating_1", state.selectedProducts[0]));
  else if (selCount > 1) speak(t("generating_n", selCount));
  else                   speak(t("generating_all"));

  startSSEStream();
}

function showLoadingState() {
  $("waiting-state").style.display = "flex";
  $("question-area").style.display = "none";
  const lp = $("load-progress");
  if (lp) lp.style.display = "flex";
  updateLoadBar(0, state.totalExpected);
}

// ══════════════════════════════════════════════════════════════════════════
// SSE STREAM
// ══════════════════════════════════════════════════════════════════════════
function startSSEStream() {
  fetch(`${API_BASE}/quiz-commercial/generate/stream`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      products:       state.selectedProducts,
      difficulty:     state.difficulty,
      question_count: state.questionCount,
      lang:           state.lang,
    }),
  })
  .then(res => {
    if (!res.ok) throw new Error(`Erreur serveur: ${res.status}`);
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = "";
    function pump() {
      reader.read().then(({ done, value }) => {
        if (done) { state.streamDone = true; state.generating = false; checkAutoStart(); return; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { processSSEEvent(JSON.parse(line.slice(6))); } catch (_) {}
          }
        }
        pump();
      }).catch(err => {
        console.error("[Quiz Commercial] SSE error:", err);
        state.streamDone = true;
        if (state.questions.length === 0) returnToSetup(t("error_server"));
        else checkAutoStart();
      });
    }
    pump();
  })
  .catch(err => returnToSetup(t("error_connect", err.message)));
}

function checkAutoStart() {
  if (state.questions.length > 0 && $("waiting-state").style.display !== "none") {
    $("waiting-state").style.display = "none";
    $("question-area").style.display = "block";
    loadQuestion(0);
  }
  const lp = $("load-progress");
  if (state.streamDone && lp) {
    updateLoadBar(state.questions.length, state.questions.length);
    setTimeout(() => { lp.style.display = "none"; }, 1500);
  }
}

function processSSEEvent(event) {
  if (event.type === "loading") {
    state.totalExpected = event.total || state.questionCount;
    updateLoadBar(0, state.totalExpected);
  }
  if (event.type === "question") {
    state.questions.push(event.question);
    updateLoadBar(state.questions.length, state.totalExpected);
    if (state.questions.length === 1) {
      $("waiting-state").style.display = "none";
      $("question-area").style.display = "block";
      loadQuestion(0);
    }
    if (_waitingForNext && state.questions.length > state.current + 1) {
      _waitingForNext        = false;
      $("next-btn").disabled = false;
      loadQuestion(state.current + 1);
    }
  }
  if (event.type === "done") {
    state.streamDone    = true;
    state.generating    = false;
    state.totalExpected = event.count || state.questions.length;
    updateLoadBar(state.questions.length, state.questions.length);
    setTimeout(() => { const lp = $("load-progress"); if (lp) lp.style.display = "none"; }, 1500);
    updateHeader();
  }
}

function updateLoadBar(loaded, total) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  if ($("load-fill"))  $("load-fill").style.width  = `${pct}%`;
  if ($("load-label")) $("load-label").textContent = t("loading_scenarios", loaded, total);
}

// ══════════════════════════════════════════════════════════════════════════
// AFFICHAGE D'UNE QUESTION
// ══════════════════════════════════════════════════════════════════════════
function loadQuestion(idx) {
  if (idx >= state.questions.length) return;
  stopSpeaking();
  TypingEngine.reset();
  if ($("llm-feedback-container")) $("llm-feedback-container").innerHTML = "";

  const q = state.questions[idx];
  state.current  = idx;
  state.answered = false;
  updateHeader();

  const panel = document.querySelector(".question-panel");
  if (panel) { panel.style.transition = "opacity 0.15s ease"; panel.style.opacity = "0"; }

  setTimeout(() => {
    $("q-number").textContent = t("q_label", idx);
    $("q-topic").textContent  = q.product || "Formation VITAL SA";

    // ── Behavioral: start tracking this question ──
    _baStartQuestion(idx);

    $("q-difficulty-badge").textContent = t("diff_labels")[state.difficulty] || state.difficulty;
    $("q-difficulty-badge").className   = `q-difficulty-badge diff-${state.difficulty}`;

    const skillBadge = $("sales-skill-badge");
    const skillText  = $("sales-skill-text");
    if (skillBadge && skillText && q.sales_skill) {
      skillText.textContent    = q.sales_skill;
      skillBadge.style.display = "inline-flex";
    } else if (skillBadge) { skillBadge.style.display = "none"; }

    $("question-text").textContent = q.question;

    const grid    = $("choices-grid");
    grid.innerHTML = "";
    const letters = ["A", "B", "C", "D"];
    q.choices.forEach((choice, i) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.innerHTML = `<span class="choice-letter">${letters[i]}</span><span class="choice-text">${escHtml(choice)}</span>`;
      btn.addEventListener("click", () => handleAnswer(i, q));
      grid.appendChild(btn);
    });

    $("explanation-box").style.display = "none";
    $("action-row").style.display      = "none";

    const prevBtn = $("prev-btn");
    if (prevBtn) prevBtn.style.display = idx > 0 ? "inline-flex" : "none";

    const saved = state.history[idx];
    if (saved) {
      state.answered = true;
      const buttons = grid.querySelectorAll(".choice-btn");
      buttons.forEach((btn, i) => {
        btn.disabled = true;
        if (i === q.correct_index) btn.classList.add("correct");
      });
      const chosenIdx = q.choices.indexOf(saved.chosen);
      if (chosenIdx !== -1 && chosenIdx !== q.correct_index) buttons[chosenIdx].classList.add("wrong");

      $("explanation-icon").textContent    = saved.ok ? "✓" : "✗";
      $("explanation-icon").className      = `explanation-icon ${saved.ok ? "ok" : "bad"}`;
      $("explanation-verdict").textContent = saved.ok ? t("verdict_ok") : t("verdict_bad");
      $("explanation-text").textContent    = saved.explanation || "";
      $("explanation-box").style.display   = "flex";

      const isLast = idx >= state.questions.length - 1 && state.streamDone;
      $("next-btn").innerHTML = isLast ? `<span id="next-label">${t("see_results")}</span> →` : `<span id="next-label">${t("next")}</span> →`;
      $("action-row").style.display = "flex";
    }

    if (panel) { panel.scrollTop = 0; panel.style.opacity = "1"; }

    const qNum = idx + 1;
    const shortBubble = t("q_short_bubble", qNum, q.product || "VITAL SA");
    speak(q.question, 80, shortBubble);
  }, 120);
}

function updateHeader() {
  const total = state.streamDone ? state.questions.length : state.totalExpected;
  if ($("q-counter"))
    $("q-counter").textContent = t("q_counter", state.current + 1, total);
  if ($("progress-fill-mini"))
    $("progress-fill-mini").style.width = `${((state.current) / Math.max(total, 1)) * 100}%`;
  const answeredCount = state.history.filter(Boolean).length;
  if ($("score-live"))
    $("score-live").textContent = `${state.score} / ${answeredCount}`;
  updateDonut();
}

function updateDonut() {
  const answeredCount = state.history.filter(Boolean).length;
  const pct = answeredCount > 0 ? Math.round((state.score / answeredCount) * 100) : 0;
  const arc = $("donut-arc");
  if (arc) {
    const circumference = 201;
    arc.style.strokeDashoffset = circumference - (circumference * pct / 100);
    arc.style.stroke = pct >= 70 ? "#867416" : pct >= 40 ? "#bea74b" : "#ef4444";
  }
  if ($("donut-pct")) $("donut-pct").textContent = `${pct}%`;
}

// ══════════════════════════════════════════════════════════════════════════
// RÉPONSE
// ══════════════════════════════════════════════════════════════════════════
let _feedbackForIdx = -1;

async function handleAnswer(chosenIdx, q) {
  if (state.answered) return;
  state.answered = true;
  stopSpeaking();

  const isOk = chosenIdx === q.correct_index;
  if (isOk) state.score++;
  const thisIdx = state.current;
  _feedbackForIdx = thisIdx;

  // ── Behavioral: stop tracking, record session ──
  _baStopQuestion(thisIdx);

  const buttons = $("choices-grid").querySelectorAll(".choice-btn");
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.correct_index)   btn.classList.add("correct");
    if (i === chosenIdx && !isOk) btn.classList.add("wrong");
  });

  state.history[state.current] = {
    question:    q.question,
    product:     q.product     || "—",
    sales_skill: q.sales_skill || "",
    chosen:      q.choices[chosenIdx],
    correct:     q.choices[q.correct_index],
    ok:          isOk,
    explanation: q.explanation || "",
  };

  $("explanation-icon").textContent    = isOk ? "✓" : "✗";
  $("explanation-icon").className      = `explanation-icon ${isOk ? "ok" : "bad"}`;
  $("explanation-verdict").textContent = isOk ? t("verdict_ok") : t("verdict_bad");
  $("explanation-text").textContent    = q.explanation || "";
  $("explanation-box").style.display   = "flex";

  const isLast = state.current >= state.questions.length - 1 && state.streamDone;
  $("next-btn").innerHTML = isLast
    ? `<span id="next-label">${t("see_results")}</span> <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<span id="next-label">${t("next")}</span> <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  $("action-row").style.display = "flex";
  updateHeader();

  const feedbackText  = isOk ? t("answer_ok") : t("answer_bad");
  const feedbackBubble = isOk ? t("bubble_ok") : t("bubble_bad");
  const wordCount     = feedbackText.split(" ").length;
  const voiceDurationMs = Math.min(Math.max(wordCount * 70, 1800), 3500);
  speak(feedbackText, 150, feedbackBubble);
  await new Promise(resolve => setTimeout(resolve, 150 + voiceDurationMs));
  if (_feedbackForIdx !== thisIdx) return;

  const bubbleEl = $("bubble-text");
  if (bubbleEl) {
    bubbleEl.style.opacity = "0";
    setTimeout(() => {
      bubbleEl.textContent = t("bubble_analyzing", isOk);
      bubbleEl.style.opacity = "1";
    }, 150);
  }
  await streamLLMFeedback(q, chosenIdx, q.correct_index, isOk, thisIdx);
}

// ══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════
let _waitingForNext = false;

$("next-btn").addEventListener("click", goToNext);
$("prev-btn")?.addEventListener("click", goToPrev);

function goToNext() {
  stopSpeaking(); TypingEngine.reset(); _feedbackForIdx = -1;
  const nextIdx = state.current + 1;
  if (nextIdx < state.questions.length) { loadQuestion(nextIdx); return; }
  if (state.streamDone)                 { showResults(); return; }

  _waitingForNext = true;
  $("next-btn").disabled    = true;
  $("next-btn").textContent = t("waiting");

  const check = setInterval(() => {
    if (state.questions.length > nextIdx) {
      clearInterval(check); _waitingForNext = false;
      $("next-btn").disabled = false; loadQuestion(state.current + 1);
    } else if (state.streamDone) {
      clearInterval(check); _waitingForNext = false; showResults();
    }
  }, 200);
}

function goToPrev() {
  stopSpeaking(); TypingEngine.reset(); _feedbackForIdx = -1;
  const prevIdx = state.current - 1;
  if (prevIdx < 0) return;
  const currentSaved = state.history[state.current];
  if (currentSaved && currentSaved.ok) state.score = Math.max(0, state.score - 1);
  delete state.history[state.current];
  loadQuestion(prevIdx);
}

function returnToSetup(msg) {
  alert(msg);
  $("quiz-screen").style.display  = "none";
  $("setup-screen").style.display = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display     = "none";
  moveAvatarToSetup();
}

// ══════════════════════════════════════════════════════════════════════════
// FEEDBACK LLM STREAMÉ
// ══════════════════════════════════════════════════════════════════════════
async function streamLLMFeedback(q, chosenIdx, correctIdx, isOk, fromIdx) {
  const container = $("llm-feedback-container");
  if (!container) return;
  const stillHere = () => _feedbackForIdx === fromIdx;
  if (!stillHere()) return;

  container.innerHTML = `
    <div class="llm-feedback-wrap">
      <div class="llm-feedback-bubble ${isOk ? "correct" : "wrong"}">
        <div class="llm-feedback-avatar">🎯</div>
        <div class="llm-feedback-text">
          <span id="llm-stream-text"></span><span class="typing-cursor" id="llm-typing-cursor" style="display:none"></span>
        </div>
      </div>
    </div>`;

  const textEl   = $("llm-stream-text");
  const cursorEl = $("llm-typing-cursor");
  if (!textEl) return;
  TypingEngine.reset();
  TypingEngine.start(textEl, cursorEl);

  let res;
  try {
    res = await fetch(`${API_BASE}/quiz-commercial/feedback`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question:    q.question,
        product:     q.product     || "",
        sales_skill: q.sales_skill || "",
        chosen:      q.choices[chosenIdx],
        correct:     q.choices[correctIdx],
        explanation: q.explanation || "",
        is_correct:  isOk,
        lang:        state.lang,
      }),
    });
  } catch (err) {
    if (stillHere()) container.innerHTML = "";
    TypingEngine.reset(); return;
  }

  if (!res.ok) { if (stillHere()) container.innerHTML = ""; TypingEngine.reset(); return; }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (!stillHere()) { reader.cancel(); TypingEngine.reset(); return; }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "token") TypingEngine.push(ev.content);
            if (ev.type === "done")  TypingEngine.finish();
          } catch (_) {}
        }
      }
      TypingEngine.finish();
    } catch (_) { TypingEngine.finish(); }
  } else {
    try {
      const data = await res.json();
      if (stillHere()) { TypingEngine.push(data.text || ""); TypingEngine.finish(); }
      else TypingEngine.reset();
    } catch (_) { TypingEngine.finish(); }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// RÉSULTATS
// ══════════════════════════════════════════════════════════════════════════
function showResults() {
  stopSpeaking();
  moveAvatarToResults();
  $("quiz-screen").style.display    = "none";
  $("results-screen").style.display = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display     = "none";

  const total = state.history.filter(Boolean).length;
  const pct   = total ? Math.round((state.score / total) * 100) : 0;

  $("results-score-num").textContent   = state.score;
  $("results-score-denom").textContent = `/ ${total}`;

  const titleKey = pct >= 80 ? "results_top" : pct >= 60 ? "results_good" : "results_low";
  const title = t(titleKey);
  $("results-title").textContent   = title;
  $("results-message").textContent = t("results_msg", pct, state.score, total);

  // Skills summary
  const skillsContainer = $("skills-summary");
  if (skillsContainer) {
    const skillCounts = {}, skillOk = {};
    state.history.filter(Boolean).forEach(item => {
      const s = item.sales_skill || "Autre";
      skillCounts[s] = (skillCounts[s] || 0) + 1;
      skillOk[s]     = (skillOk[s]     || 0) + (item.ok ? 1 : 0);
    });
    skillsContainer.innerHTML = "";
    const diffLabel = t("diff_labels")[state.difficulty] || state.difficulty;
    const diffEl = document.createElement("div");
    diffEl.style.cssText = "width:100%;font-size:11px;color:var(--text-muted);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase;";
    diffEl.textContent = t("level_tested", diffLabel);
    skillsContainer.appendChild(diffEl);

    const sorted = Object.entries(skillCounts).sort((a, b) => {
      const pA = (skillOk[a[0]] || 0) / a[1];
      const pB = (skillOk[b[0]] || 0) / b[1];
      return pA - pB;
    });
    sorted.forEach(([skill, count]) => {
      const ok = skillOk[skill] || 0;
      const sp = Math.round((ok / count) * 100);
      const color = sp >= 70 ? "#10b981" : sp >= 40 ? "#f59e0b" : "#ef4444";
      const el = document.createElement("span");
      el.className = "sales-skill-badge";
      el.style.borderColor = color + "66";
      el.style.color = color;
      el.title = `${ok}/${count} correctes`;
      el.innerHTML = `${skill} <strong>${sp}%</strong>`;
      skillsContainer.appendChild(el);
    });
  }

  // Breakdown
  const breakdown = $("results-breakdown");
  breakdown.innerHTML = "";
  state.history.filter(Boolean).forEach((item, i) => {
    const div = document.createElement("div");
    div.className = `result-item ${item.ok ? "correct" : "wrong"}`;
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:15px">${item.ok ? "✓" : "✗"}</span>
        <strong style="flex:1">${escHtml(item.product)}</strong>
        ${item.sales_skill ? `<span style="font-size:10px;opacity:.6;font-style:italic">${escHtml(item.sales_skill)}</span>` : ""}
        <span style="font-size:11px;opacity:.5">${t("q_label", i)}</span>
      </div>
      <p style="font-size:12.5px;opacity:.75;margin-bottom:6px">${escHtml(item.question)}</p>
      ${!item.ok ? `
        <p style="color:#ef4444;font-size:12px;margin-bottom:3px">${t("your_answer")} ${escHtml(item.chosen)}</p>
        <p style="color:#10b981;font-size:12px;margin-bottom:6px">${t("best_approach")} ${escHtml(item.correct)}</p>
      ` : ""}
      ${item.explanation ? `<p style="font-size:12px;opacity:.65;font-style:italic">${escHtml(item.explanation)}</p>` : ""}`;
    breakdown.appendChild(div);
  });

  // ── Behavioral report ──────────────────────────────────────────────────
  const baReport = _baBuildReport();
  _renderBehavioralReport(baReport);

  const ring = $("results-ring");
  if (ring) ring.style.borderColor = pct >= 70 ? "#867416" : pct >= 40 ? "#bea74b" : "#ef4444";

  // Update Vita role in results
  const finalRole = document.querySelector(".final-feedback-role");
  if (finalRole) finalRole.textContent = t("vita_bilan");

  const certSection = $("certificate-section");
  if (certSection) certSection.style.display = pct >= 60 ? "block" : "none";

  speak(title, 0, `${pct}% · ${state.score}/${total}`);

  if (total > 0) {
    setTimeout(() => streamFinalVerdict(), 400);
  } else {
    setTimeout(saveQuizResult, 500);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// BILAN FINAL VITA — AXÉ VENTE COMMERCIALE
// ══════════════════════════════════════════════════════════════════════════
async function streamFinalVerdict() {
  const section = $("final-feedback-section");
  const textEl  = $("final-feedback-text");
  if (!section || !textEl) return;

  TypingEngine.reset();
  section.style.display = "block";
  textEl.innerHTML = `<div class="final-feedback-loading">
    <div class="feedback-typing-spinner"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    ${t("vita_loading")}
  </div>`;

  await new Promise(r => setTimeout(r, 800));
  textEl.innerHTML = "";

  const finalCursor = document.createElement("span");
  finalCursor.className = "typing-cursor";
  textEl.appendChild(finalCursor);

  const textSpan = document.createElement("p");
  textSpan.style.cssText = "white-space: pre-wrap; margin: 0; line-height: 1.7;";
  textEl.insertBefore(textSpan, finalCursor);

  let fullText = "";
  TypingEngine.start(textSpan, finalCursor, () => {
    speakFinalFeedback(fullText);
    setTimeout(saveQuizResult, 600);
  });

  let res;
  try {
    res = await fetch(`${API_BASE}/quiz-commercial/feedback/final/stream`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score:      state.score,
        total:      state.history.filter(Boolean).length,
        difficulty: state.difficulty,
        history:    state.history.filter(Boolean),
        lang:       state.lang,
        quiz_type:  "commercial",
        behavioral: _baBuildReport(),  // ← inject behavioral data
      }),
    });
  } catch (err) {
    textEl.textContent = t("bilan_unavail"); return;
  }
  if (!res.ok) { textEl.textContent = t("bilan_unavail"); return; }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "token") { TypingEngine.push(ev.content); fullText += ev.content; }
          if (ev.type === "done")  TypingEngine.finish();
        } catch (_) {}
      }
    }
    TypingEngine.finish();
  } catch (_) { TypingEngine.finish(); }
}

// ══════════════════════════════════════════════════════════════════════════
// RESTART
// ══════════════════════════════════════════════════════════════════════════
$("restart-btn").addEventListener("click", () => {
  stopSpeaking(); TypingEngine.reset();
  // Stop behavioral if active
  if (_baUI) _baUI.stopTimer();
  _baSessions = [];
  Object.assign(state, {
    questions: [], current: 0, score: 0, answered: false,
    history: [], streamDone: false, generating: false,
  });
  $("results-screen").style.display = "none";
  $("setup-screen").style.display   = "flex";
  moveAvatarToSetup();
  speak(t("ready_to_sell"));
});

// ══════════════════════════════════════════════════════════════════════════
// BEHAVIORAL REPORT RENDERER
// ══════════════════════════════════════════════════════════════════════════
const EXPR_LABELS = {
  fr: { happy:"Confiant", neutral:"Concentré", surprised:"Surpris", fearful:"Incertain",
        disgusted:"Perplexe", angry:"Stressé", sad:"Découragé", forcedSmile:"Sourire forcé",
        tightLips:"Lèvres serrées", freeze:"Visage figé" },
  en: { happy:"Confident", neutral:"Focused", surprised:"Surprised", fearful:"Uncertain",
        disgusted:"Perplexed", angry:"Stressed", sad:"Discouraged", forcedSmile:"Forced smile",
        tightLips:"Tight lips", freeze:"Frozen face" },
  ar: { happy:"واثق", neutral:"مركّز", surprised:"مفاجأ", fearful:"غير متأكد",
        disgusted:"محتار", angry:"متوتر", sad:"محبط", forcedSmile:"ابتسامة مصطنعة",
        tightLips:"شفاه مضمومة", freeze:"وجه متجمّد" },
};
const BA_LABELS = {
  fr: {
    title: "📸 Analyse comportementale",
    subtitle: "Captée par caméra durant le quiz",
    stress: "Stress moyen", conf: "Confiance moyenne", think: "Temps de réflexion moy.",
    expr: "Expression dominante", signals: "Signaux récurrents", noSignals: "Aucun signal détecté",
    perQ: "Par question", none: "Caméra non activée — aucune donnée comportementale.",
    stressBadge: (n) => n > 60 ? "⚠ Stress élevé" : n > 35 ? "⚡ Stress modéré" : "✓ Détendu",
    sec: "s",
  },
  en: {
    title: "📸 Behavioral Analysis",
    subtitle: "Captured by camera during the quiz",
    stress: "Avg. stress", conf: "Avg. confidence", think: "Avg. think time",
    expr: "Dominant expression", signals: "Recurring signals", noSignals: "No signals detected",
    perQ: "Per question", none: "Camera not activated — no behavioral data.",
    stressBadge: (n) => n > 60 ? "⚠ High stress" : n > 35 ? "⚡ Moderate stress" : "✓ Relaxed",
    sec: "s",
  },
  ar: {
    title: "📸 التحليل السلوكي",
    subtitle: "تم التقاطه بالكاميرا خلال الاختبار",
    stress: "متوسط التوتر", conf: "متوسط الثقة", think: "متوسط وقت التفكير",
    expr: "التعبير السائد", signals: "الإشارات المتكررة", noSignals: "لا إشارات مكتشفة",
    perQ: "حسب السؤال", none: "الكاميرا غير مفعّلة — لا توجد بيانات سلوكية.",
    stressBadge: (n) => n > 60 ? "⚠ توتر عالٍ" : n > 35 ? "⚡ توتر معتدل" : "✓ مرتاح",
    sec: "ث",
  },
};

function _renderBehavioralReport(report) {
  // Remove old if any
  document.getElementById("ba-results-section")?.remove();

  const lang = state.lang || "fr";
  const lb   = BA_LABELS[lang] || BA_LABELS.fr;
  const el   = BA_LABELS[lang].expr;

  const section = document.createElement("div");
  section.id = "ba-results-section";
  section.style.cssText = `
    margin-top: 28px; padding: 20px 22px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 16px; width: 100%;`;

  if (!report) {
    section.innerHTML = `
      <div style="font-size:13px;color:var(--text-muted);text-align:center;padding:12px 0;">
        🎥 ${lb.none}
      </div>`;
    _insertBaSection(section); return;
  }

  const stressColor = report.avgStress > 60 ? "#ef4444" : report.avgStress > 35 ? "#f59e0b" : "#22c55e";
  const confColor   = report.avgConf   > 60 ? "#22c55e" : report.avgConf   > 35 ? "#f59e0b" : "#ef4444";
  const exprLabel   = (EXPR_LABELS[lang] || EXPR_LABELS.fr)[report.topExpr] || report.topExpr;
  const signalsHtml = report.topSignals.length > 0
    ? report.topSignals.map(s => `<span style="display:inline-block;padding:2px 9px;border-radius:20px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;font-size:11px;margin:2px 3px;">${escHtml(s)}</span>`).join("")
    : `<span style="font-size:12px;color:var(--text-muted);font-style:italic">${lb.noSignals}</span>`;

  // Per-question mini bars
  const perQRows = (report.perQuestion || []).filter(Boolean).map((s, i) => {
    if (!s) return "";
    const stPct = Math.round(s.avgStress * 100);
    const sc    = stPct > 60 ? "#ef4444" : stPct > 35 ? "#f59e0b" : "#22c55e";
    const exL   = (EXPR_LABELS[lang] || EXPR_LABELS.fr)[s.dominantExpr] || s.dominantExpr;
    const thinkS = Math.round(s.thinkMs / 1000);
    return `<div style="display:grid;grid-template-columns:28px 1fr 60px 60px;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="font-size:11px;color:var(--text-muted);text-align:center">${t("q_label", i)}</span>
      <div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${stPct}%;background:${sc};border-radius:3px;transition:width .3s"></div>
      </div>
      <span style="font-size:10px;color:${sc};text-align:right">${stPct}% stress</span>
      <span style="font-size:10px;color:var(--text-muted);text-align:right">${exL} · ${thinkS}${lb.sec}</span>
    </div>`;
  }).join("");

  section.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
      <span style="font-weight:700;font-size:14px;color:var(--text)">${lb.title}</span>
      <span style="font-size:11px;color:var(--text-muted);margin-left:4px">${lb.subtitle}</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;">
      <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:${stressColor}">${report.avgStress}%</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;text-transform:uppercase;letter-spacing:.05em">${lb.stress}</div>
        <div style="margin-top:6px;font-size:10px;color:${stressColor};font-weight:600">${lb.stressBadge(report.avgStress)}</div>
      </div>
      <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:${confColor}">${report.avgConf}%</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;text-transform:uppercase;letter-spacing:.05em">${lb.conf}</div>
        <div style="margin-top:6px;font-size:10px;color:var(--text-muted)">${lb.expr}: ${exprLabel}</div>
      </div>
      <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:var(--accent)">${report.avgThinkSec}${lb.sec}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;text-transform:uppercase;letter-spacing:.05em">${lb.think}</div>
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">${lb.signals}</div>
      ${signalsHtml}
    </div>

    ${perQRows ? `<div style="margin-top:12px;">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">${lb.perQ}</div>
      ${perQRows}
    </div>` : ""}
  `;

  _insertBaSection(section);
}

function _insertBaSection(section) {
  // Insert before the final-feedback-section
  const anchor = $("final-feedback-section");
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(section, anchor);
  } else {
    const card = document.querySelector(".results-card");
    if (card) card.appendChild(section);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CERTIFICAT
// ══════════════════════════════════════════════════════════════════════════
function closeCert() {
  const ov = $("cert-overlay");
  if (ov) { ov.style.opacity = "0"; ov.style.pointerEvents = "none"; }
}

function closeCertOnBg(e) {
  if (e.target === $("cert-overlay")) closeCert();
}

function downloadCertificate() {
  const total     = state.history.filter(Boolean).length;
  const pct       = total > 0 ? Math.round((state.score / total) * 100) : 0;
  const lang      = state.lang;
  const locale    = lang === "ar" ? "ar-DZ" : lang === "en" ? "en-GB" : "fr-FR";
  const today     = new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const mastered  = [...new Set(state.history.filter(h => h.ok).map(h => h.product))].join(", ") || "—";

  let delegateName = "Délégué VITAL SA";
  try {
    const userJson = localStorage.getItem('user');
    if (userJson) { const user = JSON.parse(userJson); if (user.fullName) delegateName = user.fullName; }
  } catch(e) {}

  const dir   = T[lang].dir;
  const scoreLbl = t("cert_score_lbl", state.score, total);

  const html = `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="UTF-8"/>
<title>Certificate — VitalAgent</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lato:wght@300;400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Lato',sans-serif;background:#eaf4f4;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:32px;gap:20px;direction:${dir}}
  .cert{background:#fff;width:760px;padding:0;border-radius:4px;position:relative;box-shadow:0 8px 48px rgba(112,199,198,0.22);overflow:hidden}
  .cert-top-bar{height:8px;background:linear-gradient(90deg,#70C7C6,#7B9DD2,#BBB4DA,#DAD4DE)}
  .cert-inner{padding:52px 64px 48px}
  .cert::after{content:'';position:absolute;inset:16px;border:1.5px solid rgba(112,199,198,0.35);border-radius:2px;pointer-events:none}
  .logo{text-align:center;margin-bottom:20px}
  .logo-name{font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:#1a2e2e;letter-spacing:.12em;text-transform:uppercase}
  .logo-sub{font-size:11px;color:#70C7C6;letter-spacing:.18em;text-transform:uppercase;margin-top:3px}
  .divider{width:80px;height:2px;background:linear-gradient(90deg,#70C7C6,#7B9DD2);margin:16px auto}
  .heading{text-align:center;font-family:'Playfair Display',serif;font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:#7B9DD2;margin-bottom:8px}
  .title{text-align:center;font-family:'Playfair Display',serif;font-size:34px;font-weight:700;color:#1a2e2e;line-height:1.25;margin-bottom:24px}
  .body{text-align:center;font-size:14px;color:#444;line-height:1.8;margin-bottom:28px;white-space:pre-wrap}
  .delegate{font-size:22px;font-family:'Playfair Display',serif;color:#1a2e2e;border-bottom:2px solid #70C7C6;display:inline-block;padding:0 24px 4px;margin:6px 0 10px}
  .score-box{display:inline-flex;align-items:center;gap:12px;background:linear-gradient(135deg,#eaf9f9,#d4eef0);border:2px solid #70C7C6;border-radius:12px;padding:14px 32px;margin:0 auto 24px}
  .score-num{font-size:40px;font-weight:700;font-family:'Playfair Display',serif;color:#1a7a7a}
  .score-lbl{font-size:12px;color:#7B9DD2;text-align:start;line-height:1.4;white-space:pre-line;font-weight:700}
  .products{background:#eaf9f9;border:1px solid #c8eae9;border-radius:8px;padding:12px 18px;font-size:12.5px;color:#555;margin-bottom:28px;text-align:start}
  .footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:8px;padding-top:20px;border-top:1px solid #c8eae9}
  .sig{text-align:center}.sig-line{width:160px;height:1.5px;background:linear-gradient(90deg,transparent,#70C7C6,transparent);margin:0 auto 6px}
  .sig-name{font-family:'Playfair Display',serif;font-size:13px;color:#1a2e2e}
  .sig-role{font-size:10px;color:#9a96b0;letter-spacing:.08em}
  .date{font-size:11px;color:#9a96b0;text-align:end}
  .cert-bottom{height:6px;background:linear-gradient(90deg,#DAD4DE,#BBB4DA,#7B9DD2,#70C7C6)}
  .wm{text-align:center;font-size:9px;color:#70C7C6;letter-spacing:.15em;text-transform:uppercase;padding:10px 0 4px;opacity:.7}
  @media print{body{background:#fff;padding:0}.cert{box-shadow:none}.no-print{display:none}}
</style>
</head>
<body>
<div class="cert">
  <div class="cert-top-bar"></div>
  <div class="cert-inner">
    <div class="logo"><div class="logo-name">VITAL SA</div><div class="logo-sub">Formation des Délégués Commerciaux</div></div>
    <div class="divider"></div>
    <div class="title">${t("quiz_title")}</div>
    <div class="body">${t("cert_atteste", delegateName)}</div>
    <div style="text-align:center">
      <div class="score-box">
        <div class="score-num">${pct}%</div>
        <div class="score-lbl">${scoreLbl}</div>
      </div>
    </div>
    <div class="products"><strong>${t("cert_products")}</strong> ${mastered}</div>
    <div class="footer">
      <div class="sig"><div class="sig-line"></div><div class="sig-name">Vita</div><div class="sig-role">${t("cert_sig_role")}</div></div>
      <div class="date">${t("cert_delivered", today)}<br><span style="font-size:9px;color:#BBB4DA">VitalAgent — VITAL SA</span></div>
    </div>
  </div>
  <div class="wm">VITAL SA · Formation Commerciale · Certifié VitalAgent</div>
  <div class="cert-bottom"></div>
</div>
<div class="no-print">
  <button onclick="window.print()" style="padding:12px 32px;background:linear-gradient(135deg,#70C7C6,#7B9DD2);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(112,199,198,0.35);letter-spacing:.04em">🖨️ Imprimer / Enregistrer en PDF</button>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = "certificat-formation-commerciale-vitalagent.html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyCertLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const lbl = document.getElementById("cert-modal-copy-label");
    if (lbl) {
      lbl.textContent = t("cert_link_copied");
      setTimeout(() => { lbl.textContent = t("cert_copy_link"); }, 2000);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SAVE RESULT
// ══════════════════════════════════════════════════════════════════════════
async function saveQuizResult() {
  const total      = state.history.filter(Boolean).length;
  const percentage = total ? Math.round((state.score / total) * 100) : 0;
  const feedbackEl = $("final-feedback-text");
  const feedbackText = feedbackEl ? feedbackEl.textContent.trim() : "";

  const payload = {
    quiz_type: "commercial",
    score: state.score,
    total_questions: total,
    percentage,
    feedback: feedbackText,
    difficulty: state.difficulty,
    lang: state.lang,
    products_selected: state.selectedProducts.length > 0 ? JSON.stringify(state.selectedProducts) : null,
  };

  try {
    const res = await fetch(`${API_BASE}/quiz/save-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) console.log("✅ Résultat enregistré");
    else console.warn("⚠️ Erreur serveur:", await res.text());
  } catch (err) {
    console.error("❌ saveQuizResult:", err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════════════════════════════════════
function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ══════════════════════════════════════════════════════════════════════════
// INIT (called after DOMContentLoaded)
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  setLang("fr");  // default
  loadProducts();
  setupProductSearch();
  waitForAvatar(() => {
    speak(t("ready_to_sell"));
    const ld = $("avatar-loading");
    if (ld) ld.style.display = "none";
  });

});