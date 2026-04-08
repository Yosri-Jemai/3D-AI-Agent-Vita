const API_BASE = "http://localhost:8000";

let state = {
  questions: [],
  current: 0,
  score: 0,
  answered: false,
  difficulty: "moyen",
  questionCount: 10,
  product: "",
  history: [],
  streamDone: false,
  totalExpected: 10,
};

const $ = id => document.getElementById(id);

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
  const avatarDiv = document.getElementById('avatarDiv');
  const slot = document.getElementById('avatar-scene-slot');
  if (!avatarDiv || !slot) return;
  if (slot.contains(avatarDiv)) return;
  slot.innerHTML = '';
  slot.appendChild(avatarDiv);
  console.log("✅ Avatar déplacé vers le quiz");
}

function moveAvatarToSetup() {
  const avatarDiv = document.getElementById('avatarDiv');
  const setupWrap = document.getElementById('setup-avatar-wrap');
  if (!avatarDiv || !setupWrap) return;
  if (setupWrap.contains(avatarDiv)) return;
  setupWrap.insertBefore(avatarDiv, setupWrap.firstChild || null);
}

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
    if (window._avatarReady !== undefined) {
      clearInterval(iv);
      callback();
    }
  }, 150);
  setTimeout(() => { clearInterval(iv); callback(); }, 8000);
}

// Setup options
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
      opt.value = name; opt.textContent = name;
      $("product-select").appendChild(opt);
    });
  } catch (e) { console.warn("Produits non chargés"); }
}

// Start Quiz
$("start-btn").addEventListener("click", startQuiz);

async function startQuiz() {
  state.product = $("product-select").value || null;
  state.current = 0;
  state.score = 0;
  state.answered = false;
  state.history = [];
  state.questions = [];
  state.streamDone = false;
  state.totalExpected = state.questionCount;

  moveAvatarToQuizPanel();

  $("setup-screen").style.display = "none";
  $("quiz-screen").style.display = "flex";
  $("progress-header").style.display = "flex";
  $("score-badge").style.display = "flex";
  $("waiting-state").style.display = "flex";
  $("question-area").style.display = "none";
  $("load-progress").style.display = "flex";

  updateLoadBar(0, state.questionCount);
  speak("Je prépare vos questions de formation médicale, un moment…");

  startSSEStream();
}

function startSSEStream() {
  fetch(`${API_BASE}/quiz/generate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product: state.product,
      difficulty: state.difficulty,
      question_count: state.questionCount,
    }),
  })
  .then(res => {
    if (!res.ok) throw new Error("Erreur serveur");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        lines.forEach(line => {
          if (line.startsWith("data: ")) {
            try {
              handleSSEEvent(JSON.parse(line.slice(6)));
            } catch (e) {}
          }
        });
        read();
      }).catch(err => {
        console.error("SSE error:", err);
        if (state.questions.length === 0) returnToSetup("Erreur de connexion.");
      });
    }
    read();
  })
  .catch(err => returnToSetup(`Impossible de contacter le serveur.`));
}

function handleSSEEvent(event) {
  if (event.type === "question") {
    state.questions.push(event.question);
    updateLoadBar(state.questions.length, event.total);

    if (state.questions.length === 1) {
      $("waiting-state").style.display = "none";
      $("question-area").style.display = "block";
      loadQuestion(0);
    }
  }

  if (event.type === "done") {
    state.streamDone = true;
    state.totalExpected = event.count || state.questions.length;
    $("load-progress").style.display = "none";
    updateHeader();
  }

  if (event.type === "error") {
    returnToSetup(event.message || "Erreur génération questions");
  }
}

function updateLoadBar(loaded, total) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  $("load-fill").style.width = `${pct}%`;
  $("load-label").textContent = `Questions générées : ${loaded} / ${total}`;
}

function loadQuestion(idx) {
  if (idx >= state.questions.length) return;

  const q = state.questions[idx];
  state.current = idx;
  state.answered = false;
  updateHeader();

  $("q-number").textContent = `Q${idx + 1}`;
  $("q-topic").textContent = q.product || "Formation VITAL SA";
  $("q-difficulty-badge").textContent = state.difficulty.charAt(0).toUpperCase() + state.difficulty.slice(1);
  $("question-text").textContent = q.question;

  const grid = $("choices-grid");
  grid.innerHTML = "";

  ["A","B","C","D"].forEach((letter, i) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.innerHTML = `<span class="choice-letter">${letter}</span><span class="choice-text">${q.choices[i]}</span>`;
    btn.addEventListener("click", () => handleAnswer(i, q));
    grid.appendChild(btn);
  });

  $("explanation-box").style.display = "none";
  $("action-row").style.display = "none";

  speak(`Question ${idx + 1} : ${q.question}`);
}

function updateHeader() {
  const total = state.streamDone ? state.questions.length : state.totalExpected;
  $("q-counter").textContent = `Question ${state.current + 1} / ${total}`;
  $("progress-fill-mini").style.width = `${(state.current / Math.max(total,1)) * 100}%`;
  $("score-live").textContent = `${state.score} / ${state.current}`;
}

function handleAnswer(chosenIdx, q) {
  if (state.answered) return;
  state.answered = true;

  const correct = q.correct_index;
  const isOk = chosenIdx === correct;
  if (isOk) state.score++;

  const buttons = $("choices-grid").querySelectorAll(".choice-btn");
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === correct) b.classList.add("correct");
    if (i === chosenIdx && !isOk) b.classList.add("wrong");
  });

  state.history.push({
    question: q.question,
    chosen: q.choices[chosenIdx],
    correct: q.choices[correct],
    ok: isOk
  });

  $("explanation-icon").textContent = isOk ? "✓" : "✗";
  $("explanation-icon").className = `explanation-icon ${isOk ? "ok" : "bad"}`;
  $("explanation-verdict").textContent = isOk ? "Bonne réponse !" : "Réponse incorrecte";
  $("explanation-text").textContent = q.explanation || "Consultez la fiche produit.";
  $("explanation-box").style.display = "flex";

  const isLast = state.current >= state.questions.length - 1 && state.streamDone;
  $("next-btn").innerHTML = isLast 
    ? `Voir les résultats →` 
    : `Question suivante →`;

  $("action-row").style.display = "flex";

  speak(isOk ? "Excellent ! Très bonne réponse." : "Ce n’est pas tout à fait ça. Retenez l’explication.");
}

$("next-btn").addEventListener("click", () => {
  const nextIdx = state.current + 1;
  if (nextIdx < state.questions.length) {
    loadQuestion(nextIdx);
  } else if (state.streamDone) {
    showResults();
  } else {
    $("next-btn").textContent = "Chargement...";
    const check = setInterval(() => {
      if (state.questions.length > nextIdx || state.streamDone) {
        clearInterval(check);
        state.questions.length > nextIdx ? loadQuestion(nextIdx) : showResults();
      }
    }, 300);
  }
});

function showResults() {
  $("quiz-screen").style.display = "none";
  $("results-screen").style.display = "flex";
  $("progress-header").style.display = "none";

  const total = state.history.length;
  const pct = total ? Math.round((state.score / total) * 100) : 0;

  $("results-score-num").textContent = state.score;
  $("results-score-denom").textContent = `/ ${total}`;

  // Tu peux compléter cette fonction avec ton ancien code si tu veux
  console.log("Quiz terminé - Score :", state.score, "/", total);
}

function returnToSetup(msg) {
  $("quiz-screen").style.display = "none";
  $("setup-screen").style.display = "flex";
  $("progress-header").style.display = "none";
  $("score-badge").style.display = "none";
  moveAvatarToSetup();
  if (msg) alert(msg);
}

$("restart-btn").addEventListener("click", () => {
  $("results-screen").style.display = "none";
  $("setup-screen").style.display = "flex";
  moveAvatarToSetup();
  speak("Configurez votre quiz et commencez quand vous êtes prêt.");
});