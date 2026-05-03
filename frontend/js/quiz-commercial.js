// ═══════════════════════════════════════════════════════════════════════════
// quiz-commercial.js — Quiz Délégué Commercial · VitalAgent
// Logique quiz identique à l'original + comportements avatar/TTS/TypingEngine
// portés depuis quiz-medical.js
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE = window.API_BASE || "http://localhost:8000";

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
};

let allProducts = [];

const $ = id => document.getElementById(id);

// ══════════════════════════════════════════════════════════════════════════
// TYPING ENGINE — moteur d'animation de texte unifié (porté depuis quiz-medical)
// ══════════════════════════════════════════════════════════════════════════
const TypingEngine = {
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

  push(text) {
    this.queue += text;
  },

  finish() {
    this._sealed = true;
  },

  reset() {
    clearTimeout(this.timer);
    this.timer   = null;
    this.queue   = "";
    this.element = null;
    this._sealed = false;
    if (this.cursor) this.cursor.style.display = "none";
    this.cursor  = null;
    this.onDone  = null;
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

// ══════════════════════════════════════════════════════════════════════════
// AVATAR — gestion affichage & déplacement (porté depuis quiz-medical)
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
// TTS / PAROLE (porté depuis quiz-medical)
// ══════════════════════════════════════════════════════════════════════════

function speak(text) {
  const el = $("bubble-text");
  if (el) {
    el.style.opacity = "0";
    setTimeout(() => { el.textContent = text; el.style.opacity = "1"; }, 150);
  }
  if (typeof window.speakWithAvatar === "function" && text?.trim()) {
    window.speakWithAvatar(text, "fr");
  }
}

function speakFinalFeedback(text) {
  if (typeof window.speakWithAvatar === "function" && text?.trim()) {
    window.speakWithAvatar(text, "fr");
  }
}

function stopSpeaking() {
  if (window._head && typeof window._head.stopSpeaking === "function") {
    window._head.stopSpeaking();
  }
  if (window._head?.audioCtx) {
    try { window._head.audioCtx.suspend(); window._head.audioCtx.resume(); } catch (e) {}
  }
}

// ── Attente de l'avatar prêt ───────────────────────────────────────────
function waitForAvatar(callback) {
  const iv = setInterval(() => {
    if (window._avatarReady === true) {
      clearInterval(iv);
      callback();
    }
  }, 200);
  setTimeout(() => { clearInterval(iv); callback(); }, 12000);
}

// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  loadProducts();
  setupProductSearch();
  waitForAvatar(() => {
    speak("Bonjour ! Je suis Vita, votre coach commercial. Configurez votre quiz et commencez quand vous êtes prêt.");
    const ld = $("avatar-loading");
    if (ld) ld.style.display = "none";
  });
});

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
    $("product-list").innerHTML = `<div>Erreur chargement produits</div>`;
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
      <span>${escHtml(name)}</span>
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
  if (count === 0)      label.textContent = "Tous les produits";
  else if (count === 1) label.textContent = state.selectedProducts[0];
  else                  label.textContent = `${count} produits sélectionnés`;
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
  });
});

document.querySelectorAll(".qc-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".qc-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.questionCount = parseInt(btn.dataset.count);
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

  $("product-dropdown")?.classList.remove("open");
  moveAvatarToQuizPanel();

  $("setup-screen").style.display    = "none";
  $("quiz-screen").style.display     = "flex";
  $("progress-header").style.display = "flex";
  $("score-badge").style.display     = "flex";

  showLoadingState();

  const selCount = state.selectedProducts.length;
  if (selCount === 1)    speak(`Je génère ${state.questionCount} scénarios sur ${state.selectedProducts[0]}…`);
  else if (selCount > 1) speak(`Je génère ${state.questionCount} scénarios sur ${selCount} produits…`);
  else                   speak("Je prépare vos scénarios de vente, un moment…");

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
    }),
  })
  .then(res => {
    if (!res.ok) throw new Error(`Erreur serveur: ${res.status}`);
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = "";

    function pump() {
      reader.read().then(({ done, value }) => {
        if (done) {
          state.streamDone  = true;
          state.generating  = false;
          checkAutoStart();
          return;
        }
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
        if (state.questions.length === 0) returnToSetup("Erreur de connexion au serveur.");
        else checkAutoStart();
      });
    }
    pump();
  })
  .catch(err => returnToSetup(`Impossible de contacter le serveur : ${err.message}`));
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
    setTimeout(() => {
      const lp = $("load-progress");
      if (lp) lp.style.display = "none";
    }, 1500);
    updateHeader();
  }
}

function updateLoadBar(loaded, total) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  if ($("load-fill"))  $("load-fill").style.width    = `${pct}%`;
  if ($("load-label")) $("load-label").textContent   = `Scénarios prêts : ${loaded} / ${total}`;
}

// ══════════════════════════════════════════════════════════════════════════
// AFFICHAGE D'UNE QUESTION
// ══════════════════════════════════════════════════════════════════════════

function loadQuestion(idx) {
  if (idx >= state.questions.length) return;

  stopSpeaking();
  TypingEngine.reset();

  const q = state.questions[idx];
  state.current  = idx;
  state.answered = false;
  updateHeader();

  $("q-number").textContent = `Q${idx + 1}`;
  $("q-topic").textContent  = q.product || "Formation VITAL SA";

  const levelLabels = { facile: "Débutant", moyen: "Confirmé", difficile: "Expert" };
  $("q-difficulty-badge").textContent = levelLabels[state.difficulty] || state.difficulty;

  // Badge compétence commerciale
  const skillBadge = $("sales-skill-badge");
  const skillText  = $("sales-skill-text");
  if (skillBadge && skillText && q.sales_skill) {
    skillText.textContent    = q.sales_skill;
    skillBadge.style.display = "inline-flex";
  } else if (skillBadge) {
    skillBadge.style.display = "none";
  }

  $("question-text").textContent = q.question;

  const grid    = $("choices-grid");
  grid.innerHTML = "";
  const letters  = ["A", "B", "C", "D"];
  q.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.innerHTML = `
      <span class="choice-letter">${letters[i]}</span>
      <span class="choice-text">${escHtml(choice)}</span>    `;
    btn.addEventListener("click", () => handleAnswer(i, q));
    grid.appendChild(btn);
  });

  $("explanation-box").style.display = "none";
  $("action-row").style.display      = "none";
  $("llm-feedback-container").innerHTML = "";

  // Bouton précédent
  const prevBtn = $("prev-btn");
  if (prevBtn) prevBtn.style.display = idx > 0 ? "inline-flex" : "none";

  // Restaurer état si déjà répondu (navigation arrière)
  const saved = state.history[idx];
  if (saved) {
    state.answered = true;
    const buttons = grid.querySelectorAll(".choice-btn");
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correct_index) btn.classList.add("correct");
    });
    const chosenIdx = q.choices.indexOf(saved.chosen);
    if (chosenIdx !== -1 && chosenIdx !== q.correct_index) {
      buttons[chosenIdx].classList.add("wrong");
    }
    $("explanation-icon").textContent    = saved.ok ? "✓" : "✗";
    $("explanation-icon").className      = `explanation-icon ${saved.ok ? "ok" : "bad"}`;
    $("explanation-verdict").textContent = saved.ok ? "Excellente approche !" : "Voici la meilleure approche :";
    $("explanation-text").textContent    = saved.explanation || "";
    $("explanation-box").style.display   = "flex";

    const isLast = idx >= state.questions.length - 1 && state.streamDone;
    $("next-btn").innerHTML = isLast ? "Voir mes résultats →" : "Scénario suivant →";
    $("action-row").style.display = "flex";
  }

  const panel = document.querySelector(".question-panel");
  if (panel) panel.scrollTop = 0;

  speak(`Scénario ${idx + 1} : ${q.question}`);
}

function updateHeader() {
  const total = state.streamDone ? state.questions.length : state.totalExpected;
  if ($("q-counter"))
    $("q-counter").textContent = `Question ${state.current + 1} / ${total}`;
  if ($("progress-fill-mini"))
    $("progress-fill-mini").style.width = `${((state.current) / Math.max(total, 1)) * 100}%`;
  if ($("score-live"))
    $("score-live").textContent = `${state.score} / ${state.current}`;
  updateDonut();
}

function updateDonut() {
  const total = state.current;
  const pct   = total > 0 ? Math.round((state.score / total) * 100) : 0;
  const arc   = $("donut-arc");
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

async function handleAnswer(chosenIdx, q) {
  if (state.answered) return;
  state.answered = true;

  const isOk = chosenIdx === q.correct_index;
  if (isOk) state.score++;

  const buttons = $("choices-grid").querySelectorAll(".choice-btn");
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.correct_index)            btn.classList.add("correct");
    if (i === chosenIdx && !isOk)         btn.classList.add("wrong");
  });

  // Historique (stocké par index pour permettre navigation arrière cohérente)
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
  $("explanation-verdict").textContent = isOk ? "Excellente approche !" : "Voici la meilleure approche :";
  $("explanation-text").textContent    = q.explanation || "Consultez les guides de vente pour plus de détails.";
  $("explanation-box").style.display   = "flex";

  const isLast = state.current >= state.questions.length - 1 && state.streamDone;
  $("next-btn").innerHTML = isLast ? "Voir mes résultats →" : "Scénario suivant →";
  $("action-row").style.display = "flex";

  updateHeader();

  if (isOk) {
    speak("Parfait ! Excellente approche commerciale.");
  } else {
    speak(`La meilleure approche était : ${q.choices[q.correct_index]}`);
  }

  // Feedback LLM streamé avec TypingEngine (comme quiz-medical pour les mauvaises réponses,
  // mais ici on le fait pour toutes les réponses comme dans la version originale)
  await streamLLMFeedback(q, chosenIdx, q.correct_index, isOk);
}

// ══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════

let _waitingForNext = false;

$("next-btn").addEventListener("click", goToNext);
$("prev-btn")?.addEventListener("click", goToPrev);

function goToNext() {
  stopSpeaking();

  const nextIdx = state.current + 1;
  if (nextIdx < state.questions.length) { loadQuestion(nextIdx); return; }
  if (state.streamDone)                 { showResults(); return; }

  _waitingForNext = true;
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
  stopSpeaking();

  const prevIdx = state.current - 1;
  if (prevIdx < 0) return;

  // Annuler la contribution au score de la question courante
  const currentSaved = state.history[state.current];
  if (currentSaved && currentSaved.ok) {
    state.score = Math.max(0, state.score - 1);
  }
  delete state.history[state.current];

  loadQuestion(prevIdx);
}

// ══════════════════════════════════════════════════════════════════════════
// FEEDBACK LLM streamé avec TypingEngine (remplace l'animation char-par-char originale)
// ══════════════════════════════════════════════════════════════════════════

async function streamLLMFeedback(q, chosenIdx, correctIdx, isOk) {
  const container = $("llm-feedback-container");
  if (!container) return;

  // Créer la bulle avec un span pour le texte et un curseur
  container.innerHTML = `
    <div class="llm-feedback-wrap">
      <div class="llm-feedback-bubble ${isOk ? "correct" : "wrong"}">
        <div class="llm-feedback-avatar">🎯</div>
        <div class="llm-feedback-text">
          <span id="llm-stream-text"></span><span class="typing-cursor" id="llm-typing-cursor" style="display:none"></span>
        </div>
      </div>
    </div>
  `;

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
      }),
    });
  } catch (err) {
    console.warn("[Quiz Commercial] feedback fetch error:", err);
    container.innerHTML = "";
    TypingEngine.reset();
    return;
  }

  if (!res.ok) { container.innerHTML = ""; TypingEngine.reset(); return; }

  // Le endpoint /quiz-commercial/feedback retourne du JSON (non-stream dans l'original).
  // On supporte les deux cas : JSON classique et SSE stream.
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    // Mode SSE stream
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
            if (ev.type === "token") TypingEngine.push(ev.content);
            if (ev.type === "done")  TypingEngine.finish();
          } catch (_) {}
        }
      }
      TypingEngine.finish();
    } catch (err) {
      TypingEngine.finish();
    }
  } else {
    // Mode JSON classique (comportement original)
    try {
      const data = await res.json();
      const text = data.text || "";
      // On injecte tout le texte d'un coup dans le moteur pour l'animation
      TypingEngine.push(text);
      TypingEngine.finish();
    } catch (err) {
      TypingEngine.finish();
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// RÉSULTATS
// ══════════════════════════════════════════════════════════════════════════

function showResults() {
  stopSpeaking();
  moveAvatarToResults();

  $("quiz-screen").style.display     = "none";
  $("results-screen").style.display  = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display     = "none";

  const total = state.history.filter(Boolean).length;
  const pct   = total ? Math.round((state.score / total) * 100) : 0;

  $("results-score-num").textContent   = state.score;
  $("results-score-denom").textContent = `/ ${total}`;

  let title = pct >= 80 ? "Top vendeur ! 🏆" : pct >= 60 ? "Bon commercial ! 👍" : "À renforcer 📚";
  $("results-title").textContent   = title;
  $("results-message").textContent = `Score : ${pct}% · ${state.score}/${total} correctes`;

  // Résumé par compétence commerciale
  const skillsContainer = $("skills-summary");
  if (skillsContainer) {
    const skillCounts = {}, skillOk = {};
    state.history.filter(Boolean).forEach(item => {
      const s = item.sales_skill || "Autre";
      skillCounts[s] = (skillCounts[s] || 0) + 1;
      skillOk[s]     = (skillOk[s]     || 0) + (item.ok ? 1 : 0);
    });
    skillsContainer.innerHTML = "";
    Object.entries(skillCounts).forEach(([skill, count]) => {
      const ok  = skillOk[skill] || 0;
      const sp  = Math.round((ok / count) * 100);
      const el  = document.createElement("span");
      el.className = "sales-skill-badge";
      el.style.borderColor = sp >= 70 ? "rgba(16,185,129,0.5)" : "rgba(245,158,11,0.4)";
      el.style.color       = sp >= 70 ? "#10b981" : "#f59e0b";
      el.innerHTML = `${skill} <strong>${sp}%</strong>`;
      skillsContainer.appendChild(el);
    });
  }

  // Détail des réponses
  const breakdown = $("results-breakdown");
  breakdown.innerHTML = "";
  state.history.filter(Boolean).forEach((item, i) => {
    const div = document.createElement("div");
    div.className = `result-item ${item.ok ? "correct" : "wrong"}`;
    div.innerHTML = `
      <div><span>${item.ok ? "✓" : "✗"}</span> <strong>${item.product}</strong> <span style="float:right">Q${i + 1}</span></div>
      <p>${item.question}</p>
      ${!item.ok ? `
        <p style="color:#ef4444">Votre réponse : ${item.chosen}</p>
        <p style="color:#10b981">Meilleure approche : ${item.correct}</p>
      ` : ""}
      ${item.explanation ? `<p>${item.explanation}</p>` : ""}
    `;
    breakdown.appendChild(div);
  });

  const ring = $("results-ring");
  if (ring) {
    ring.style.borderColor = pct >= 70 ? "#867416" : pct >= 40 ? "#bea74b" : "#ef4444";
  }

  // Certificat
  const certSection = $("certificate-section");
  if (certSection) {
    certSection.style.display = pct >= 0 ? "block" : "none";
  }

  speak(title);

// ── Bilan final + Enregistrement automatique ─────────────────────────────
if (total > 0) {
  // On lance le bilan final (qui va écrire le texte progressivement)
  setTimeout(() => streamFinalVerdict(), 400);
} else {
  // Si pas de questions (cas rare), on enregistre directement
  setTimeout(saveQuizResult, 500);
}

}

// ── Bilan final streamé avec TypingEngine ────────────────────────────────
// ── Bilan final Vita (identique au quiz médical) ─────────────────────────────
async function streamFinalVerdict() {
    const section = $("final-feedback-section");
    const textEl = $("final-feedback-text");
    if (!section || !textEl) return;
  
    TypingEngine.reset();
    section.style.display = "block";
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
    });
  
    const originalFetch = () => fetch(`${API_BASE}/quiz/feedback/final/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score: state.score,
        total: state.history.filter(Boolean).length,
        history: state.history.filter(Boolean),
      }),
    });
  
    let res;
    try { res = await originalFetch(); } catch (err) {
      textEl.textContent = "Bilan indisponible.";
      return;
    }
    if (!res.ok) {
      textEl.textContent = "Bilan indisponible.";
      return;
    }
  
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
  
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
            if (ev.type === "token") {
              fullText += ev.content;
              TypingEngine.push(ev.content);
            }
            if (ev.type === "done") TypingEngine.finish();
          } catch (_) {}
        }
      }
      TypingEngine.finish();
    } catch (err) {
      TypingEngine.finish();
    }
  }

// ══════════════════════════════════════════════════════════════════════════
// RETOUR SETUP
// ══════════════════════════════════════════════════════════════════════════

function returnToSetup(msg) {
  $("quiz-screen").style.display     = "none";
  $("setup-screen").style.display    = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display     = "none";
  moveAvatarToSetup();
  if (msg && $("status-text")) $("status-text").textContent = msg;
}

$("restart-btn")?.addEventListener("click", () => {
  stopSpeaking();
  $("results-screen").style.display = "none";
  $("setup-screen").style.display   = "flex";
  moveAvatarToSetup();
  speak("Recommencez quand vous êtes prêt !");
});

// ══════════════════════════════════════════════════════════════════════════
// CERTIFICAT
// ══════════════════════════════════════════════════════════════════════════

function openCertificate() {
  drawCertificate();
  $("cert-overlay").classList.add("open");
}

function closeCert() {
  $("cert-overlay").classList.remove("open");
}

function closeCertOnBg(e) {
  if (e.target === $("cert-overlay")) closeCert();
}

function drawCertificate() {
  const canvas = $("cert-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = 620, H = 440;
  const total = state.history.filter(Boolean).length;
  const pct   = total ? Math.round((state.score / total) * 100) : 0;
  const level = { facile: "Débutant", moyen: "Confirmé", difficile: "Expert" }[state.difficulty] || state.difficulty;
  const now   = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1a1600");
  bg.addColorStop(1, "#2a2000");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(134,116,22,0.8)";
  ctx.lineWidth = 2;
  roundRect(ctx, 12, 12, W - 24, H - 24, 14);
  ctx.stroke();

  ctx.fillStyle = "#bea74b";
  ctx.font = "bold 28px serif";
  ctx.textAlign = "center";
  ctx.fillText("VITAL SA", W / 2, 68);

  ctx.font = "500 11px 'Jost', sans-serif";
  ctx.fillStyle = "rgba(190,167,75,0.75)";
  ctx.fillText("FORMATION COMMERCIALE", W / 2, 86);

  ctx.font = "italic bold 22px 'DM Serif Display'";
  ctx.fillStyle = "#f8de7e";
  ctx.fillText("Certificat de Compétence Commerciale", W / 2, 136);

  ctx.font = "300 12px 'Jost'";
  ctx.fillStyle = "rgba(248,222,126,0.6)";
  ctx.fillText("est décerné pour la réussite du quiz de formation vente VITAL SA", W / 2, 162);

  ctx.beginPath();
  ctx.arc(W / 2, 230, 50, 0, Math.PI * 2);
  ctx.fillStyle = "#2a2000";
  ctx.fill();
  ctx.strokeStyle = "#bea74b";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#f8de7e";
  ctx.font = "bold 28px 'Jost'";
  ctx.fillText(`${pct}%`, W / 2, 245);

  ctx.font = "500 10px 'Jost'";
  ctx.fillStyle = "rgba(254,238,184,0.6)";
  ctx.fillText("SCORE", W / 2, 265);

  ctx.font = "500 12px 'Jost'";
  ctx.fillStyle = "#feeeb8";
  ctx.fillText(`Niveau: ${level}`, W / 2 - 120, 310);
  ctx.fillText(`Questions: ${state.score}/${total}`, W / 2, 310);
  ctx.fillText(`Produit: ${state.selectedProducts[0] || "Tous"}`, W / 2 + 120, 310);

  ctx.font = "italic 13px 'DM Serif Display'";
  ctx.fillStyle = "#bea74b";
  ctx.fillText(
    pct >= 80 ? "✦ Mention Excellent ✦" : pct >= 70 ? "✦ Mention Bien ✦" : "✦ Mention Passable ✦",
    W / 2, 350
  );

  ctx.font = "300 11px 'Jost'";
  ctx.fillStyle = "rgba(254,238,184,0.5)";
  ctx.fillText(`Délivré le ${dateStr} · VitalAgent Formation`, W / 2, 390);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── CERTIFICAT COMMERCIAL — Même style que le médical mais en ORANGE ───────
async function downloadCertificate() {
  const total    = state.history.filter(Boolean).length;
  const pct      = total > 0 ? Math.round((state.score / total) * 100) : 0;
  const today    = new Date().toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  const mastered = [...new Set(state.history.filter(h => h.ok).map(h => h.product))].join(", ") || "—";
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
<title>Certificat de Formation Commerciale — VitalAgent</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Jost:wght@300;400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Jost',sans-serif;background:#F4F0E3;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:32px;gap:24px}
  .cert{background:#ffffff;width:780px;padding:0;border-radius:4px;position:relative;box-shadow:0 8px 48px rgba(123,157,210,0.18);overflow:hidden}
  .cert-top-bar{height:8px;background:linear-gradient(90deg,#DAD4DE,#BBB4DA,#7B9DD2,#70C7C6)}
  .cert-inner{padding:52px 64px 48px}
  .cert-border{position:absolute;inset:16px;border:1.5px solid rgba(187,180,218,0.4);border-radius:2px;pointer-events:none}
  /* Header */
  .cert-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid #DAD4DE}
  .cert-logo{display:flex;align-items:center;gap:14px}
  .cert-logo img{width:64px;height:64px;object-fit:contain}
  .cert-logo-text .name{font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:#2a2a3e;letter-spacing:.1em;text-transform:uppercase}
  .cert-logo-text .sub{font-size:10px;color:#9a96b0;letter-spacing:.2em;text-transform:uppercase;margin-top:2px}
  .cert-type{text-align:right}
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
  .cert-score-box{background:linear-gradient(135deg,#F4F0E3,#DAD4DE);border:2px solid #BBB4DA;border-radius:12px;padding:18px 36px;text-align:center}
  .cert-score-num{font-family:'Playfair Display',serif;font-size:44px;font-weight:700;color:#7B9DD2;line-height:1}
  .cert-score-label{font-size:11px;color:#9a96b0;letter-spacing:.12em;text-transform:uppercase;margin-top:4px}
  .cert-score-detail{font-size:13px;font-weight:500;color:#2a2a3e;margin-top:3px}
  .cert-mention{background:linear-gradient(135deg,#7B9DD2,#70C7C6);border-radius:20px;padding:8px 22px;color:#fff;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;align-self:center}
  /* Products */
  .cert-products{background:#F4F0E3;border:1px solid #DAD4DE;border-radius:8px;padding:13px 18px;font-size:12.5px;color:#666;margin-bottom:32px;text-align:left;line-height:1.6}
  .cert-products strong{color:#2a2a3e}
  /* Footer */
  .cert-footer{display:flex;justify-content:space-between;align-items:flex-end;padding-top:24px;border-top:1px solid #DAD4DE}
  .cert-sig{text-align:center}
  .sig-graphic{margin-bottom:8px;height:52px;display:flex;align-items:flex-end;justify-content:center}
  .sig-svg{opacity:.85}
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
  /* Bottom bar */
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
          <img src="${logoSrc}" alt="VITAL Laboratoires" style="width:64px;height:64px;object-fit:contain;filter:invert(1) hue-rotate(180deg) brightness(0.15);"/>        <div class="cert-logo-text">
          <div class="name">VITAL SA</div>
          <div class="sub">Formation Commerciale</div>
        </div>
      </div>
      <div class="cert-type">
        <div class="label">Type de certification</div>
        <div class="value">Quiz Délégué Commercial</div>
      </div>
    </div>
 
    <!-- Body -->
    <div class="cert-body">
      <div class="cert-title-small">Certificat de réussite</div>
      <div class="cert-title-big">Formation Commerciale<br>VitalAgent</div>
      <div class="cert-text">Ce certificat atteste que le délégué</div>
      <div class="cert-name">${delegateName}</div>
      <div class="cert-sub-text">a validé avec succès le quiz de formation commerciale VITAL SA<br>et démontre une maîtrise des compétences de vente pharmaceutique.</div>
    </div>
 
    <!-- Score -->
      <div class="cert-score-row">
        <div class="cert-score-box" style="padding:20px 80px;">
          <div class="cert-score-num">${pct}%</div>
          <div class="cert-score-label">Score obtenu</div>
          <div class="cert-score-detail">${state.score} / ${total} scénarios réussis</div>
          <div class="cert-mention" style="margin-top:14px;background:linear-gradient(135deg,${mentionColor},#70C7C6);border-radius:20px;padding:8px 22px;color:#fff;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;display:inline-block">${mention}</div>
        </div>
      </div>
    <!-- Products -->
    <div class="cert-products">
      <strong>Produits maîtrisés :</strong> ${mastered}
    </div>
 
    <!-- Footer -->
    <div class="cert-footer">
      <!-- Signature -->
      <div class="cert-sig">
        <div class="sig-graphic">
          <svg class="sig-svg" width="140" height="48" viewBox="0 0 140 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 38 C20 10, 30 42, 45 28 C55 18, 60 36, 75 24 C85 15, 92 38, 110 30 C120 25, 128 32, 135 28" stroke="#7B9DD2" stroke-width="2" stroke-linecap="round" fill="none"/>
            <path d="M40 40 C50 35, 55 44, 65 40" stroke="#70C7C6" stroke-width="1.5" stroke-linecap="round" fill="none"/>
          </svg>
        </div>
        <div class="sig-line"></div>
        <div class="sig-name">Vita</div>
        <div class="sig-role">Coach Vente Pharmaceutique · VitalAgent</div>
      </div>
 
      <!-- Stamp -->
      <div class="cert-stamp">
        <div class="stamp-circle">
          <div class="stamp-inner">
            <div class="stamp-logo">🍀</div>
            <div class="stamp-text">VITAL SA</div>
            <div class="stamp-year">Certifié</div>
          </div>
        </div>
      </div>
 
      <!-- Date -->
      <div class="cert-date">
        <strong>Délivré le</strong>
        ${today}<br>
        <span style="font-size:9px;color:#BBB4DA">VitalAgent — VITAL SA Formation</span>
      </div>
    </div>
 
  </div>
  <div class="wm">VITAL SA · Formation Commerciale · Certifié VitalAgent</div>
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
  a.download = "certificat-formation-commerciale-vitalagent.html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyCertLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.querySelector(".cert-share-btn");
    if (btn) {
      btn.textContent = "✓ Lien copié !";
      setTimeout(() => btn.textContent = "🔗 Copier lien", 2000);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════════════════════════════════════

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


/************ il tasjil fil base imta3 resultat quiz*************/
// ── Enregistrer le résultat du quiz commercial ────────────────────────────
// ── Enregistrer le résultat du quiz commercial ────────────────────────────
async function saveQuizResult() {
  const total = state.history.filter(Boolean).length;
  const percentage = total ? Math.round((state.score / total) * 100) : 0;

  // On attend que le bilan final soit complètement écrit
  const feedbackEl = $("final-feedback-text");
  const feedbackText = feedbackEl ? feedbackEl.textContent.trim() : "";

  const payload = {
    quiz_type: "commercial",
    score: state.score,
    total_questions: total,
    percentage: percentage,
    feedback: feedbackText,
    difficulty: state.difficulty,
    products_selected: state.selectedProducts.length > 0 
      ? JSON.stringify(state.selectedProducts) 
      : null,
  };

  try {
    const res = await fetch(`${API_BASE}/quiz/save-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      console.log("✅ Résultat quiz commercial enregistré avec succès");
    } else {
      const errorText = await res.text();
      console.warn("⚠️ Erreur serveur lors de l'enregistrement commercial:", errorText);
    }
  } catch (err) {
    console.error("❌ Erreur saveQuizResult commercial:", err);
  }
}