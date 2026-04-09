/**
 * quiz-medical.js — VERSION REFONTE COMPLÈTE
 *
 * Améliorations :
 *  1. Toutes les questions sont chargées en parallèle côté serveur
 *  2. Navigation INSTANTANÉE entre les questions (plus d'attente)
 *  3. Skeleton loader pendant la génération initiale
 *  4. Feedback visuel clair (bonne/mauvaise réponse)
 *  5. Écran résultats complet avec détail par question
 */

const API_BASE = window.API_BASE || "http://localhost:8000";

// ── État global ────────────────────────────────────────────────────────────
let state = {
  questions: [],        // toutes les questions reçues
  current: 0,           // index de la question affichée
  score: 0,
  answered: false,
  difficulty: "moyen",
  questionCount: 10,
  product: "",
  history: [],
  streamDone: false,    // true quand le serveur a tout envoyé
  totalExpected: 10,
  generating: false,    // vrai pendant la génération initiale
};

const $ = id => document.getElementById(id);

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

$("product-select").addEventListener("change", e => { state.product = e.target.value; });

async function loadProducts() {
  try {
    const res = await fetch(`${API_BASE}/products`);
    const data = await res.json();
    (data.products || []).sort().forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      $("product-select").appendChild(opt);
    });
  } catch (e) {
    console.warn("[Quiz] Produits non chargés depuis /products");
  }
}

// ── Démarrage du quiz ─────────────────────────────────────────────────────
$("start-btn").addEventListener("click", startQuiz);

async function startQuiz() {
  // Reset état
  Object.assign(state, {
    current: 0,
    score: 0,
    answered: false,
    history: [],
    questions: [],
    streamDone: false,
    generating: true,
    totalExpected: state.questionCount,
    product: $("product-select").value || null,
  });

  moveAvatarToQuizPanel();

  // Afficher l'écran quiz
  $("setup-screen").style.display = "none";
  $("quiz-screen").style.display = "flex";
  $("progress-header").style.display = "flex";
  $("score-badge").style.display = "flex";

  // Afficher le skeleton pendant la génération
  showLoadingState();

  speak("Je génère vos questions de formation en parallèle, un moment…");

  // Démarrer le stream SSE
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
  fetch(`${API_BASE}/quiz/generate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product:        state.product,
      difficulty:     state.difficulty,
      question_count: state.questionCount,
    }),
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
            catch (e) { /* JSON incomplet, ignore */ }
          }
        });
        read();
      }).catch(err => {
        console.error("[Quiz] SSE error:", err);
        if (state.questions.length === 0) {
          returnToSetup("Erreur de connexion au serveur.");
        }
      });
    }
    read();
  })
  .catch(err => returnToSetup(`Impossible de contacter le serveur : ${err.message}`));
}

function handleSSEEvent(event) {
  if (event.type === "loading") {
    // Le serveur démarre la génération parallèle
    state.totalExpected = event.total || state.questionCount;
    updateLoadBar(0, state.totalExpected);
    $("waiting-state").querySelector(".waiting-text").textContent =
      `Dr. Layla génère ${state.totalExpected} questions en parallèle…`;
  }

  if (event.type === "question") {
    // Une question est prête
    state.questions.push(event.question);
    updateLoadBar(state.questions.length, event.total || state.totalExpected);

    // Dès la 1ère question → afficher (les autres arriveront très vite)
    if (state.questions.length === 1) {
      $("waiting-state").style.display = "none";
      $("question-area").style.display = "block";
      loadQuestion(0);
    }
  }

  if (event.type === "done") {
    state.streamDone = true;
    state.generating = false;
    state.totalExpected = event.count || state.questions.length;
    $("load-progress").style.display = "none";
    updateHeader();

    // Si on attendait des questions pour la navigation
    if (_waitingForNext) {
      _waitingForNext = false;
      const nextIdx = state.current + 1;
      if (nextIdx < state.questions.length) {
        loadQuestion(nextIdx);
      } else {
        showResults();
      }
    }
  }

  if (event.type === "error") {
    console.error("[Quiz] Erreur serveur:", event.message);
    if (state.questions.length === 0) {
      returnToSetup(event.message || "Erreur lors de la génération des questions.");
    }
  }
}

function updateLoadBar(loaded, total) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  if ($("load-fill")) $("load-fill").style.width = `${pct}%`;
  if ($("load-label")) $("load-label").textContent = `Questions prêtes : ${loaded} / ${total}`;
}

// ── Affichage d'une question ──────────────────────────────────────────────
function loadQuestion(idx) {
  if (idx >= state.questions.length) return;

  const q = state.questions[idx];
  state.current = idx;
  state.answered = false;
  updateHeader();

  // Méta-infos
  $("q-number").textContent = `Q${idx + 1}`;
  $("q-topic").textContent = q.product || "Formation VITAL SA";
  $("q-difficulty-badge").textContent =
    state.difficulty.charAt(0).toUpperCase() + state.difficulty.slice(1);
  $("question-text").textContent = q.question;

  // Choix
  const grid = $("choices-grid");
  grid.innerHTML = "";
  const letters = ["A", "B", "C", "D"];

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

  // Reset feedback
  $("explanation-box").style.display = "none";
  $("action-row").style.display = "none";

  // Scroll haut si nécessaire
  const panel = document.querySelector(".question-panel");
  if (panel) panel.scrollTop = 0;

  speak(`Question ${idx + 1} : ${q.question}`);
}

function updateHeader() {
  const total = state.streamDone
    ? state.questions.length
    : state.totalExpected;

  if ($("q-counter"))
    $("q-counter").textContent = `Question ${state.current + 1} / ${total}`;

  if ($("progress-fill-mini"))
    $("progress-fill-mini").style.width =
      `${((state.current) / Math.max(total, 1)) * 100}%`;

  if ($("score-live"))
    $("score-live").textContent = `${state.score} / ${state.current}`;

  // Donut score
  updateDonut();
}

function updateDonut() {
  const total   = state.current;
  const pct     = total > 0 ? Math.round((state.score / total) * 100) : 0;
  const arc     = $("donut-arc");
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

  // Colorer les boutons
  const buttons = $("choices-grid").querySelectorAll(".choice-btn");
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === correct) btn.classList.add("correct");
    if (i === chosenIdx && !isOk) btn.classList.add("wrong");
  });

  // Historique
  state.history.push({
    question: q.question,
    product:  q.product || "—",
    chosen:   q.choices[chosenIdx],
    correct:  q.choices[correct],
    ok:       isOk,
    explanation: q.explanation || "",
  });

  // Explication
  $("explanation-icon").textContent      = isOk ? "✓" : "✗";
  $("explanation-icon").className        = `explanation-icon ${isOk ? "ok" : "bad"}`;
  $("explanation-verdict").textContent   = isOk ? "Bonne réponse !" : "Réponse incorrecte";
  $("explanation-text").textContent      = q.explanation || "Consultez la fiche produit pour plus de détails.";
  $("explanation-box").style.display     = "flex";

  // Bouton suivant
  const isLast = state.current >= state.questions.length - 1 && state.streamDone;
  const nextBtn = $("next-btn");
  nextBtn.innerHTML = isLast
    ? `Voir les résultats <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `Question suivante <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  $("action-row").style.display = "flex";

  updateHeader();

  // Feedback vocal court
  speak(isOk
    ? "Excellent ! Très bonne réponse."
    : `La bonne réponse était : ${q.choices[correct]}.`
  );
}

// ── Navigation ────────────────────────────────────────────────────────────
let _waitingForNext = false; // true si on attend une question pas encore arrivée

$("next-btn").addEventListener("click", goToNext);

function goToNext() {
  const nextIdx = state.current + 1;

  // Cas 1 : la question suivante est déjà dans le cache → INSTANTANÉ
  if (nextIdx < state.questions.length) {
    loadQuestion(nextIdx);
    return;
  }

  // Cas 2 : le stream est fini mais il n'y a plus de question → résultats
  if (state.streamDone) {
    showResults();
    return;
  }

  // Cas 3 : le serveur génère encore, on attend (rare car génération parallèle)
  _waitingForNext = true;
  $("next-btn").disabled    = true;
  $("next-btn").textContent = "Chargement…";

  const check = setInterval(() => {
    if (state.questions.length > nextIdx) {
      clearInterval(check);
      _waitingForNext = false;
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
  $("quiz-screen").style.display    = "none";
  $("results-screen").style.display = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display    = "none";

  const total = state.history.length;
  const pct   = total ? Math.round((state.score / total) * 100) : 0;

  $("results-score-num").textContent   = state.score;
  $("results-score-denom").textContent = `/ ${total}`;

  // Message selon le score
  let title, message;
  if (pct >= 80) {
    title   = "Excellent travail ! 🏆";
    message = `Vous maîtrisez très bien les produits VITAL SA. Score : ${pct}%`;
  } else if (pct >= 60) {
    title   = "Bon résultat ! 👍";
    message = `Vous avez une bonne connaissance des produits. Continuez à vous former. Score : ${pct}%`;
  } else {
    title   = "À revoir 📚";
    message = `Certains points méritent d'être approfondis. Relisez les fiches produits. Score : ${pct}%`;
  }

  $("results-title").textContent   = title;
  $("results-message").textContent = message;

  // Détail question par question
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

  // Anneau résultat coloré
  const ring = $("results-ring");
  if (ring) {
    ring.style.borderColor = pct >= 70 ? "var(--accent)" : pct >= 40 ? "#f59e0b" : "#ef4444";
  }

  speak(title + " " + message);
}

// ── Retour setup ──────────────────────────────────────────────────────────
function returnToSetup(msg) {
  $("quiz-screen").style.display    = "none";
  $("setup-screen").style.display   = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display    = "none";
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