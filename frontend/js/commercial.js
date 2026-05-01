const API = 'http://localhost:8000';
window._API = API;

let isLoading = false;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

let currentSessionId = null;
let currentProfileId = null;

const MODE = 'commercial';
let visitStarted = false;

const PRODUCT_MENTIONS_KEY = 'vita_product_mentions';

// ── Product Tracking for Dashboard ───────────────────────────
let productListCache = []; // Cache de la liste des produits depuis l'API

// Récupérer la liste des produits depuis l'API
async function loadProductListForTracking() {
    try {
        const res = await fetch(`${API}/products`);
        const data = await res.json();
        productListCache = data.products || [];
        console.log('[Product Tracking] Loaded products from API:', productListCache);
    } catch (e) {
        console.warn('[Product Tracking] Failed to load products from API, using fallback list');
        // Fallback: liste de base si l'API n'est pas disponible
        productListCache = [
            "Pollen d'abeilles",
            "LV Hemostop",
            "Dermalo",
            "Efidel",
            "Gynel",
            "Bébégold",
            "Vitamine C",
            "Vitamine D",
            "Bactol",
            "Hydra",
            "Herbalgix",
            "Sebocontrol",
            "Phytovit",
            "Vitamix"
        ];
    }
}

// Fonction pour tracker les produits mentionnés
function trackProductMention(productName) {
  if (!productName) return;
  
  try {
    const raw = localStorage.getItem(PRODUCT_MENTIONS_KEY);
    const mentions = raw ? JSON.parse(raw) : {};
    
    const normalized = productName.trim().toLowerCase();
    mentions[normalized] = (mentions[normalized] || 0) + 1;
    
    localStorage.setItem(PRODUCT_MENTIONS_KEY, JSON.stringify(mentions));
    console.log('[Product Tracking] Product tracked:', productName, 'Total mentions:', mentions[normalized]);
  } catch (e) {
    console.error('[Product Tracking] Error:', e);
  }
}

// Fonction pour extraire les produits du texte
function extractProductsFromText(text) {
    console.log('[Product Extraction] Input text:', text);
    if (!text) return [];
    
    const textLower = text.toLowerCase();
    const products = [];
    
    // Utiliser la liste dynamique des produits
    const productList = productListCache.length > 0 ? productListCache : [
        "Pollen d'abeilles",
        "LV Hemostop",
        "Dermalo",
        "Efidel",
        "Gynel",
        "Bébégold"
    ];
    console.log('[Product Extraction] Product list:', productList);
    
    // Vérifier chaque produit de la liste
    productList.forEach(productName => {
        if (!productName) return;
        const productLower = productName.toLowerCase();
        // Créer un pattern qui détecte le nom exact ou partiel du produit
        const pattern = new RegExp(productLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (pattern.test(textLower)) {
            console.log('[Product Extraction] Found product in list:', productName);
            products.push(productName);
        }
    });
    
    // Détection supplémentaire pour les variantes
    if (/pollen/i.test(textLower) && !products.includes("Pollen d'abeilles")) {
        console.log('[Product Extraction] Found pollen variant');
        products.push("Pollen d'abeilles");
    }
    if (/hemostop/i.test(textLower) && !products.some(p => p.toLowerCase().includes('hemostop'))) {
        console.log('[Product Extraction] Found hemostop variant');
        products.push("LV Hemostop");
    }
    if (/dermalo/i.test(textLower) && !products.some(p => p.toLowerCase().includes('dermalo'))) {
        console.log('[Product Extraction] Found dermalo variant');
        products.push("Dermalo");
    }
    if (/gynel/i.test(textLower) && !products.some(p => p.toLowerCase().includes('gynel'))) {
        console.log('[Product Extraction] Found gynel variant');
        products.push("Gynel");
    }
    if (/efidel/i.test(textLower) && !products.some(p => p.toLowerCase().includes('efidel'))) {
        console.log('[Product Extraction] Found efidel variant');
        products.push("Efidel");
    }
    if (/b[eé]b[eé]gold|bebe gold/i.test(textLower) && !products.some(p => p.toLowerCase().includes('bebegold'))) {
        console.log('[Product Extraction] Found bebegold variant');
        products.push("Bébégold");
    }
    
    const uniqueProducts = [...new Set(products)]; // Supprimer les doublons
    console.log('[Product Extraction] Final products:', uniqueProducts);
    return uniqueProducts;
}

// Fonction pour tracker tous les produits mentionnés dans le texte
function trackProductMentions(text) {
    console.log('[Product Tracking] Processing text:', text);
    const products = extractProductsFromText(text);
    console.log('[Product Tracking] Extracted products:', products);
    
    if (products.length === 0) {
        console.log('[Product Tracking] No products found');
        return;
    }
    
    try {
        const stored = localStorage.getItem(PRODUCT_MENTIONS_KEY);
        const mentions = stored ? JSON.parse(stored) : {};
        console.log('[Product Tracking] Current mentions before update:', mentions);
        
        products.forEach(product => {
            mentions[product] = (mentions[product] || 0) + 1;
            console.log('[Product Tracking] Incremented product:', product, 'New count:', mentions[product]);
        });
        
        localStorage.setItem(PRODUCT_MENTIONS_KEY, JSON.stringify(mentions));
        console.log('[Product Tracking] Updated mentions:', mentions);
        console.log('[Product Tracking] localStorage saved:', localStorage.getItem(PRODUCT_MENTIONS_KEY));
        
        // Afficher le total des mentions
        const totalMentions = Object.values(mentions).reduce((sum, count) => sum + count, 0);
        console.log('[Product Tracking] Total mentions:', totalMentions);
    } catch (e) {
        console.error('[Product Tracking] Error:', e);
    }
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  setStatus('loading', 'Loading avatar…');

  await new Promise(resolve => {
    const t = setInterval(() => { if (window.initAvatar) { clearInterval(t); resolve(); } }, 30);
    setTimeout(() => { clearInterval(t); resolve(); }, 5000);
  });

  try {
    const res = await fetch(`${API}/chat/stats`, { signal: AbortSignal.timeout(4000) });
    const d = await res.json();
    document.getElementById('chunk-count').textContent = d.total_chunks?.toLocaleString() ?? '—';
  } catch {
    document.getElementById('chunk-count').textContent = 'offline';
  }

  // Charger la liste des produits pour le tracking
  await loadProductListForTracking();

  await window.initAvatar();
}

function setStatus(state, text) {
  document.getElementById('status-dot').className = 'status-dot ' + state;
  document.getElementById('status-text').textContent = text;
  const scene = document.querySelector('.avatar-scene');
  state === 'speaking' ? scene.classList.add('speaking') : scene.classList.remove('speaking');
}
window.setStatus = setStatus;

// Store original function BEFORE overriding
const originalStartVisit = window.startVisit;

// Create new startVisit function
window.startVisit = async function() {
    if (visitStarted) return;
    
    // Marquer comme démarré immédiatement pour éviter les doubles appels
    visitStarted = true;
    
    // Get profile ID from authenticated user
    try {
        const userRaw = localStorage.getItem('user');
        const user = userRaw ? JSON.parse(userRaw) : null;
        currentProfileId = user?.id || 2;
    } catch {
        currentProfileId = 2;
    }
    
    // Create session in Spring Boot (skip if Spring Boot not ready)
    try {
        const response = await fetch('http://localhost:8080/api/v1/sessions/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mode: MODE, profileId: currentProfileId })
        });
        
        if (response.ok) {
            const data = await response.json();
            currentSessionId = data.id;
            console.log('Session started:', currentSessionId);
        }
    } catch (error) {
        console.warn('Session start failed (Spring Boot may not be running):', error);
        // Continue anyway - session is optional
    }
    
    // Call original startVisit if it exists
    if (originalStartVisit) {
        await originalStartVisit();
    } else {
        // Fallback to original logic
        visitStarted = true;
        if (window._head?.audioCtx?.state !== 'running') {
            await window._head.audioCtx.resume();
        }
        const micBtn = document.getElementById('mic-btn');
        if (micBtn) micBtn.disabled = false;
        await loadGreeting();
    }
};

// ── Greeting ──────────────────────────────────────────────────
async function loadGreeting() {
  hideEmpty(); addTyping(); setStatus('speaking', 'Greeting…');
  try {
    const res = await fetch(`${API}/chat/mode-intro/stream?mode=${MODE}`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', fullText = '', msgEl = null;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data; try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === 'token') {
          if (!msgEl) { removeTyping(); msgEl = addAIBubble(null); }
          fullText += data.content;
          const textSpan = document.getElementById('streaming-text');
          if (textSpan) textSpan.textContent = fullText;
          scrollBottom();
        } else if (data.type === 'done') break;
      }
    }
    if (!msgEl) msgEl = addAIBubble(null);
    finalizeBubble(fullText, []); // greeting : pas de suggestions
    if (fullText) { setStatus('speaking', 'Speaking…'); await window.speakWithAvatar(fullText); }
    setStatus('', 'Ready');
  } catch (err) {
    console.error('Error loading greeting:', err);
    removeTyping();
    // Message personnalisé selon le mode commercial
    const fallback = "Bonjour délégué(e) commercial(e), comment puis-je vous aider ?";
    addAIBubble(null);
    const textSpan = document.getElementById('streaming-text');
    if (textSpan) textSpan.textContent = fallback;
    finalizeBubble(fallback, []);
    await window.speakWithAvatar(fallback);
    setStatus('', 'Ready');
  }
}

// ── Send Question (doctor input) ────────────────────────────
// ── Send Question (doctor input) ────────────────────────────
window.sendQuestion = async function() {
    const input = document.getElementById('question-input');
    const userText = input.value.trim();
    if (!userText || isLoading) return;
    
    // Log user message to conversationLog
    conversationLog.push({
        role: 'user',
        text: userText,
        timestamp: new Date().toISOString()
    });
    
    // Display user message in chat UI
    addUserMsg(userText, false);
    
    // Clear input
    input.value = '';
    input.style.height = 'auto';
    
    // Show typing indicator
    addTyping();
    setStatus('thinking', 'Thinking…');
    
    isLoading = true;
    setSend(true);
    
    try {
        // Call the RAG backend
        const res = await fetch(`${API}/chat/ask/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: userText, n_results: 10, mode: MODE })
        });
        
        if (!res.ok) throw new Error();
        
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        let sources = [];
        let msgEl = null;
        setStatus('speaking', 'Responding…');
        
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                let data;
                try {
                    data = JSON.parse(line.slice(6));
                } catch { continue; }
                if (data.type === 'token') {
                    if (!msgEl) {
                        removeTyping();
                        msgEl = addAIBubble(null);
                    }
                    fullText += data.content;
                    const textSpan = document.getElementById('streaming-text');
                    if (textSpan) textSpan.textContent = fullText;
                    scrollBottom();
                } else if (data.type === 'sources') {
                    sources = data.sources;
                }
            }
        }
        
        // Log assistant response
        conversationLog.push({
            role: 'assistant',
            text: fullText,
            sources: sources,
            timestamp: new Date().toISOString()
        });
        
        if (!msgEl) msgEl = addAIBubble(null);
        finalizeBubble(fullText, sources, userText);
        
        if (fullText) {
            await window.speakWithAvatar(fullText);
        }
        setStatus('', 'Ready');
        
    } catch (error) {
        console.error('Error:', error);
        removeTyping();
        showError('Cannot reach the API. Run: python backend/main.py');
        setStatus('', 'Ready');
    } finally {
        isLoading = false;
        setSend(false);
        document.getElementById('question-input').focus();
    }
};

// Modified openReport to use AI extraction
// const originalOpenReport = window.openReport;
window.openReport = async function() {
    if (!conversationLog.length) {
        showToast('No conversation to analyze');
        return;
    }

    const reportBtn = document.getElementById('report-btn');
    const originalText = reportBtn.innerHTML;
    reportBtn.innerHTML = 'Saving...';
    reportBtn.disabled = true;

    try {
        if (currentSessionId) {
            const token = localStorage.getItem('jwt');
            await fetch('http://localhost:8080/api/v1/sessions/end', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    profileId: currentProfileId,
                    conversation: conversationLog
                })
            });
            // We ignore the response – even if it's an error, we still show the static message
        } else {
            await fetch('http://localhost:8000/analytics/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation: conversationLog })
            });
        }
    } catch (error) {
        console.warn('Report save failed:', error);
    } finally {
        // Always show the static message
        const reportContent = document.getElementById('report-content');
        if (reportContent) {
            reportContent.innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <h3>Session terminée</h3>
                    <p>Merci d'avoir utilisé Vita. La conversation a été enregistrée.</p>
                    <p>Vous pouvez fermer cette fenêtre.</p>
                </div>
            `;
        }
        const overlay = document.getElementById('report-overlay');
        if (overlay) overlay.classList.add('open');

        reportBtn.innerHTML = originalText;
        reportBtn.disabled = false;
    }
};

// New function to display AI report
// New function to display a static message instead of the AI report
function displayAIReport(extraction) {
    const reportContent = document.getElementById('report-content');
    if (!reportContent) {
        console.error('report-content element not found');
        return;
    }
    
    // Set static message (ignore the extraction data)
    reportContent.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
            <h3>Session terminée</h3>
            <p>Merci d'avoir utilisé Vita. La conversation a été enregistrée.</p>
            <p>Vous pouvez fermer cette fenêtre.</p>
        </div>
    `;
    
    // Show the overlay
    const overlay = document.getElementById('report-overlay');
    if (overlay) {
        overlay.classList.add('open');
    }
}

window.closeReport = function() {
    const overlay = document.getElementById('report-overlay');
    if (overlay) {
        overlay.classList.remove('open');
    }
};

window.closeReportOnBg = function(e) {
    if (e.target === document.getElementById('report-overlay')) {
        closeReport();
    }
};


// ── Voice ─────────────────────────────────────────────────────
window.toggleMic = async function() {
  if (!visitStarted) await window.startVisit();
  isRecording ? stopRecording() : startRecording();
};

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream); audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = sendAudio; mediaRecorder.start(); isRecording = true;
    document.getElementById('mic-btn').classList.add('recording');
    document.getElementById('mic-label').textContent = 'Recording… click to stop';
    document.getElementById('waveform').classList.add('recording-active');
    setStatus('listening', 'Listening…');
    if (window._avatarReady && window._head?.audioCtx?.state !== 'running') await window._head.audioCtx.resume();
  } catch { showError('Microphone access denied.'); }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop()); isRecording = false;
    document.getElementById('mic-btn').classList.remove('recording');
    document.getElementById('mic-label').textContent = 'Hold to speak';
    document.getElementById('waveform').classList.remove('recording-active');
    setStatus('thinking', 'Processing…');
  }
}

async function sendAudio() {
  if (!audioChunks.length) return;
  isLoading = true; setSend(true); addTyping();
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const form = new FormData();
  form.append('audio', blob, 'rec.webm');
  form.append('mode', MODE);
  let transcript = null;
  try {
    const res = await fetch(`${API}/voice/ask/stream`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let sources = [];
    let msgEl = null;
    let transcript = null;
    setStatus('speaking', 'Responding…');

    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data; try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === 'transcript') {
          transcript = data.text;
          addUserMsg(`🎤 ${transcript}`, true);
          conversationLog.push({
            role: 'user',
            text: transcript,
            timestamp: new Date().toISOString()
          });
          removeTyping();
          addTyping();
        } else if (data.type === 'token') {
          if (!msgEl) { removeTyping(); msgEl = addAIBubble(null); }
          fullText += data.content;
          const textSpan = document.getElementById('streaming-text');
          if (textSpan) textSpan.textContent = fullText;
          scrollBottom();
        } else if (data.type === 'sources') {
          sources = data.sources;
        } else if (data.type === 'error') {
          console.error("Backend error:", data.content);
          showError(`Error: ${data.content}`);
          removeTyping();
          setStatus('', 'Ready');
          isLoading = false;
          setSend(false);
          return;
        }
      }
    }

    // Log assistant response
    if (fullText) {
      conversationLog.push({
        role: 'assistant',
        text: fullText,
        sources: sources,
        timestamp: new Date().toISOString()
      });
      
      console.log('[DEBUG] About to track products in fullText:', fullText);
      // Tracker les produits mentionnés dans la réponse de l'avatar
      trackProductMentions(fullText);
      console.log('[DEBUG] Product tracking completed');
    }

    if (msgEl) {
      finalizeBubble(fullText, sources);
    }
    
    if (fullText) {
      await window.speakWithAvatar(fullText);
    }
    setStatus('', 'Ready');
  } catch (err) {
    console.error("Voice processing error:", err);
    removeTyping(); showError('Voice processing failed.'); setStatus('', 'Ready');
  } finally { isLoading = false; setSend(false); }
}

// ── Message UI ────────────────────────────────────────────────
function hideEmpty() { document.getElementById('empty-state')?.remove(); }
function addSystemMsg(text) {
  const el = document.createElement('div'); el.className = 'system-msg';
  el.innerHTML = `<span>${esc(text)}</span>`;
  document.getElementById('messages').appendChild(el); scrollBottom();
}
function addUserMsg(text, isVoice) {
  hideEmpty(); logUser(text, isVoice);
  const el = document.createElement('div'); el.className = 'message user';
  const msgId = 'msg-' + Date.now(); el.id = msgId;
  el.innerHTML = `<div class="edit-wrap">
    <div class="bubble" data-text="${esc(text)}">${esc(text)}</div>
    <button class="edit-btn" onclick="startEdit('${msgId}',this)">edit</button>
  </div><div class="avatar-sm user">You</div>`;
  document.getElementById('messages').appendChild(el); scrollBottom(); return msgId;
}
function addTyping() {
  const el = document.createElement('div'); el.className = 'message ai'; el.id = 'typing-indicator';
  el.innerHTML = `<div class="avatar-sm ai">V</div><div class="bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  document.getElementById('messages').appendChild(el); scrollBottom();
}
function removeTyping() { const t = document.getElementById('typing-indicator'); if (t) t.remove(); }
function addAIBubble(transcriptText) {
  removeTyping();
  const el = document.createElement('div'); el.className = 'message ai';
  const tb = transcriptText ? `<div class="transcript-badge">Heard: "${esc(transcriptText)}"</div>` : '';
  el.innerHTML = `<div class="avatar-sm ai">V</div><div class="bubble" id="streaming-bubble">${tb}<span id="streaming-text"></span></div>`;
  document.getElementById('messages').appendChild(el); scrollBottom(); return el;
}

// ── finalizeBubble ────────────────────────────────────────────
function finalizeBubble(fullText, sources, userQuestion) {
  logAI(fullText, sources);
  const textEl = document.getElementById('streaming-text');
  if (textEl) {
    const html = fullText.split('\n\n').filter(p => p.trim()).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    textEl.outerHTML = html || '<p></p>';
  }
  const bubble = document.getElementById('streaming-bubble');
  if (bubble) {
    if (sources?.length) {
      bubble.removeAttribute('id');
      const tags = sources.map(s => `<span class="source-tag">${esc(s.name)}<span class="rel">${Math.round(s.relevance * 100)}%</span></span>`).join('');
      bubble.insertAdjacentHTML('beforeend', `<div class="sources"><div class="sources-label">Sources</div>${tags}</div>`);
    } else {
      bubble.removeAttribute('id');
    }
    // Suggestions — seulement si une question utilisateur est fournie
    if (fullText && userQuestion) {
      const cleanAnswer = fullText
        .replace(/questions?\s+compl[eé]mentaires?\s*:?[\s\S]*$/i, '')
        .replace(/suggestions?\s*:?[\s\S]*$/i, '')
        .trim();
      fetchAndRenderSuggestions(userQuestion, cleanAnswer || fullText, bubble); // ← "bubble" et non "finalBubble"
    }
  }
  scrollBottom();
}
function showToast(message) {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.backgroundColor = '#333';
  toast.style.color = '#fff';
  toast.style.padding = '10px 20px';
  toast.style.borderRadius = '8px';
  toast.style.zIndex = '9999';
  toast.style.fontSize = '14px';
  document.body.appendChild(toast);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ── Edit & Resend ─────────────────────────────────────────────
window.startEdit = function(msgId, btn) {
  const msgEl = document.getElementById(msgId);
  const wrap = msgEl.querySelector('.edit-wrap');
  const originalText = msgEl.querySelector('.bubble').getAttribute('data-text') || msgEl.querySelector('.bubble').textContent;
  wrap.innerHTML = `<textarea class="edit-textarea" id="edit-input-${msgId}" rows="2">${originalText}</textarea>
    <div class="edit-actions">
      <button class="edit-cancel" onclick="cancelEdit('${msgId}','${esc(originalText)}')">Cancel</button>
      <button class="edit-save"   onclick="saveEdit('${msgId}')">Send</button>
    </div>`;
  const ta = document.getElementById(`edit-input-${msgId}`);
  ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(msgId); }
    if (e.key === 'Escape') cancelEdit(msgId, originalText);
  });
};
window.cancelEdit = function(msgId, originalText) {
  const wrap = document.getElementById(msgId).querySelector('.edit-wrap');
  wrap.innerHTML = `<div class="bubble" data-text="${esc(originalText)}">${esc(originalText)}</div>
    <button class="edit-btn" onclick="startEdit('${msgId}',this)">edit</button>`;
};
window.saveEdit = function(msgId) {
  const ta = document.getElementById(`edit-input-${msgId}`);
  const newText = ta.value.trim(); if (!newText) return;
  const wrap = document.getElementById(msgId).querySelector('.edit-wrap');
  wrap.innerHTML = `<div class="bubble" data-text="${esc(newText)}">${esc(newText)}</div>
    <button class="edit-btn" onclick="startEdit('${msgId}',this)">edit</button>`;
  let next = document.getElementById(msgId).nextElementSibling;
  while (next) { const rm = next; next = next.nextElementSibling; rm.remove(); }
  resendQuestion(newText);
};

async function resendQuestion(userText) {
  if (!visitStarted) await window.startVisit();
  isLoading = true; setSend(true); addTyping(); setStatus('thinking', 'Thinking…');
  try {
    const res = await fetch(`${API}/chat/ask/stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: userText, n_results: 10, mode: MODE })
    });
    if (!res.ok) throw new Error();
    const reader = res.body.getReader(); const decoder = new TextDecoder();
    let buffer = '', full = '', sources = [], msgEl = null;
    setStatus('speaking', 'Responding…');
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let c; try { c = JSON.parse(line.slice(6)); } catch { continue; }
        if (c.type === 'token') {
          if (!msgEl) { removeTyping(); msgEl = addAIBubble(null); }
          full += c.content;
          const textSpan = document.getElementById('streaming-text');
          if (textSpan) textSpan.textContent = full;
          scrollBottom();
        } else if (c.type === 'sources') sources = c.sources;
      }
    }
    if (!msgEl) msgEl = addAIBubble(null);
    finalizeBubble(full, sources, userText);
    if (full) await window.speakWithAvatar(full);
    setStatus('', 'Ready');
  } catch {
    removeTyping(); showError('Cannot reach the API.'); setStatus('', 'Ready');
  } finally { isLoading = false; setSend(false); }
}

// ── Log + Report ──────────────────────────────────────────────
const conversationLog = [];
window.conversationLog = conversationLog;
function logUser(text, isVoice) {
  conversationLog.push({ role: 'user', text, isVoice: !!isVoice, time: new Date() });
  document.getElementById('report-btn').disabled = false;
  document.getElementById('mindmap-btn')?.removeAttribute('disabled');
}
function logAI(text, sources) {
  conversationLog.push({ role: 'assistant', text, sources: sources || [], time: new Date() });
}
window.closeReport = function() {
  document.getElementById('report-overlay').classList.remove('open');
};
window.closeReportOnBg = function(e) {
  if (e.target === document.getElementById('report-overlay')) closeReport();
};
function buildReportContent() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const products = [...new Set(conversationLog.flatMap(e => (e.sources || []).map(s => s.name)))].filter(Boolean);
  const userCount = conversationLog.filter(e => e.role === 'user').length;
  const aiCount = conversationLog.filter(e => e.role === 'assistant').length;
  const exchangesHtml = conversationLog.map(entry => {
    if (entry.role === 'user') return `<div class="r-exchange user-ex"><div class="r-role user-role">Doctor ${entry.isVoice ? '(voice)' : '(text)'}</div><div class="r-text">${entry.isVoice ? '🎤 ' : ''}${escHtml(entry.text)}</div></div>`;
    const tags = entry.sources?.length ? `<div class="r-products">${entry.sources.map(s => `<span class="r-product-tag">${escHtml(s.name)}</span>`).join('')}</div>` : '';
    return `<div class="r-exchange ai-ex"><div class="r-role ai-role">Vita (Delegate)</div><div class="r-text">${escHtml(entry.text)}</div>${tags}</div>`;
  }).join('');
  const prodHtml = products.length ? `<div class="r-section-title">Products discussed</div><div class="r-products">${products.map(p => `<span class="r-product-tag">${escHtml(p)}</span>`).join('')}</div>` : '';
  document.getElementById('report-content').innerHTML = `
    <div class="r-header"><div class="r-logo">VITAL Commercial Visit</div><div class="r-subtitle">Session with Vita — Delegate</div>
    <div class="r-meta">
      <div class="r-meta-item"><strong>Date</strong><span>${dateStr} at ${timeStr}</span></div>
      <div class="r-meta-item"><strong>Exchanges</strong><span>${userCount} doctor · ${aiCount} Vita</span></div>
      <div class="r-meta-item"><strong>Products discussed</strong><span>${products.length || 'None'}</span></div>
    </div></div>
    ${prodHtml}
    <div class="r-section-title">Full conversation</div>${exchangesHtml}
    <div class="r-footer"><span>Generated by VitalAgent · VITAL SA</span><span>${dateStr}</span></div>`;
}

function escHtml(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ── Helpers ───────────────────────────────────────────────────
function showError(msg) {
  removeTyping();
  const el = document.createElement('div'); el.className = 'message ai';
  el.innerHTML = `<div class="avatar-sm ai" style="background:#7f1d1d">!</div><div class="bubble" style="border-color:rgba(239,68,68,0.2);background:rgba(239,68,68,0.05)"><p style="color:#fca5a5">${esc(msg)}</p></div>`;
  document.getElementById('messages').appendChild(el); scrollBottom();
}
window.handleKey = function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendQuestion(); } };
window.autoResize = function(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; };
function setSend(d) { document.getElementById('send-btn').disabled = d; }
function scrollBottom() { const el = document.getElementById('messages'); el.scrollTop = el.scrollHeight; }
function esc(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ── Suggestions adaptives (déclarées UNE SEULE FOIS) ─────────
async function fetchAndRenderSuggestions(userQuestion, aiAnswer, bubbleEl) {
  if (!userQuestion || !aiAnswer || !bubbleEl) return;

  const mode = MODE;

  const arabicRatio = (aiAnswer.match(/[\u0600-\u06FF]/g) || []).length / Math.max(aiAnswer.length, 1);
  const lang = arabicRatio > 0.15 ? 'ar'
    : /\b(the|is|are|what|how|does|give|tell)\b/i.test(aiAnswer) ? 'en'
    : 'fr';

  const wrapId = 'suggest-wrap-' + Date.now();
  bubbleEl.insertAdjacentHTML('beforeend', `
    <div class="suggestions-wrap commercial" id="${wrapId}">
      <div class="suggestions-label">Suggestions</div>
      <div class="suggestions-loading">
        <div class="mini-dots"><span></span><span></span><span></span></div>
        <span style="font-size:11px;color:var(--text-dim)">Génération…</span>
      </div>
    </div>
  `);
  scrollBottom();

  try {
    const res = await fetch(`${API}/chat/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: userQuestion, answer: aiAnswer, mode, lang, n: 3 }),
      signal: AbortSignal.timeout(15000),
    });
    const data = res.ok ? await res.json() : null;
    const suggestions = data?.suggestions || [];
    const wrapEl = document.getElementById(wrapId);
    if (!wrapEl) return;
    if (!suggestions.length) { wrapEl.remove(); return; }
    const chipsHtml = suggestions
      .map(s => `<button class="suggestion-chip" onclick="applySuggestion(this)">${esc(s)}</button>`)
      .join('');
    wrapEl.innerHTML = `
      <div class="suggestions-label">Questions suggérées</div>
      <div class="suggestions-chips">${chipsHtml}</div>
    `;
    scrollBottom();
  } catch (err) {
    console.warn('[suggestions]', err);
    const wrapEl = document.getElementById(wrapId);
    if (wrapEl) wrapEl.remove();
  }
}

window.applySuggestion = function(btn) {
  const text = btn.textContent.trim(); if (!text) return;
  const input = document.getElementById('question-input');
  if (input) { input.value = text; autoResize(input); input.focus(); }
  const wrap = btn.closest('.suggestions-wrap');
  if (wrap) {
    wrap.querySelectorAll('.suggestion-chip').forEach(c => {
      c.disabled = true; c.style.opacity = '0.4'; c.style.cursor = 'default';
    });
    btn.style.opacity = '1';
    btn.style.background = 'rgb(183 252 132 / 18%)';
    btn.style.borderColor = 'rgb(75 95 70 / 60%)';
  }
  window.sendQuestion();
};

// Fonction pour vérifier manuellement l'état du localStorage
window.checkProductMentions = function() {
    try {
        const stored = localStorage.getItem(PRODUCT_MENTIONS_KEY);
        const mentions = stored ? JSON.parse(stored) : {};
        console.log('[CHECK] Current product mentions:', mentions);
        console.log('[CHECK] Total mentions:', Object.values(mentions).reduce((sum, count) => sum + count, 0));
        return mentions;
    } catch (e) {
        console.error('[CHECK] Error:', e);
        return {};
    }
};

// Fonction pour effacer les mentions de produits
window.clearProductMentions = function() {
    localStorage.removeItem(PRODUCT_MENTIONS_KEY);
    console.log('[CHECK] Product mentions cleared');
};

// Fonction de test pour vérifier le tracking manuellement
window.testProductTracking = function() {
    console.log('[TEST] Testing product tracking...');
    
    // Tester avec un texte contenant "Dermalo"
    const testText = "Je vous recommande le produit Dermalo qui est excellent pour la peau.";
    console.log('[TEST] Test text:', testText);
    
    // Appeler la fonction de tracking
    trackProductMentions(testText);
    
    // Vérifier le résultat
    const result = window.checkProductMentions();
    console.log('[TEST] Final result:', result);
    
    return result;
};

// Fonction pour forcer l'actualisation du dashboard
window.refreshDashboardProducts = function() {
    console.log('[REFRESH] Forcing dashboard refresh...');
    
    // Envoyer un événement personnalisé pour actualiser le dashboard
    window.dispatchEvent(new CustomEvent('productMentionsUpdated', {
        detail: {
            mentions: window.checkProductMentions(),
            timestamp: new Date().toISOString()
        }
    }));
};

init();
