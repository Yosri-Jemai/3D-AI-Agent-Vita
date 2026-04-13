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
// TYPING ENGINE — moteur d'animation de texte unifié
// ══════════════════════════════════════════════════════════════════════════════
const TypingEngine = {
  queue:   "",
  timer:   null,
  element: null,
  cursor:  null,
  onDone:  null,
  _sealed: false,   // true quand finish() a été appelé

  // Démarre l'animation sur un élément DOM.
  // cursor  : span.typing-cursor (optionnel)
  // onDone  : callback appelé quand tout est vidé + finish() reçu
  start(element, cursor, onDone) {
    this.element = element;
    this.cursor  = cursor  || null;
    this.onDone  = onDone  || null;
    this._sealed = false;
    if (this.cursor) this.cursor.style.display = "inline-block";
    if (!this.timer) this._tick();
  },

  // Ajoute du texte à la file d'attente (appelé à chaque token SSE)
  push(text) {
    this.queue += text;
  },

  // Signale que le stream est terminé — vide proprement le reste
  finish() {
    this._sealed = true;
  },

  // Réinitialisation complète (changement de question, etc.)
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

    // File vide
    if (this.queue.length === 0) {
      if (this._sealed) {
        // Stream terminé et tout vidé → fin
        if (this.cursor) this.cursor.style.display = "none";
        if (this.onDone) this.onDone();
        this.reset();
        return;
      }
      // On attend le prochain token
      this.timer = setTimeout(() => this._tick(), 40);
      return;
    }

    // Burst naturel : 1 char, parfois 2
    const burst = Math.min(this.queue.length, Math.random() < 0.25 ? 2 : 1);
    this.element.textContent += this.queue.slice(0, burst);
    this.queue = this.queue.slice(burst);

    // Délai variable selon ponctuation → effet humain
    const last = this.element.textContent.slice(-1);
    let delay = 18 + Math.random() * 16;            // 18–34 ms base
    if (last === "," || last === ";") delay = 95;
    else if ("·.!?".includes(last))  delay = 180;
    else if (last === "\n")           delay = 120;
    else if (last === " ")            delay = 28;

    this.timer = setTimeout(() => this._tick(), delay);
  },
};


// ── TTS / Avatar ──────────────────────────────────────────────────────────
function speak(text) {
  const el = $("bubble-text");
  if (el) {
    el.style.opacity = "0";
    setTimeout(() => { el.textContent = text; el.style.opacity = "1"; }, 150);
  }
  if (typeof window.speakWithAvatar === "function") {
    window.speakWithAvatar(text, "fr");
  }
}

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
    if (window._avatarReady !== undefined) { clearInterval(iv); callback(); }
  }, 150);
  setTimeout(() => { clearInterval(iv); callback(); }, 8000);
}

// ── Chargement produits ────────────────────────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch(`${API_BASE}/products`);
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
  if (count === 0) {
    label.textContent = "Tous les produits";
    label.classList.remove("has-selection");
  } else if (count === 1) {
    label.textContent = state.selectedProducts[0];
    label.classList.add("has-selection");
  } else {
    label.textContent = `${count} produits sélectionnés`;
    label.classList.add("has-selection");
  }
}

function setupProductSearch() {
  const searchInput = $("product-search");
  if (!searchInput) return;
  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
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
  const btn = $("product-dropdown-btn");
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
  Object.assign(state, {
    current: 0, score: 0, answered: false, history: [],
    questions: [], streamDone: false, generating: true,
    totalExpected: state.questionCount,
  });

  $("product-dropdown") && $("product-dropdown").classList.remove("open");
  moveAvatarToQuizPanel();
  $("setup-screen").style.display    = "none";
  $("quiz-screen").style.display     = "flex";
  $("progress-header").style.display = "flex";
  $("score-badge").style.display     = "flex";
  showLoadingState();

  const selCount = state.selectedProducts.length;
  if (selCount === 1)      speak(`Je génère ${state.questionCount} questions sur ${state.selectedProducts[0]}…`);
  else if (selCount > 1)   speak(`Je génère ${state.questionCount} questions sur ${selCount} produits sélectionnés…`);
  else                     speak("Je génère vos questions de formation, un moment…");

  startSSEStream();
}

function showLoadingState() {
  $("waiting-state").style.display   = "flex";
  $("question-area").style.display   = "none";
  $("load-progress").style.display   = "flex";
  updateLoadBar(0, state.totalExpected);
}

// ── SSE Stream ────────────────────────────────────────────────────────────
function startSSEStream() {
  const body = { difficulty: state.difficulty, question_count: state.questionCount };
  if (state.selectedProducts.length > 0) body.products = state.selectedProducts;

  fetch(`${API_BASE}/quiz/generate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
            try { handleSSEEvent(JSON.parse(line.slice(6))); }
            catch (e) {}
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
  if ($("load-fill"))  $("load-fill").style.width        = `${pct}%`;
  if ($("load-label")) $("load-label").textContent       = `Questions prêtes : ${loaded} / ${total}`;
}

// ── Affichage d'une question ──────────────────────────────────────────────
function loadQuestion(idx) {
  if (idx >= state.questions.length) return;

  // Stoppe toute animation en cours sur l'ancienne question
  TypingEngine.reset();

  const q = state.questions[idx];
  state.current  = idx;
  state.answered = false;
  updateHeader();

  $("q-number").textContent        = `Q${idx + 1}`;
  $("q-topic").textContent         = q.product || "Formation VITAL SA";
  $("q-difficulty-badge").textContent =
    state.difficulty.charAt(0).toUpperCase() + state.difficulty.slice(1);
  $("question-text").textContent   = q.question;

  const grid    = $("choices-grid");
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

  // Réinitialiser le feedback typing
  const fb = $("feedback-typing-box");
  if (fb) {
    fb.style.display = "none";
    $("feedback-typing-text").textContent = "";
    const cur = $("typing-cursor");
    if (cur) cur.style.display = "none";
  }

  const panel = document.querySelector(".question-panel");
  if (panel) panel.scrollTop = 0;

  speak(`Question ${idx + 1} : ${q.question}`);
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
  const donutPct = $("donut-pct");
  if (arc) {
    const circumference = 201;
    arc.style.strokeDashoffset = circumference - (circumference * pct / 100);
    arc.style.stroke = pct >= 70 ? "var(--accent)" : pct >= 40 ? "#f59e0b" : "#ef4444";
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
    if (i === correct)          btn.classList.add("correct");
    if (i === chosenIdx && !isOk) btn.classList.add("wrong");
  });

  state.history.push({
    question:    q.question,
    product:     q.product || "—",
    chosen:      q.choices[chosenIdx],
    correct:     q.choices[correct],
    ok:          isOk,
    explanation: q.explanation || "",
  });

  $("explanation-icon").textContent    = isOk ? "✓" : "✗";
  $("explanation-icon").className      = `explanation-icon ${isOk ? "ok" : "bad"}`;
  $("explanation-verdict").textContent = isOk ? "Bonne réponse !" : "Réponse incorrecte";
  $("explanation-text").textContent    = q.explanation || "Consultez la fiche produit pour plus de détails.";
  $("explanation-box").style.display   = "flex";

  if (!isOk) {
    setTimeout(() => streamQuestionFeedback(q, chosenIdx), 400);
  }

  const isLast = state.current >= state.questions.length - 1 && state.streamDone;
  const nextBtn = $("next-btn");
  nextBtn.innerHTML = isLast
    ? `Voir les résultats <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `Question suivante <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  $("action-row").style.display = "flex";
  updateHeader();
  speak(isOk ? "Excellent ! Très bonne réponse." : `La bonne réponse était : ${q.choices[correct]}.`);
}

// ── Navigation ────────────────────────────────────────────────────────────
let _waitingForNext = false;

$("next-btn").addEventListener("click", goToNext);

function goToNext() {
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

// ── Résultats ─────────────────────────────────────────────────────────────
function showResults() {
  $("quiz-screen").style.display     = "none";
  $("results-screen").style.display  = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display     = "none";

  const total = state.history.length;
  const pct   = total ? Math.round((state.score / total) * 100) : 0;

  $("results-score-num").textContent   = state.score;
  $("results-score-denom").textContent = `/ ${total}`;

  let title, message;
  if (pct >= 80)      { title = "Excellent travail ! 🏆"; message = `Vous maîtrisez très bien les produits VITAL SA. Score : ${pct}%`; }
  else if (pct >= 60) { title = "Bon résultat ! 👍";      message = `Vous avez une bonne connaissance des produits. Continuez à vous former. Score : ${pct}%`; }
  else                { title = "À revoir 📚";            message = `Certains points méritent d'être approfondis. Relisez les fiches produits. Score : ${pct}%`; }

  $("results-title").textContent   = title;
  $("results-message").textContent = message;

  const breakdown = $("results-breakdown");
  breakdown.innerHTML = "";
  state.history.forEach((item, i) => {
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
  if (ring) {
    ring.style.borderColor = pct >= 70 ? "var(--accent)" : pct >= 40 ? "#f59e0b" : "#ef4444";
  }
  speak(title + " " + message);

  if (total > 0) {
    streamFinalFeedback();
    if (pct >= 60) {
      const certSection = $("certificate-section");
      if (certSection) certSection.style.display = "block";
    }
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

$("restart-btn").addEventListener("click", () => {
  $("results-screen").style.display = "none";
  $("setup-screen").style.display   = "flex";
  moveAvatarToSetup();
  speak("Configurez votre quiz et commencez quand vous êtes prêt.");
});

// ── Utilitaires ───────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPER : lit un SSE stream et pousse les tokens dans TypingEngine
// element : élément DOM cible (textContent sera modifié)
// cursor  : span.typing-cursor (peut être null)
// fetchFn : () => Promise<Response>
// onError : () => void  (optionnel)
// ══════════════════════════════════════════════════════════════════════════════
async function _streamIntoTypingEngine(element, cursor, fetchFn, onError) {
  // Réinitialise le moteur et démarre sur cet élément
  TypingEngine.reset();
  element.textContent = "";
  TypingEngine.start(element, cursor);

  let res;
  try {
    res = await fetchFn();
  } catch (err) {
    console.warn("[Quiz] fetch error:", err);
    if (onError) onError();
    return;
  }

  if (!res.ok) {
    if (onError) onError();
    return;
  }

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
    // Si le stream se ferme sans event "done" explicite
    TypingEngine.finish();
  } catch (err) {
    console.warn("[Quiz] stream read error:", err);
    TypingEngine.finish();
  }
}

// ── Feedback typing sur mauvaise réponse ─────────────────────────────────
async function streamQuestionFeedback(q, chosenIdx) {
  const box    = $("feedback-typing-box");
  const textEl = $("feedback-typing-text");
  const cursor = $("typing-cursor");
  if (!box || !textEl) return;

  box.style.display = "block";

  await _streamIntoTypingEngine(
    textEl,
    cursor,
    () => fetch(`${API_BASE}/quiz/feedback/stream`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question:       q.question,
        correct_answer: q.choices[q.correct_index],
        chosen_answer:  q.choices[chosenIdx],
        product:        q.product || "",
        explanation:    q.explanation || "",
      }),
    }),
    () => { box.style.display = "none"; }
  );
}

// ── Bilan final Dr. Layla (page résultats) ────────────────────────────────
async function streamFinalFeedback() {
  const section = $("final-feedback-section");
  const textEl  = $("final-feedback-text");
  if (!section || !textEl) return;

  section.style.display = "block";

  // Crée un curseur clignotant injecté dans le conteneur du bilan
  textEl.innerHTML = "";
  const finalCursor = document.createElement("span");
  finalCursor.className = "typing-cursor";
  textEl.appendChild(finalCursor);

  // Crée un span dédié au texte (le curseur reste toujours à la fin)
  const textSpan = document.createElement("span");
  textEl.insertBefore(textSpan, finalCursor);

  await _streamIntoTypingEngine(
    textSpan,
    finalCursor,
    () => fetch(`${API_BASE}/quiz/feedback/final/stream`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score:   state.score,
        total:   state.history.length,
        history: state.history,
      }),
    }),
    () => { textEl.textContent = "Bilan indisponible."; }
  );
}

// ── Certificat de réussite ────────────────────────────────────────────────
function downloadCertificate() {
  const total    = state.history.length;
  const pct      = total > 0 ? Math.round((state.score / total) * 100) : 0;
  const today    = new Date().toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  const mastered = [...new Set(state.history.filter(h => h.ok).map(h => h.product))].join(", ") || "—";

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Certificat de Formation — VitalAgent</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lato:wght@300;400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Lato',sans-serif;background:#f4f1eb;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:32px;gap:20px}
  .cert{background:#fff;width:760px;padding:56px 64px;border:1px solid #e2d9c8;position:relative;box-shadow:0 4px 40px rgba(0,0,0,.10)}
  .cert::before{content:'';position:absolute;inset:8px;border:2px solid #c9a84c;pointer-events:none}
  .logo{text-align:center;margin-bottom:28px}
  .logo-name{font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:.12em;text-transform:uppercase}
  .logo-sub{font-size:11px;color:#888;letter-spacing:.18em;text-transform:uppercase;margin-top:2px}
  .divider{width:80px;height:2px;background:#c9a84c;margin:16px auto}
  .heading{text-align:center;font-family:'Playfair Display',serif;font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:#888;margin-bottom:8px}
  .title{text-align:center;font-family:'Playfair Display',serif;font-size:34px;font-weight:700;color:#1a1a1a;line-height:1.25;margin-bottom:24px}
  .body{text-align:center;font-size:14px;color:#444;line-height:1.8;margin-bottom:28px}
  .delegate{font-size:22px;font-family:'Playfair Display',serif;color:#1a1a1a;border-bottom:1.5px solid #c9a84c;display:inline-block;padding:0 24px 4px;margin:6px 0 10px}
  .score-box{display:inline-flex;align-items:center;gap:12px;background:#fefce8;border:1.5px solid #c9a84c;border-radius:10px;padding:12px 28px;margin:0 auto 24px}
  .score-num{font-size:36px;font-weight:700;font-family:'Playfair Display',serif;color:#92400e}
  .score-lbl{font-size:12px;color:#b45309;text-align:left;line-height:1.4}
  .products{background:#fafaf8;border:1px solid #e2d9c8;border-radius:8px;padding:12px 18px;font-size:12.5px;color:#555;margin-bottom:28px;text-align:left}
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
    <span class="delegate">Délégué VITAL SA</span><br>
    a validé avec succès le quiz de formation médicale VitalAgent.
  </div>
  <div style="text-align:center">
    <div class="score-box">
      <div class="score-num">${pct}%</div>
      <div class="score-lbl">Score obtenu<br><strong>${state.score} / ${total} questions</strong></div>
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
  <button onclick="window.print()" style="padding:12px 28px;background:#c9a84c;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">🖨️ Imprimer / Enregistrer en PDF</button>
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