


/* ─────────────────────────────────────────────────────────────────────────────
   3. MODIFIER finalizeBubble() dans main.js ET commercial.js
   ─────────────────────────────────────────────────────────────────────────── */

/*
   AVANT (version actuelle) :
   ──────────────────────────
   function finalizeBubble(fullText, sources) {
     logAI(fullText, sources);
     const textEl = document.getElementById('streaming-text');
     if (textEl) {
       const html = fullText.split('\n\n').filter(p=>p.trim()).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
       textEl.outerHTML = html || '<p></p>';
     }
     const bubble = document.getElementById('streaming-bubble');
     if (bubble && sources?.length) {
       bubble.removeAttribute('id');
       const tags = sources.map(s=>`<span class="source-tag">${esc(s.name)}<span class="rel">${Math.round(s.relevance*100)}%</span></span>`).join('');
       bubble.insertAdjacentHTML('beforeend',`<div class="sources"><div class="sources-label">Sources</div>${tags}</div>`);
     }
     scrollBottom();
   }

   APRÈS (version patchée — REMPLACER par celle-ci) :
   ──────────────────────────────────────────────────
   
*/


/* ─────────────────────────────────────────────────────────────────────────────
   4. MODIFIER les appels à finalizeBubble() dans main.js ET commercial.js
      pour passer la question de l'utilisateur en 3ème argument
   ─────────────────────────────────────────────────────────────────────────── */

/*
   DANS sendQuestion() — main.js :
   ────────────────────────────────
   AVANT :  finalizeBubble(full, sources);
   APRÈS :  finalizeBubble(full, sources, ragQuestion);

   DANS resendQuestion() — main.js :
   ───────────────────────────────────
   AVANT :  finalizeBubble(full, sources);
   APRÈS :  finalizeBubble(full, sources, ragQuestion);

   DANS sendAudio() — main.js (voice) :
   ──────────────────────────────────────
   AVANT :  finalizeBubble(full, sources);
   APRÈS :  finalizeBubble(full, sources, question);   // question = c.text du transcript

   ─────────
   DANS sendQuestion() — commercial.js :
   ──────────────────────────────────────
   AVANT :  finalizeBubble(fullText, sources);
   APRÈS :  finalizeBubble(fullText, sources, userText);

   DANS resendQuestion() — commercial.js :
   ────────────────────────────────────────
   AVANT :  finalizeBubble(full, sources);
   APRÈS :  finalizeBubble(full, sources, userText);

   DANS sendAudio() — commercial.js :
   ────────────────────────────────────
   AVANT :  finalizeBubble(fullText, sources);
   APRÈS :  finalizeBubble(fullText, sources, transcript);

   ─────────
   DANS loadGreeting() — main.js ET commercial.js :
   ─────────────────────────────────────────────────
   Le greeting n'a pas de "question utilisateur" → ne pas ajouter de suggestions.
   Laisser : finalizeBubble(fullText, []);   ← sans 3ème argument (undefined → pas de suggestions)
*/
