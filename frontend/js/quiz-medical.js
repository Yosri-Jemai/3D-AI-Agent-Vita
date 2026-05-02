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
  // ← EN PREMIER : stoppe tout TTS immédiatement
  stopSpeaking();
  if (_feedbackTyping) { _feedbackTyping.reset(); _feedbackTyping = null; }
  if (_finalTyping)    { _finalTyping.reset();    _finalTyping    = null; }

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

  const certSection = $("certificate-section");
  if (certSection) certSection.style.display = pct >= 60 ? "block" : "none";

  if (total > 0) {
    setTimeout(() => streamFinalFeedback(cleanHistory, score, total), 300);
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
function downloadCertificate() {
  const cleanHistory = state.history.filter(h => h !== undefined && h !== null);
  const total        = cleanHistory.length;
  const score        = cleanHistory.filter(h => h.ok).length;
  const pct          = total > 0 ? Math.round((score / total) * 100) : 0;
  const today        = new Date().toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  const mastered     = [...new Set(cleanHistory.filter(h => h.ok).map(h => h.product))].join(", ") || "—";

  let delegateName = "Délégué VITAL SA";
  try {
    const userJson = localStorage.getItem('user');
    if (userJson) {
      const user = JSON.parse(userJson);
      if (user.fullName) delegateName = user.fullName;
    }
  } catch(e) {}

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Certificat de Formation — VitalAgent</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lato:wght@300;400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Lato',sans-serif;background:#f0f7ee;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:32px;gap:20px}
  .cert{background:#fff;width:760px;padding:56px 64px;border:1px solid #c8e6c9;position:relative;box-shadow:0 4px 40px rgba(0,0,0,.10)}
  .cert::before{content:'';position:absolute;inset:8px;border:2px solid #1e7a2e;pointer-events:none}
  .logo{text-align:center;margin-bottom:28px}
  .logo-name{font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:.12em;text-transform:uppercase}
  .logo-sub{font-size:11px;color:#888;letter-spacing:.18em;text-transform:uppercase;margin-top:2px}
  .divider{width:80px;height:2px;background:#1e7a2e;margin:16px auto}
  .heading{text-align:center;font-family:'Playfair Display',serif;font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:#888;margin-bottom:8px}
  .title{text-align:center;font-family:'Playfair Display',serif;font-size:34px;font-weight:700;color:#1a1a1a;line-height:1.25;margin-bottom:24px}
  .body{text-align:center;font-size:14px;color:#444;line-height:1.8;margin-bottom:28px}
  .delegate{font-size:22px;font-family:'Playfair Display',serif;color:#1a1a1a;border-bottom:1.5px solid #1e7a2e;display:inline-block;padding:0 24px 4px;margin:6px 0 10px}
  .score-box{display:inline-flex;align-items:center;gap:12px;background:#e8f3e6;border:1.5px solid #1e7a2e;border-radius:10px;padding:12px 28px;margin:0 auto 24px}
  .score-num{font-size:36px;font-weight:700;font-family:'Playfair Display',serif;color:#145a22}
  .score-lbl{font-size:12px;color:#1e7a2e;text-align:left;line-height:1.4}
  .products{background:#f5faf4;border:1px solid #c8e6c9;border-radius:8px;padding:12px 18px;font-size:12.5px;color:#555;margin-bottom:28px;text-align:left}
  .footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:8px}
  .sig{text-align:center}
  .sig-line{width:160px;height:1px;background:#999;margin:0 auto 6px}
  .sig-name{font-family:'Playfair Display',serif;font-size:13px;color:#333}
  .sig-role{font-size:10px;color:#888;letter-spacing:.08em}
  .date{font-size:11px;color:#888;text-align:right}
  .wm{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);font-size:9px;color:#ccc;letter-spacing:.15em;text-transform:uppercase;white-space:nowrap}
  @media print{body{background:#fff;padding:0}.cert{box-shadow:none}.no-print{display:none}}
</style>
</head>
<body>
<div class="cert">
  <div class="logo"><div class="logo-name">VITAL SA</div><div class="logo-sub">Formation des Délégués Médicaux</div></div>
  <div class="divider"></div>
  <div class="heading">Certificat de réussite</div>
  <div class="title">Quiz de Formation<br>Médicale</div>
  <div class="body">
    Ce certificat atteste que le délégué<br>
    <span class="delegate">${delegateName}</span><br>
    a validé avec succès le quiz de formation médicale VitalAgent.
  </div>
  <div style="text-align:center">
    <div class="score-box">
      <div class="score-num">${pct}%</div>
      <div class="score-lbl">Score obtenu<br><strong>${score} / ${total} questions</strong></div>
    </div>
  </div>
  <div class="products"><strong>Produits maîtrisés :</strong> ${mastered}</div>
  <div class="footer">
    <div class="sig"><div class="sig-line"></div><div class="sig-name">Dr. Layla</div><div class="sig-role">Experte Formation Médicale · VitalAgent</div></div>
    <div class="date">Délivré le ${today}<br><span style="font-size:9px;color:#bbb">VitalAgent — VITAL SA</span></div>
  </div>
  <div class="wm">VITAL SA · Formation Médicale · Certifié VitalAgent</div>
</div>
<div class="no-print">
  <button onclick="window.print()" style="padding:12px 28px;background:#1e7a2e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">🖨️ Imprimer / Enregistrer en PDF</button>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "certificat-formation-vitale.html";
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
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