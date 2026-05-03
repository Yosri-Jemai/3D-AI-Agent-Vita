import { BehavioralAnalyzer } from "./behavioral-analysis.js";
import { 
  initBehavioralPanel, 
  updateLiveFrame, 
  startTimer, 
  stopTimer, 
  destroyPanel 
} from "./behavioral-ui.js";


const API_BASE = window.API_BASE || "http://localhost:8000";

// ── État global ────────────────────────────────────────────────────────────
let state = {
  questions: [],
  current: 0,
  score: 0,
  answered: false,
  difficulty: "moyen",
  questionCount: 10,
  selectedProducts: [],
  history: [],
  streamDone: false,
  totalExpected: 10,
  generating: false,
};


let _ba = null;
let _baEnabled = false;
let _baConsent = true;

let allProducts = [];

const $ = id => document.getElementById(id);

// ══════════════════════════════════════════════════════════════════════════════
// TYPING ENGINE — factory d'instances isolées
// ══════════════════════════════════════════════════════════════════════════════

function createTypingInstance() {
  const inst = {
    queue:   "",
    timer:   null,
    element: null,
    cursor:  null,
    onDone:  null,
    _sealed: false,

    start(element, cursor, onDone) {
      this.element = element;
      this.cursor  = cursor  || null;
      this.onDone  = onDone  || null;
      this._sealed = false;
      if (this.cursor) this.cursor.style.display = "inline-block";
      if (!this.timer) this._tick();
    },
    push(text) { this.queue += text; },
    finish()   { this._sealed = true; },
    reset() {
      clearTimeout(this.timer);
      this.timer   = null;
      this.queue   = "";
      this.element = null;
      this._sealed = false;
      if (this.cursor) this.cursor.style.display = "none";
      this.cursor  = null;
      this.onDone  = null;       // ← annule le callback onDone définitivement
    },
    _tick() {
      this.timer = null;
      if (!this.element) return;
      if (this.queue.length === 0) {
        if (this._sealed) {
          if (this.cursor) this.cursor.style.display = "none";
          if (this.onDone) this.onDone();
          this.reset();
          return;
        }
        this.timer = setTimeout(() => this._tick(), 40);
        return;
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
  return inst;
}

let _feedbackTyping = null;
let _finalTyping    = null;

// ══════════════════════════════════════════════════════════════════════════════
// TTS — Système anti-race-condition DÉFINITIF v2
//
// Problème racine : speakWithAvatar() streame l'audio de façon asynchrone.
// stopSpeaking() annule le timer AVANT le déclenchement, mais si l'audio
// EST DÉJÀ EN TRAIN DE JOUER, il faut l'interrompre via un AbortController
// propre à chaque appel TTS.
//
// Architecture :
//   • _speakGeneration   : compteur global. Chaque stopSpeaking() l'incrémente.
//   • _speakPendingTimer : setTimeout en attente. stopSpeaking() l'annule physiquement.
//   • _activeAbort       : AbortController de la session TTS EN COURS.
//                          stopSpeaking() l'abort() immédiatement → coupe l'audio.
//   • Chaque speak() crée un nouvel AbortController, l'enregistre dans _activeAbort,
//     et le passe à speakWithAvatar(). Si stopSpeaking() arrive après le démarrage
//     de l'audio → abort() coupe le flux en cours.
//   • Double garde : vérification gen + abort → silence garanti dans tous les cas.
//
// RÈGLE ABSOLUE : stopSpeaking() doit TOUJOURS être le PREMIER appel dans
//   loadQuestion(), goToNext(), goToPrev(), restart, startQuiz, showResults,
//   handleAnswer.
// ══════════════════════════════════════════════════════════════════════════════

let _speakGeneration   = 0;
let _speakPendingTimer = null;
let _activeAbort       = null;   // AbortController du TTS actuellement en lecture

function stopSpeaking() {
  // 1. Invalide toute génération en cours / en attente
  _speakGeneration++;

  // 2. Annule physiquement tout speak() encore dans son délai de 40ms
  if (_speakPendingTimer !== null) {
    clearTimeout(_speakPendingTimer);
    _speakPendingTimer = null;
  }

  // 3. Coupe l'audio EN COURS via AbortController → interrompt le stream TTS
  if (_activeAbort) {
    try { _activeAbort.abort(); } catch(e) {}
    _activeAbort = null;
  }

  // 4. Arrête le moteur avatar (stop source + suspend AudioContext)
  if (window._head) {
    if (typeof window._head.stopSpeaking === "function") {
      try { window._head.stopSpeaking(); } catch(e) {}
    }
    if (window._head._source) {
      try { window._head._source.stop(); window._head._source = null; } catch(e) {}
    }
    if (window._head.audioCtx?.state === "running") {
      try { window._head.audioCtx.suspend().catch(() => {}); } catch(e) {}
    }
  }

  // 5. Abort legacy (au cas où speakWithAvatar utilise window._currentSpeakAbort)
  if (window._currentSpeakAbort) {
    try { window._currentSpeakAbort.abort(); } catch(e) {}
    window._currentSpeakAbort = null;
  }

  // 6. Vide la bulle immédiatement — pas de texte fantôme
  const bubble = $("bubble-text");
  if (bubble) bubble.textContent = "";
}

// _doSpeak() : cœur commun, appelé par speak() et speakFinalFeedback().
// Crée un AbortController propre, l'enregistre globalement, le passe à speakWithAvatar().
// Si speakWithAvatar() ne supporte pas d'AbortController en paramètre, on expose
// window._currentSpeakAbort pour que avatar.js puisse l'intercepter.
function _doSpeak(text) {
  if (!text?.trim() || typeof window.speakWithAvatar !== "function") return;

  // Annule l'éventuel AbortController précédent (au cas où stopSpeaking() a été
  // appelé entre la vérification de génération et ici — cas ultra-rare mais couvert)
  if (_activeAbort) {
    try { _activeAbort.abort(); } catch(e) {}
  }

  const ctrl = new AbortController();
  _activeAbort               = ctrl;
  window._currentSpeakAbort  = ctrl;  // compatibilité avatar.js legacy

  try {
    // Tente de passer l'AbortController en paramètre (API future / mise à jour)
    window.speakWithAvatar(text, "fr", ctrl.signal);
  } catch(e) {
    // Fallback silencieux si la signature ne le supporte pas encore
    try { window.speakWithAvatar(text, "fr"); } catch(_) {}
  }
}

// speak() : usage général — questions, réponses, confirmations.
function speak(text) {
  if (!text?.trim()) return;

  // Mise à jour visuelle de la bulle (synchrone, indépendante du TTS)
  const el = $("bubble-text");
  if (el) {
    el.style.opacity = "0";
    setTimeout(() => {
      // Vérifie que la génération n'a pas changé avant d'afficher
      el.textContent = text;
      el.style.opacity = "1";
    }, 80);
  }

  if (typeof window.speakWithAvatar !== "function") return;

  const gen = _speakGeneration;   // capture AVANT le délai

  // Annule tout timer speak() précédent encore en attente
  if (_speakPendingTimer !== null) {
    clearTimeout(_speakPendingTimer);
  }

  // Délai court pour laisser stopSpeaking() + AudioContext.suspend() se terminer.
  // Si stopSpeaking() passe pendant ce délai → gen !== _speakGeneration → abandon.
  _speakPendingTimer = setTimeout(() => {
    _speakPendingTimer = null;
    if (gen !== _speakGeneration) return;   // invalide → silence garanti
    _doSpeak(text);
  }, 40);
}

// speakFinalFeedback() : appelé depuis le callback onDone du typing final.
// Même protection — onDone peut se déclencher après "Recommencer".
function speakFinalFeedback(text) {
  if (!text?.trim() || typeof window.speakWithAvatar !== "function") return;

  const gen = _speakGeneration;

  if (_speakPendingTimer !== null) {
    clearTimeout(_speakPendingTimer);
  }

  _speakPendingTimer = setTimeout(() => {
    _speakPendingTimer = null;
    if (gen !== _speakGeneration) return;
    _doSpeak(text);
  }, 40);
}

// ── Déplacement de l'avatar ───────────────────────────────────────────────
function moveAvatarToQuizPanel() {
  const avatarDiv = document.getElementById("avatarDiv");
  const slot = document.getElementById("avatar-scene-slot");
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
  const ring = document.getElementById("results-ring");
  if (!avatarDiv || !ring || ring.contains(avatarDiv)) return;
  ring.innerHTML = "";
  ring.appendChild(avatarDiv);
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadProducts();
  setupProductSearch();
  waitForAvatar(() => {
    speak("Bonjour ! Je suis Dr. Layla. Configurez votre quiz et commencez quand vous êtes prêt.");
    const loadEl = $("avatar-loading");
    if (loadEl) loadEl.style.display = "none";
  });
});

function waitForAvatar(callback) {
  const iv = setInterval(() => {
    if (window._avatarReady === true) { clearInterval(iv); callback(); }
  }, 200);
  setTimeout(() => { clearInterval(iv); callback(); }, 12000);
}

// ── Chargement produits ────────────────────────────────────────────────────
async function loadProducts() {
  try {
    const res  = await fetch(`${API_BASE}/products`);
    const data = await res.json();
    allProducts = (data.products || []).sort();
    renderProductList(allProducts);
    updateSelectionLabel();
  } catch (e) {
    console.warn("[Quiz] Produits non chargés depuis /products");
    $("product-list").innerHTML = `<div class="product-empty">Impossible de charger les produits</div>`;
  }
}

function renderProductList(products) {
  const list = $("product-list");
  list.innerHTML = "";
  products.forEach(name => {
    const isChecked = state.selectedProducts.includes(name);
    const item = document.createElement("label");
    item.className = "product-item" + (isChecked ? " checked" : "");
    item.innerHTML = `
      <input type="checkbox" class="product-checkbox" value="${escHtml(name)}" ${isChecked ? "checked" : ""}>
      <span class="product-item-name">${escHtml(name)}</span>
    `;
    item.querySelector("input").addEventListener("change", (e) => {
      toggleProduct(name, e.target.checked);
      item.classList.toggle("checked", e.target.checked);
    });
    list.appendChild(item);
  });
}

function toggleProduct(name, checked) {
  if (checked) {
    if (!state.selectedProducts.includes(name)) state.selectedProducts.push(name);
  } else {
    state.selectedProducts = state.selectedProducts.filter(p => p !== name);
  }
  updateSelectionLabel();
}

function updateSelectionLabel() {
  const label = $("selection-label");
  const count = state.selectedProducts.length;
  if (count === 0)      { label.textContent = "Tous les produits"; label.classList.remove("has-selection"); }
  else if (count === 1) { label.textContent = state.selectedProducts[0]; label.classList.add("has-selection"); }
  else                  { label.textContent = `${count} produits sélectionnés`; label.classList.add("has-selection"); }
}

function setupProductSearch() {
  const searchInput = $("product-search");
  if (!searchInput) return;
  searchInput.addEventListener("input", (e) => {
    const query    = e.target.value.toLowerCase().trim();
    const filtered = query ? allProducts.filter(p => p.toLowerCase().includes(query)) : allProducts;
    renderProductList(filtered);
  });
}

$("product-dropdown-btn") && $("product-dropdown-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("product-dropdown").classList.toggle("open");
});

document.addEventListener("click", (e) => {
  const dropdown = $("product-dropdown");
  const btn      = $("product-dropdown-btn");
  if (dropdown && !dropdown.contains(e.target) && e.target !== btn) {
    dropdown.classList.remove("open");
  }
});

$("clear-selection") && $("clear-selection").addEventListener("click", (e) => {
  e.stopPropagation();
  state.selectedProducts = [];
  renderProductList(allProducts);
  updateSelectionLabel();
});

// ── Setup options ─────────────────────────────────────────────────────────
document.querySelectorAll(".diff-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".diff-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.difficulty = btn.dataset.level;
  });
});

document.querySelectorAll(".qc-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".qc-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.questionCount = parseInt(btn.dataset.count);
  });
});

// ── Démarrage du quiz ─────────────────────────────────────────────────────
$("start-btn").addEventListener("click", startQuiz);

async function startQuiz() {
  // ← EN PREMIER : stoppe tout TTS immédiatement
  stopSpeaking();
  if (_feedbackTyping) { _feedbackTyping.reset(); _feedbackTyping = null; }
  if (_finalTyping)    { _finalTyping.reset();    _finalTyping    = null; }

  state.questions     = [];
  state.current       = 0;
  state.score         = 0;
  state.answered      = false;
  state.history       = [];
  state.streamDone    = false;
  state.generating    = true;
  state.totalExpected = state.questionCount;

  if ($("score-live"))         $("score-live").textContent         = "0 / 0";
  if ($("q-counter"))          $("q-counter").textContent          = `Question 1 / ${state.questionCount}`;
  if ($("progress-fill-mini")) $("progress-fill-mini").style.width = "0%";
  if ($("donut-pct"))          $("donut-pct").textContent          = "0%";
  const arc = $("donut-arc");
  if (arc) { arc.style.strokeDashoffset = "201"; arc.style.stroke = "var(--accent)"; }

  $("product-dropdown")?.classList.remove("open");
  moveAvatarToQuizPanel();

  // === ANALYSE COMPORTEMENTALE ===
if (document.getElementById("ba-consent-toggle")) {
  _baConsent = document.getElementById("ba-consent-toggle").checked;
}

if (_baConsent) {
  if (!_ba) _ba = new BehavioralAnalyzer();
  _baEnabled = await _ba.init();
  
  if (_baEnabled) {
    _ba.onFrame((frame) => updateLiveFrame(frame));
    initBehavioralPanel(_ba.videoElement, _ba.overlayCanvas);

  }
}

  $("setup-screen").style.display    = "none";
  $("quiz-screen").style.display     = "flex";
  $("progress-header").style.display = "flex";
  $("score-badge").style.display     = "flex";
  showLoadingState();

  const selCount = state.selectedProducts.length;
  if (selCount === 1)    speak(`Je génère ${state.questionCount} questions sur ${state.selectedProducts[0]}…`);
  else if (selCount > 1) speak(`Je génère ${state.questionCount} questions sur ${selCount} produits sélectionnés…`);
  else                   speak("Je génère vos questions de formation, un moment…");

  startSSEStream();
}

function showLoadingState() {
  $("waiting-state").style.display = "flex";
  $("question-area").style.display = "none";
  $("load-progress").style.display = "flex";
  updateLoadBar(0, state.totalExpected);
}

// ── SSE Stream ────────────────────────────────────────────────────────────
function startSSEStream() {
  const body = { difficulty: state.difficulty, question_count: state.questionCount };
  if (state.selectedProducts.length > 0) body.products = state.selectedProducts;

  fetch(`${API_BASE}/quiz/generate/stream`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  })
  .then(res => {
    if (!res.ok) throw new Error(`Erreur serveur: ${res.status}`);
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = "";

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach(line => {
          if (line.startsWith("data: ")) {
            try { handleSSEEvent(JSON.parse(line.slice(6))); } catch(e) {}
          }
        });
        read();
      }).catch(err => {
        console.error("[Quiz] SSE error:", err);
        if (state.questions.length === 0) returnToSetup("Erreur de connexion au serveur.");
      });
    }
    read();
  })
  .catch(err => returnToSetup(`Impossible de contacter le serveur : ${err.message}`));
}

function handleSSEEvent(event) {
  if (event.type === "loading") {
    state.totalExpected = event.total || state.questionCount;
    updateLoadBar(0, state.totalExpected);
    $("waiting-state").querySelector(".waiting-text").textContent =
      `Dr. Layla génère ${state.totalExpected} questions…`;
  }

  if (event.type === "question") {
    state.questions.push(event.question);
    updateLoadBar(state.questions.length, event.total || state.totalExpected);
    if (state.questions.length === 1) {
      $("waiting-state").style.display = "none";
      $("question-area").style.display = "block";
      loadQuestion(0);
    }
  }

  if (event.type === "done") {
    state.streamDone    = true;
    state.generating    = false;
    state.totalExpected = event.count || state.questions.length;
    $("load-progress").style.display = "none";
    updateHeader();
    if (_waitingForNext) {
      _waitingForNext = false;
      const nextIdx = state.current + 1;
      if (nextIdx < state.questions.length) loadQuestion(nextIdx);
      else showResults();
    }
  }

  if (event.type === "error") {
    console.error("[Quiz] Erreur serveur:", event.message);
    if (state.questions.length === 0)
      returnToSetup(event.message || "Erreur lors de la génération des questions.");
  }
}

function updateLoadBar(loaded, total) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  if ($("load-fill"))  $("load-fill").style.width  = `${pct}%`;
  if ($("load-label")) $("load-label").textContent = `Questions prêtes : ${loaded} / ${total}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ANTI-BIAIS DE LONGUEUR — Fisher-Yates shuffle côté JS
// ══════════════════════════════════════════════════════════════════════════════

function reshuffleChoices(q) {
  const choices    = [...q.choices];
  const correctAns = choices[q.correct_index];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { ...q, choices, correct_index: choices.indexOf(correctAns) };
}

// ── Affichage d'une question ──────────────────────────────────────────────
function loadQuestion(idx) {
  if (idx >= state.questions.length) return;

  // stopSpeaking() EN PREMIER : incrémente _speakGeneration, annule _speakPendingTimer,
  // abort l'audio en cours → toute parole de la question précédente est stoppée.
  stopSpeaking();

  stopTimer();
if (_baEnabled && _ba) {
  _ba.startQuestion(idx);
  startTimer();
}

  if (_feedbackTyping) { _feedbackTyping.reset(); _feedbackTyping = null; }

  const saved = state.history[idx];
  if (!saved) state.questions[idx] = reshuffleChoices(state.questions[idx]);

  const q       = state.questions[idx];
  state.current  = idx;
  state.answered = false;
  updateHeader();

  $("q-number").textContent           = `Q${idx + 1}`;
  $("q-topic").textContent            = q.product || "Formation VITAL SA";
  $("q-difficulty-badge").textContent = state.difficulty.charAt(0).toUpperCase() + state.difficulty.slice(1);
  $("question-text").textContent      = q.question;

  const grid   = $("choices-grid");
  grid.innerHTML = "";
  const letters  = ["A", "B", "C", "D"];
  q.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.innerHTML = `
      <span class="choice-letter">${letters[i]}</span>
      <span class="choice-text">${choice}</span>
    `;
    btn.addEventListener("click", () => handleAnswer(i, q));
    grid.appendChild(btn);
  });

  $("explanation-box").style.display = "none";
  $("action-row").style.display      = "none";
  const fb = $("feedback-typing-box");
  if (fb) {
    fb.style.display = "none";
    $("feedback-typing-text").textContent = "";
    const cur = $("typing-cursor");
    if (cur) cur.style.display = "none";
  }

  const prevBtn = $("prev-btn");
  if (prevBtn) prevBtn.style.display = idx > 0 ? "inline-flex" : "none";

  if (saved) {
    state.answered = true;
    const buttons  = grid.querySelectorAll(".choice-btn");
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correct_index) btn.classList.add("correct");
    });
    const chosenIdx = q.choices.indexOf(saved.chosen);
    if (chosenIdx !== -1 && chosenIdx !== q.correct_index)
      buttons[chosenIdx].classList.add("wrong");

    $("explanation-icon").textContent    = saved.ok ? "✓" : "✗";
    $("explanation-icon").className      = `explanation-icon ${saved.ok ? "ok" : "bad"}`;
    $("explanation-verdict").textContent = saved.ok ? "Bonne réponse !" : "Réponse incorrecte";
    $("explanation-text").textContent    = saved.explanation || "";
    $("explanation-box").style.display   = "flex";

    const isLast = idx >= state.questions.length - 1 && state.streamDone;
    $("next-btn").innerHTML = isLast
      ? `Voir les résultats <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `Question suivante <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    $("action-row").style.display = "flex";
  }

  const panel = document.querySelector(".question-panel");
  if (panel) panel.scrollTop = 0;

  // Double garde : lie le speak à la génération ET à l'index de la question.
  // Navigation rapide (clics multiples "Suivant") : chaque loadQuestion() appelle
  // stopSpeaking() → génération++. Mais si speakWithAvatar démarre avant que
  // stopSpeaking() ait eu le temps d'agir, la vérification state.current !== speakIdx
  // garantit que seul le dernier loadQuestion() en date peut déclencher l'audio.
  const speakIdx = idx;
  const speakGen = _speakGeneration;
  if (_speakPendingTimer !== null) { clearTimeout(_speakPendingTimer); }
  // Libère le verrou ici — la question est déjà rendue dans le DOM.
  // Le speak peut encore être annulé par les gardes internes, mais l'UI
  // est prête → un nouveau clic Suivant/Précédent est accepté immédiatement.
  _navLocked = false;

  _speakPendingTimer = setTimeout(() => {
    _speakPendingTimer = null;
    if (speakGen !== _speakGeneration) return;  // invalide → navigation plus récente
    if (state.current  !== speakIdx)   return;  // invalide → une autre question a pris le relais
    _doSpeak(`Question ${speakIdx + 1} : ${q.question}`);
  }, 40);
}

function updateHeader() {
  const total = state.streamDone ? state.questions.length : state.totalExpected;
  if ($("q-counter"))
    $("q-counter").textContent = `Question ${state.current + 1} / ${total}`;
  if ($("progress-fill-mini"))
    $("progress-fill-mini").style.width = `${(state.current / Math.max(total, 1)) * 100}%`;
  if ($("score-live"))
    $("score-live").textContent = `${state.score} / ${state.current}`;
  updateDonut();
}

function updateDonut() {
  const total    = state.current;
  const pct      = total > 0 ? Math.round((state.score / total) * 100) : 0;
  const arc      = $("donut-arc");
  const donutPct = $("donut-pct");
  if (arc) {
    const circumference        = 201;
    arc.style.strokeDashoffset = circumference - (circumference * pct / 100);
    arc.style.stroke           = pct >= 70 ? "var(--accent)" : pct >= 40 ? "#f59e0b" : "#ef4444";
  }
  if (donutPct) donutPct.textContent = `${pct}%`;
}

// ── Réponse ───────────────────────────────────────────────────────────────
function handleAnswer(chosenIdx, q) {
  if (state.answered) return;
  state.answered = true;

  const correct = q.correct_index;
  const isOk    = chosenIdx === correct;

  stopTimer();
const baRecord = (_baEnabled && _ba) 
  ? _ba.captureAnswer(chosenIdx, isOk, q.question, q.product || "") 
  : null;

  if (isOk) state.score++;

  const buttons = $("choices-grid").querySelectorAll(".choice-btn");
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === correct)            btn.classList.add("correct");
    if (i === chosenIdx && !isOk) btn.classList.add("wrong");
  });

  state.history[state.current] = {
    question:    q.question,
    product:     q.product || "—",
    chosen:      q.choices[chosenIdx],
    correct:     q.choices[correct],
    ok:          isOk,
    explanation: q.explanation || "",
    behavioral: baRecord,
  };

  $("explanation-icon").textContent    = isOk ? "✓" : "✗";
  $("explanation-icon").className      = `explanation-icon ${isOk ? "ok" : "bad"}`;
  $("explanation-verdict").textContent = isOk ? "Bonne réponse !" : "Réponse incorrecte";
  $("explanation-text").textContent    = q.explanation || "Consultez la fiche produit pour plus de détails.";
  $("explanation-box").style.display   = "flex";

  if (!isOk) setTimeout(() => streamQuestionFeedback(q, chosenIdx), 400);

  const isLast  = state.current >= state.questions.length - 1 && state.streamDone;
  const nextBtn = $("next-btn");
  nextBtn.innerHTML = isLast
    ? `Voir les résultats <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `Question suivante <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  $("action-row").style.display = "flex";
  updateHeader();

  // stopSpeaking() avant speak() : coupe la lecture de la question en cours
  // (qui peut encore être dans son délai de 40ms) et interrompt tout audio actif.
  stopSpeaking();

  // Lie le speak de la correction à l'index courant :
  // si l'utilisateur clique immédiatement "Suivant" après avoir répondu,
  // stopSpeaking() sera appelé et ce timer sera annulé avant de tirer.
  const answerIdx = state.current;
  const answerGen = _speakGeneration;
  const answerText = isOk ? "Excellent ! Très bonne réponse." : `La bonne réponse était : ${q.choices[correct]}.`;
  if (_speakPendingTimer !== null) { clearTimeout(_speakPendingTimer); }
  _speakPendingTimer = setTimeout(() => {
    _speakPendingTimer = null;
    if (answerGen !== _speakGeneration) return;
    if (state.current  !== answerIdx)   return;
    _doSpeak(answerText);
  }, 40);
}

// ── Navigation ────────────────────────────────────────────────────────────
let _waitingForNext = false;

// ── Verrou de navigation ──────────────────────────────────────────────────
// Empêche les appels multiples quasi-simultanés à loadQuestion() lors d'un
// spam du bouton "Suivant". Le verrou dure 350ms — suffisant pour que
// stopSpeaking() + AudioContext.suspend() + le setTimeout(40ms) se terminent
// avant qu'un nouveau clic soit accepté.
let _navLocked = false;
function _lockNav(ms = 350) {
  _navLocked = true;
  setTimeout(() => { _navLocked = false; }, ms);
}

$("next-btn").addEventListener("click", goToNext);
$("prev-btn") && $("prev-btn").addEventListener("click", goToPrev);

function goToNext() {
  if (_navLocked) return;           // ← verrou anti-spam
  _lockNav(400);
  stopSpeaking();                   // ← stoppe TTS immédiatement
  if (_feedbackTyping) { _feedbackTyping.reset(); _feedbackTyping = null; }
  const nextIdx = state.current + 1;
  if (nextIdx < state.questions.length) { loadQuestion(nextIdx); return; }
  if (state.streamDone)                  { showResults(); return; }
  _waitingForNext           = true;
  $("next-btn").disabled    = true;
  $("next-btn").textContent = "Chargement…";
  const check = setInterval(() => {
    if (state.questions.length > nextIdx) {
      clearInterval(check);
      _waitingForNext        = false;
      $("next-btn").disabled = false;
      loadQuestion(nextIdx);
    } else if (state.streamDone) {
      clearInterval(check);
      _waitingForNext = false;
      showResults();
    }
  }, 200);
}

function goToPrev() {
  if (_navLocked) return;           // ← verrou anti-spam
  _lockNav(400);
  stopSpeaking();                   // ← stoppe TTS immédiatement
  stopTimer();
  if (_feedbackTyping) { _feedbackTyping.reset(); _feedbackTyping = null; }
  const prevIdx = state.current - 1;
  if (prevIdx < 0) return;
  const currentSaved = state.history[state.current];
  if (currentSaved?.ok) state.score = Math.max(0, state.score - 1);
  delete state.history[state.current];
  loadQuestion(prevIdx);
}

// ══════════════════════════════════════════════════════════════════════════════
// RÉSULTATS
// ══════════════════════════════════════════════════════════════════════════════

function showResults() {
  // ── 1. Arrêt immédiat de tout ce qui parle ─────────────────────
  stopSpeaking();
  if (_feedbackTyping) { _feedbackTyping.reset(); _feedbackTyping = null; }
  if (_finalTyping)    { _finalTyping.reset();    _finalTyping    = null; }

  // ── 2. Récupération du rapport AVANT destruction ──
  let behavioralReport = null;
  if (_baEnabled && _ba) {
    behavioralReport = _ba.getFullReport();
  }

  // ── 3. Fermeture du widget comportemental ───────────────────────
  if (_baEnabled && _ba) {
    _ba.destroy();
    _ba = null;
  }
  destroyPanel();

  // ── 4. Passage à l'écran résultats ───────────────────────────────
  moveAvatarToResults();

  $("quiz-screen").style.display     = "none";
  $("results-screen").style.display  = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display     = "none";

  const cleanHistory = state.history.filter(h => h !== undefined && h !== null);
  const total        = cleanHistory.length;
  const score        = cleanHistory.filter(h => h.ok).length;
  const pct          = total > 0 ? Math.round((score / total) * 100) : 0;

  state.score   = score;
  state.current = total;

  $("results-score-num").textContent   = score;
  $("results-score-denom").textContent = `/ ${total}`;

  let title, message;
  if      (pct >= 80) { title = "Excellent travail !"; message = `Vous maîtrisez très bien les produits VITAL SA. Score : ${pct}%`; }
  else if (pct >= 60) { title = "Bon résultat !";      message = `Vous avez une bonne connaissance des produits. Continuez à vous former. Score : ${pct}%`; }
  else                { title = "À revoir";            message = `Certains points méritent d'être approfondis. Relisez les fiches produits. Score : ${pct}%`; }

  $("results-title").textContent   = title;
  $("results-message").textContent = message;

  // Breakdown
  const breakdown = $("results-breakdown");
  breakdown.innerHTML = "";
  cleanHistory.forEach((item, i) => {
    const div = document.createElement("div");
    div.className = `result-item ${item.ok ? "correct" : "wrong"}`;
    div.innerHTML = `
      <div class="result-item-header">
        <span class="result-icon">${item.ok ? "✓" : "✗"}</span>
        <span class="result-product">${item.product}</span>
        <span class="result-qnum">Q${i + 1}</span>
      </div>
      <p class="result-question">${item.question}</p>
      ${!item.ok ? `
        <p class="result-wrong-answer">Votre réponse : <em>${item.chosen}</em></p>
        <p class="result-correct-answer">Bonne réponse : <strong>${item.correct}</strong></p>
      ` : ""}
      ${item.explanation ? `<p class="result-explanation">${item.explanation}</p>` : ""}
    `;
    breakdown.appendChild(div);
  });

  const ring = $("results-ring");
  if (ring) ring.style.borderColor = pct >= 70 ? "var(--accent)" : pct >= 40 ? "#f59e0b" : "#ef4444";

  speak(title + " " + message);

  // ── 5. Bilan comportemental par Dr. Layla (LLM) ─────────────────────
  const behavioralSummary = document.getElementById("behavioral-summary");
  const conclusionText    = document.getElementById("ba-conclusion-text");
  const farewell          = document.getElementById("farewell-message");

  if (behavioralSummary && conclusionText) {
    behavioralSummary.style.display = "block";
    conclusionText.textContent = "Dr. Layla analyse votre comportement...";

    // Appel asynchrone
    generateBehavioralConclusion(behavioralReport).then(conclusion => {
      conclusionText.textContent = conclusion;
    });
  }

  if (farewell) farewell.style.display = "block";

  // ── 6. Feedback final + Certificat + Sauvegarde ─────────────────────
  const certSection = $("certificate-section");
  if (certSection) certSection.style.display = pct >= 0 ? "block" : "none";

  if (total > 0) {
    setTimeout(() => streamFinalFeedback(cleanHistory, score, total), 400);
  } else {
    setTimeout(() => saveQuizResult([], 0, 0), 500);
  }
}

// ── Retour setup ──────────────────────────────────────────────────────────
function returnToSetup(msg) {
  $("quiz-screen").style.display     = "none";
  $("setup-screen").style.display    = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display     = "none";
  moveAvatarToSetup();
  if (msg) {
    const statusEl = $("status-text");
    if (statusEl) statusEl.textContent = msg;
    else alert(msg);
  }
}

// ── Bouton Recommencer ────────────────────────────────────────────────────
$("restart-btn").addEventListener("click", () => {
  // ══════════════════════════════════════════════════════════════════════
  // RÈGLE D'OR : stopSpeaking() EN PREMIER, AVANT TOUT.
  //
  // Cas critique : l'utilisateur clique "Recommencer" pendant que
  // speakFinalFeedback() est dans son délai de 40ms (onDone du typing
  // final vient de se déclencher). Sans ce stop en premier, speakWithAvatar()
  // se déclenche sur la page setup → parole fantôme.
  //
  // Avec ce stop : _speakGeneration++ + clearTimeout(_speakPendingTimer)
  // → le setTimeout de speakFinalFeedback() est annulé physiquement.
  // ══════════════════════════════════════════════════════════════════════
  stopSpeaking();
  if (_feedbackTyping) { _feedbackTyping.reset(); _feedbackTyping = null; }
  if (_finalTyping)    { _finalTyping.reset();    _finalTyping    = null; }

  state.questions     = [];
  state.current       = 0;
  state.score         = 0;
  state.answered      = false;
  state.history       = [];
  state.streamDone    = false;
  state.generating    = false;
  state.totalExpected = 10;

  if ($("score-live"))         $("score-live").textContent         = "0 / 0";
  if ($("donut-pct"))          $("donut-pct").textContent          = "0%";
  if ($("progress-fill-mini")) $("progress-fill-mini").style.width = "0%";
  const arc = $("donut-arc");
  if (arc) { arc.style.strokeDashoffset = "201"; arc.style.stroke = "var(--accent)"; }

  $("results-screen").style.display = "none";
  $("setup-screen").style.display   = "flex";
  moveAvatarToSetup();

  // 150ms : AudioContext se stabilise. _speakGeneration déjà incrémenté →
  // aucun TTS fantôme ne peut se déclencher pendant ce délai.
  setTimeout(() => {
    speak("Configurez votre quiz et commencez quand vous êtes prêt.");
  }, 150);


  if (_ba) {
    _ba.destroy();
    _ba = null;
  }
  destroyPanel();

});

// ── Utilitaires ───────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Feedback typing sur mauvaise réponse ─────────────────────────────────
async function streamQuestionFeedback(q, chosenIdx) {
  const box    = $("feedback-typing-box");
  const textEl = $("feedback-typing-text");
  const cursor = $("typing-cursor");
  if (!box || !textEl) return;

  if (_feedbackTyping) { _feedbackTyping.reset(); }
  _feedbackTyping = createTypingInstance();

  box.style.display     = "block";
  textEl.textContent    = "";
  _feedbackTyping.start(textEl, cursor);

  const inst = _feedbackTyping;

  let res;
  try {
    res = await fetch(`${API_BASE}/quiz/feedback/stream`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question:       q.question,
        correct_answer: q.choices[q.correct_index],
        chosen_answer:  q.choices[chosenIdx],
        product:        q.product || "",
        explanation:    q.explanation || "",
      }),
    });
  } catch {
    if (inst === _feedbackTyping) { box.style.display = "none"; _feedbackTyping = null; }
    return;
  }

  if (!res.ok) {
    if (inst === _feedbackTyping) { box.style.display = "none"; _feedbackTyping = null; }
    return;
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (inst !== _feedbackTyping) { reader.cancel(); return; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "token") inst.push(ev.content);
          if (ev.type === "done")  inst.finish();
        } catch(_) {}
      }
    }
    inst.finish();
  } catch { inst.finish(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// BILAN FINAL
// ══════════════════════════════════════════════════════════════════════════════

async function streamFinalFeedback(cleanHistory = [], score = 0, total = 0) {
  const section = $("final-feedback-section");
  const textEl  = $("final-feedback-text");
  if (!section || !textEl) { saveQuizResult(cleanHistory, score, total); return; }

  if (_finalTyping) { _finalTyping.reset(); }
  _finalTyping = createTypingInstance();

  section.style.display = "block";
  textEl.innerHTML      = "";

  const finalCursor     = document.createElement("span");
  finalCursor.className = "typing-cursor";
  textEl.appendChild(finalCursor);

  const textSpan = document.createElement("p");
  textSpan.style.cssText = "white-space: pre-wrap; margin: 0; line-height: 1.7;";
  textEl.insertBefore(textSpan, finalCursor);

  let fullText = "";
  const inst   = _finalTyping;

  inst.start(textSpan, finalCursor, () => {
    // ── CORRECTION CRITIQUE : speakFinalFeedback protégé par _speakGeneration
    // Ce callback onDone peut se déclencher après que l'utilisateur ait cliqué
    // "Recommencer". stopSpeaking() a déjà incrémenté _speakGeneration et
    // annulé _speakPendingTimer → speakFinalFeedback() capturera une génération
    // obsolète et n'appellera jamais speakWithAvatar(). Silence garanti.
    speakFinalFeedback(fullText);
    setTimeout(() => saveQuizResult(cleanHistory, score, total), 800);
  });

  let res;
  try {
    res = await fetch(`${API_BASE}/quiz/feedback/final/stream`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, total, history: cleanHistory }),
    });
  } catch {
    textEl.textContent = "Bilan indisponible.";
    setTimeout(() => saveQuizResult(cleanHistory, score, total), 500);
    return;
  }

  if (!res.ok) {
    textEl.textContent = "Bilan indisponible.";
    setTimeout(() => saveQuizResult(cleanHistory, score, total), 500);
    return;
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (inst !== _finalTyping) { reader.cancel(); return; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "token") { fullText += ev.content; inst.push(ev.content); }
          if (ev.type === "done")  inst.finish();
        } catch(_) {}
      }
    }
    inst.finish();
  } catch { inst.finish(); }
}

// ── Certificat de réussite ────────────────────────────────────────────────
async function downloadCertificate() {
  const cleanHistory = state.history.filter(h => h !== undefined && h !== null);
  const total        = cleanHistory.length;
  const score        = cleanHistory.filter(h => h.ok).length;
  const pct          = total > 0 ? Math.round((score / total) * 100) : 0;
  const today        = new Date().toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  const mastered     = [...new Set(cleanHistory.filter(h => h.ok).map(h => h.product))].join(", ") || "—";
 
  const logoSrc = await fetch("images/logo.png")
    .then(r => r.blob())
    .then(blob => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    }))
    .catch(() => "");
 
  let delegateName = "Délégué VITAL SA";
  try {
    const userJson = localStorage.getItem('user');
    if (userJson) {
      const user = JSON.parse(userJson);
      if (user.fullName) delegateName = user.fullName;
    }
  } catch(e) {}
 
  const mention = pct >= 80 ? "Mention Excellent" : pct >= 60 ? "Mention Bien" : "Mention Passable";
  const mentionColor = pct >= 80 ? "#70C7C6" : pct >= 60 ? "#7B9DD2" : "#BBB4DA";
 
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Certificat de Formation Médicale — VitalAgent</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Jost:wght@300;400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Jost',sans-serif;background:#F4F0E3;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:32px;gap:24px}
  .cert{background:#ffffff;width:780px;padding:0;border-radius:4px;position:relative;box-shadow:0 8px 48px rgba(123,157,210,0.18);overflow:hidden}
  .cert-top-bar{height:8px;background:linear-gradient(90deg,#DAD4DE,#BBB4DA,#7B9DD2,#70C7C6)}
  .cert-inner{padding:52px 64px 48px}
  .cert-border{position:absolute;inset:16px;border:1.5px solid rgba(187,180,218,0.4);border-radius:2px;pointer-events:none}
  /* Header */
  .cert-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid #DAD4DE;flex-wrap:nowrap;}
  .cert-logo{display:flex;align-items:center;gap:14px;flex-shrink:0;}
  .cert-logo img{width:64px;height:64px;object-fit:contain;flex-shrink:0;}
  .cert-logo-text{flex-shrink:0;}
  .cert-logo-text .name{font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:#2a2a3e;letter-spacing:.1em;text-transform:uppercase}
  .cert-logo-text .sub{font-size:10px;color:#9a96b0;letter-spacing:.2em;text-transform:uppercase;margin-top:2px}
  .cert-type{text-align:right;flex-shrink:0;}
  .cert-type .label{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9a96b0}
  .cert-type .value{font-size:13px;font-weight:500;color:#7B9DD2;margin-top:3px}
  /* Body */
  .cert-body{text-align:center;margin-bottom:36px}
  .cert-title-small{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#BBB4DA;margin-bottom:10px}
  .cert-title-big{font-family:'Playfair Display',serif;font-size:30px;font-weight:700;color:#2a2a3e;line-height:1.25;margin-bottom:20px}
  .cert-text{font-size:13.5px;color:#666;line-height:1.8;margin-bottom:6px}
  .cert-name{font-family:'Playfair Display',serif;font-size:26px;color:#2a2a3e;border-bottom:2px solid #7B9DD2;display:inline-block;padding:0 28px 6px;margin:8px 0 16px}
  .cert-sub-text{font-size:13px;color:#888;line-height:1.7}
  /* Score */
  .cert-score-row{display:flex;align-items:center;justify-content:center;gap:20px;margin:28px 0}
  .cert-score-box{background:linear-gradient(135deg,#F4F0E3,#DAD4DE);border:2px solid #BBB4DA;border-radius:12px;padding:20px 80px;text-align:center}
  .cert-score-num{font-family:'Playfair Display',serif;font-size:44px;font-weight:700;color:#7B9DD2;line-height:1}
  .cert-score-label{font-size:11px;color:#9a96b0;letter-spacing:.12em;text-transform:uppercase;margin-top:4px}
  .cert-score-detail{font-size:13px;font-weight:500;color:#2a2a3e;margin-top:3px}
  .cert-mention{margin-top:14px;border-radius:20px;padding:8px 22px;color:#fff;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;display:inline-block}
  /* Products */
  .cert-products{background:#F4F0E3;border:1px solid #DAD4DE;border-radius:8px;padding:13px 18px;font-size:12.5px;color:#666;margin-bottom:32px;text-align:left;line-height:1.6}
  .cert-products strong{color:#2a2a3e}
  /* Footer */
  .cert-footer{display:flex;justify-content:space-between;align-items:flex-end;padding-top:24px;border-top:1px solid #DAD4DE}
  .cert-sig{text-align:center}
  .sig-graphic{margin-bottom:8px;height:52px;display:flex;align-items:flex-end;justify-content:center}
  .sig-line{width:140px;height:1.5px;background:linear-gradient(90deg,transparent,#7B9DD2,transparent);margin:0 auto 6px}
  .sig-name{font-family:'Playfair Display',serif;font-size:13px;color:#2a2a3e}
  .sig-role{font-size:10px;color:#9a96b0;letter-spacing:.06em;margin-top:2px}
  .cert-stamp{display:flex;flex-direction:column;align-items:center;gap:4px}
  .stamp-circle{width:86px;height:86px;border-radius:50%;border:2.5px solid #BBB4DA;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(244,240,227,0.6);position:relative}
  .stamp-circle::before{content:'';position:absolute;inset:4px;border-radius:50%;border:1px dashed #DAD4DE}
  .stamp-inner{text-align:center;z-index:1}
  .stamp-logo{font-size:18px;line-height:1}
  .stamp-text{font-size:7px;letter-spacing:.15em;text-transform:uppercase;color:#7B9DD2;margin-top:2px;font-weight:500}
  .stamp-year{font-size:9px;color:#BBB4DA;margin-top:1px}
  .cert-date{font-size:11px;color:#9a96b0;text-align:right;line-height:1.8}
  .cert-date strong{color:#2a2a3e;display:block;font-size:12px}
  .cert-bottom{height:6px;background:linear-gradient(90deg,#70C7C6,#7B9DD2,#BBB4DA,#DAD4DE)}
  .wm{text-align:center;font-size:9px;color:#BBB4DA;letter-spacing:.18em;text-transform:uppercase;padding:10px 0 4px}
  @media print{body{background:#fff;padding:0}.cert{box-shadow:none}.no-print{display:none}}
</style>
</head>
<body>
<div class="cert">
  <div class="cert-top-bar"></div>
  <div class="cert-border"></div>
  <div class="cert-inner">
    <!-- Header -->
    <div class="cert-header">
      <div class="cert-logo">
        <img src="${logoSrc}" alt="VITAL Laboratoires" style="width:64px;height:64px;object-fit:contain;"/>
        <div class="cert-logo-text">
          <div class="name">VITAL SA</div>
          <div class="sub">Formation Médicale</div>
        </div>
      </div>
      <div class="cert-type">
        <div class="label">Type de certification</div>
        <div class="value">Quiz Délégué Médical</div>
      </div>
    </div>
    <!-- Body -->
    <div class="cert-body">
      <div class="cert-title-small">Certificat de réussite</div>
      <div class="cert-title-big">Formation Médicale<br>VitalAgent</div>
      <div class="cert-text">Ce certificat atteste que le délégué</div>
      <div class="cert-name">${delegateName}</div>
      <div class="cert-sub-text">a validé avec succès le quiz de formation médicale VITAL SA<br>et démontre une maîtrise des connaissances produits pharmaceutiques.</div>
    </div>
    <!-- Score -->
    <div class="cert-score-row">
      <div class="cert-score-box">
        <div class="cert-score-num">${pct}%</div>
        <div class="cert-score-label">Score obtenu</div>
        <div class="cert-score-detail">${score} / ${total} questions réussies</div>
        <div class="cert-mention" style="background:linear-gradient(135deg,${mentionColor},#70C7C6)">${mention}</div>
      </div>
    </div>
    <!-- Products -->
    <div class="cert-products">
      <strong>Produits maîtrisés :</strong> ${mastered}
    </div>
    <!-- Footer -->
    <div class="cert-footer">
      <div class="cert-sig">
        <div class="sig-graphic">
          <svg width="140" height="48" viewBox="0 0 140 48" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity:.85">
            <path d="M8 38 C20 10, 30 42, 45 28 C55 18, 60 36, 75 24 C85 15, 92 38, 110 30 C120 25, 128 32, 135 28" stroke="#7B9DD2" stroke-width="2" stroke-linecap="round" fill="none"/>
            <path d="M40 40 C50 35, 55 44, 65 40" stroke="#70C7C6" stroke-width="1.5" stroke-linecap="round" fill="none"/>
          </svg>
        </div>
        <div class="sig-line"></div>
        <div class="sig-name">Dr. Layla</div>
        <div class="sig-role">Experte Formation Médicale · VitalAgent</div>
      </div>
      <div class="cert-stamp">
        <div class="stamp-circle">
          <div class="stamp-inner">
            <div class="stamp-logo">🍀</div>
            <div class="stamp-text">VITAL SA</div>
            <div class="stamp-year">Certifié</div>
          </div>
        </div>
      </div>
      <div class="cert-date">
        <strong>Délivré le</strong>
        ${today}<br>
        <span style="font-size:9px;color:#BBB4DA">VitalAgent — VITAL SA Formation</span>
      </div>
    </div>
  </div>
  <div class="wm">VITAL SA · Formation Médicale · Certifié VitalAgent</div>
  <div class="cert-bottom"></div>
</div>
<div class="no-print">
  <button onclick="window.print()" style="padding:12px 32px;background:linear-gradient(135deg,#7B9DD2,#70C7C6);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;box-shadow:0 4px 16px rgba(123,157,210,0.3)">🖨️ Imprimer / Enregistrer en PDF</button>
</div>
</body>
</html>`;
 
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = "certificat-formation-medicale-vitalagent.html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════════════════════
// SAVE RESULT
// ══════════════════════════════════════════════════════════════════════════════

async function saveQuizResult(cleanHistory = [], score = 0, total = 0) {
  if (total === 0) { console.warn("[QuizSave] Historique vide, rien à enregistrer."); return; }

  const percentage = Math.round((score / total) * 100);

  const feedbackEl = document.getElementById("final-feedback-text");
  let feedbackTxt  = null;
  if (feedbackEl) {
    const raw = (feedbackEl.innerText || feedbackEl.textContent || "").trim();
    if (raw && !raw.includes("rédige votre bilan")) feedbackTxt = raw;
  }

  const payload = {
    quiz_type:         "medical",
    score,
    total_questions:   total,
    percentage,
    feedback:          feedbackTxt,
    difficulty:        state.difficulty || "moyen",
    products_selected: state.selectedProducts.length > 0
                         ? JSON.stringify(state.selectedProducts)
                         : null,
    id_user: null,
  };

  console.log("[QuizSave] payload →", payload);

  try {
    const res = await fetch(`${API_BASE}/quizsave/save-result`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      console.log("✅ Résultat enregistré — id DB :", data.id);
    } else {
      let detail = `HTTP ${res.status}`;
      try { const b = await res.json(); detail += " — " + (b.detail || JSON.stringify(b)); } catch(_) {}
      console.error("❌ saveQuizResult erreur serveur :", detail);
    }
  } catch (err) {
    console.error("❌ saveQuizResult erreur réseau :", err);
  }
}


/*******/
// ── Génération du bilan comportemental par LLM ─────────────────────────────
async function generateBehavioralConclusion(report) {
  if (!report) {
    return "Aucune donnée comportementale disponible pour cette session.";
  }

  const payload = {
    avg_confidence: Math.round((report.avgConf || 0) * 100),
    avg_stress:     Math.round((report.avgStress || 0) * 100),
    avg_fidget:     Math.round((report.avgFidget || 0) * 100),
    gaze_away_rate: Math.round((report.gazeAwayRate || 0) * 100),
    hesitation_rate: Math.round((report.hesitationRate || 0) * 100),
    dominant_expression: report.dominantExpression || "neutral",
    dominant_posture: report.dominantPosture || "normal",
    top_signals: report.topStressSignals ? report.topStressSignals.map(s => s.label) : []
  };

  console.log("📤 Envoi au LLM →", payload);

  try {
    const res = await fetch(`${API_BASE}/quiz/behavioral-conclusion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error(`❌ HTTP ${res.status} sur behavioral-conclusion`);
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log("✅ Réponse LLM :", data.conclusion);
    return data.conclusion;
  } catch (e) {
    console.error("❌ Échec appel LLM comportemental :", e);
    return getLocalBehavioralConclusion(payload);
  }
}

// Fallback local (au cas où)
function getLocalBehavioralConclusion(data) {
  if (data.avg_stress > 55) return "Vous sembliez légèrement tendu. Essayez de respirer calmement avant de répondre.";
  if (data.gaze_away_rate > 40) return "Vous avez parfois détourné le regard. Restez concentré sur l'écran pendant les questions.";
  if (data.avg_confidence > 75) return "Excellente concentration et confiance tout au long du quiz !";
  if (data.hesitation_rate > 50) return "Vous avez bien pris le temps de réfléchir, ce qui montre une bonne démarche de raisonnement.";
  return "Votre attention et votre posture étaient bonnes durant cette session de formation.";
}

window.downloadCertificate = downloadCertificate;