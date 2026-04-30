const API = 'http://localhost:8000';
window._API = API;

let isLoading = false, isRecording = false;
let mediaRecorder = null, audioChunks = [];
let allProducts = [], selectedProduct = null, selectedProductData = null;
let trainingMode = null;
let currentSessionId = null;
const PRODUCT_MENTIONS_STORAGE_KEY = 'vita_product_mentions';
const EVALUATIONS_STORAGE_KEY = 'vita_evaluations_count';

// ── Init ──────────────────────────────────────────────────────
async function init() {
  setStatus('loading', 'Loading avatar…');

  await new Promise(resolve => {
    const t = setInterval(() => { if (window.initAvatar) { clearInterval(t); resolve(); } }, 30);
    setTimeout(() => { clearInterval(t); resolve(); }, 5000);
  });

  const avatarP = window.initAvatar();
  try {
    const res = await fetch(`${API}/chat/stats`, { signal: AbortSignal.timeout(4000) });
    const d   = await res.json();
    document.getElementById('chunk-count').textContent = d.total_chunks?.toLocaleString() ?? '—';
  } catch { document.getElementById('chunk-count').textContent = 'offline'; }

  await loadProducts();
  await avatarP;
  await loadGreeting();
}

function getCurrentProfileId() {
  try {
    const userRaw = localStorage.getItem('user');
    if (!userRaw) return null;
    const user = JSON.parse(userRaw);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function startTrainingSession(mode) {
  const profileId = getCurrentProfileId();
  if (!profileId || !mode || currentSessionId) return;
  try {
    const res = await fetch('http://localhost:8080/api/v1/sessions/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, profileId })
    });
    if (res.ok) {
      const data = await res.json();
      currentSessionId = data.id || null;
    }
  } catch (e) {
    console.warn('Session tracking start failed:', e);
  }
}

function setStatus(state, text) {
  document.getElementById('status-dot').className   = 'status-dot ' + state;
  document.getElementById('status-text').textContent = text;
  const scene = document.querySelector('.avatar-scene');
  state === 'speaking' ? scene.classList.add('speaking') : scene.classList.remove('speaking');
}

// ── Mode intro ────────────────────────────────────────────────
async function streamModeIntro(mode) {
  addTyping(); setStatus('speaking', 'Responding…');
  try {
    const res = await fetch(`${API}/chat/mode-intro/stream?mode=${mode}`);
    if (!res.ok) throw new Error();
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf='', msgEl=null, full='';
    while (true) {
      const {value,done} = await reader.read(); if (done) break;
      buf += dec.decode(value,{stream:true});
      const lines = buf.split('\n\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let c; try{c=JSON.parse(line.slice(6))}catch{continue}
        if (c.type==='token') { if(!msgEl) msgEl=addAIBubble(null); const el=document.getElementById('streaming-text'); if(el){full+=c.content;el.textContent=full;scrollBottom();} }
        else if (c.type==='done') break;
      }
    }
    if (!msgEl) msgEl = addAIBubble(null);
    finalizeBubble(full, []);   // greeting : pas de suggestions
    if (full) { setStatus('speaking','Speaking…'); await window.speakWithAvatar(full); }
    setStatus('','Ready');
  } catch { document.getElementById('typing-indicator')?.remove(); setStatus('','Ready'); }
}

// ── Greeting ──────────────────────────────────────────────────
async function loadGreeting() {
  hideEmpty(); addTyping(); setStatus('speaking','Greeting…');
  try {
    const res = await fetch(`${API}/chat/greeting/stream`, {signal:AbortSignal.timeout(60000)});
    if (!res.ok) throw new Error();
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf='', msgEl=null, full='';
    while (true) {
      const {value,done} = await reader.read(); if (done) break;
      buf += dec.decode(value,{stream:true});
      const lines = buf.split('\n\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let c; try{c=JSON.parse(line.slice(6))}catch{continue}
        if (c.type==='token') { if(!msgEl) msgEl=addAIBubble(null); const el=document.getElementById('streaming-text'); if(el){full+=c.content;el.textContent=full;scrollBottom();} }
        else if (c.type==='done') break;
      }
    }
    if (!msgEl) msgEl = addAIBubble(null);
    const textEl = document.getElementById('streaming-text');
    if (textEl) {
      textEl.outerHTML = full.split('\n\n').filter(p=>p.trim()).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('') || '<p></p>';
    }
    const bubble = document.getElementById('streaming-bubble');
    if (bubble) {
      bubble.removeAttribute('id');
      bubble.insertAdjacentHTML('beforeend',`
        <div class="mode-select-btns">
          <button class="mode-btn medical"    onclick="setMode('medical')">🩺 Medical delegate</button>
          <button class="mode-btn commercial" onclick="setMode('commercial')">💼 Commercial delegate</button>
        </div>`);
    }
    if (full) { setStatus('speaking','Speaking…'); await window.speakWithAvatar(full); }
    setStatus('','Ready');
  } catch {
    document.getElementById('typing-indicator')?.remove();
    addAIBubble(null);
    const bubble = document.getElementById('streaming-bubble');
    if (bubble) {
      bubble.removeAttribute('id');
      bubble.innerHTML = `<p>Bonjour ! Je suis Dr. Layla, votre assistante de formation produits. Comment souhaitez-vous apprendre aujourd'hui ?</p>
        <div class="mode-select-btns">
          <button class="mode-btn medical"    onclick="setMode('medical')">🩺 Medical delegate</button>
          <button class="mode-btn commercial" onclick="setMode('commercial')">💼 Commercial delegate</button>
        </div>`;
    }
    setStatus('','Ready');
  }
}

function setMode(mode) {
  trainingMode = mode;
  startTrainingSession(mode);
  const badge = document.getElementById('mode-badge');
  if (badge) {
    badge.style.display = 'inline-block';
    badge.className = `mode-badge ${mode}`;
    badge.textContent = mode==='medical' ? '🩺 Medical' : '💼 Commercial';
  }
  document.querySelectorAll('.mode-select-btns').forEach(el=>el.remove());
  addSystemMsg(mode==='medical'
    ? 'Mode: Medical delegate — deep product knowledge training'
    : 'Mode: Commercial delegate — sales & persuasion training');
  if (selectedProduct) renderChips(buildDynamicChips(selectedProduct, selectedProductData));
  document.getElementById('question-input').placeholder = 'Select a product to begin…';
  
  // Message personnalisé selon le mode choisi
  const customGreeting = mode === 'medical' 
    ? "Bonjour délégué(e) médicale, comment puis-je vous aider ?"
    : "Bonjour délégué(e) commercial(e), comment puis-je vous aider ?";
  
  // Afficher le message personnalisé
  showCustomGreeting(customGreeting);
}

// Afficher un message de greeting personnalisé
async function showCustomGreeting(text) {
  hideEmpty();
  const msgEl = addAIBubble(null);
  const bubble = document.getElementById('streaming-bubble');
  if (bubble) {
    bubble.innerHTML = `<p>${esc(text)}</p>`;
    bubble.removeAttribute('id');
  }
  setStatus('speaking', 'Speaking…');
  await window.speakWithAvatar(text);
  setStatus('', 'Ready');
}

// ── Produits ──────────────────────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch(`${API}/products`, {signal:AbortSignal.timeout(5000)});
    if (res.ok) { const d = await res.json(); allProducts = d.products || []; }
  } catch {
    allProducts = ["LV PSOCALM","FerBiotic Lipo","Pulmax Kids","Pulmax Anti-Tussif","Pédiakids trio",
      "PHYTOFANE Antipelliculaire","MULTIBON VITAMINE C Acérola","Allergiplant","LV Vitamine D3",
      "DermaGyn","Uniderme peau sensible","Mincivit Detox"].sort();
  }
  renderProductList(allProducts);
}

async function fetchProductData(name) {
  try {
    const res = await fetch(`${API}/products/${encodeURIComponent(name)}`, {signal:AbortSignal.timeout(4000)});
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

function buildDynamicChips(name, productData) {
  const desc = (productData?.description||'').toLowerCase();
  const isMedical = trainingMode !== 'commercial';
  if (isMedical) {
    const chips = [`What is ${name} used for?`, `Tell me everything about ${name}`];
    if (desc.includes('composition')||desc.includes('extrait')||desc.includes('vitamine')||desc.includes('mg'))
      chips.push(`What is the composition of ${name}?`);
    if (desc.includes('forme')||desc.includes('gélule')||desc.includes('sirop')||desc.includes('crème'))
      chips.push(`What form is ${name} available in?`);
    if (desc.includes('enfant')||desc.includes('nourrisson')||desc.includes('adulte'))
      chips.push(`Who can use ${name}?`);
    if (desc.includes('sans sucre')||desc.includes('diabétique'))
      chips.push(`Is ${name} suitable for diabetics?`);
    chips.push(`What medical questions should I expect about ${name}?`);
    return chips.slice(0,6).map(l=>({label:l}));
  } else {
    return [
      {label:`How do I pitch ${name} to a pharmacy?`},
      {label:`What are the key selling points of ${name}?`},
      {label:`How does ${name} compare to competitors?`},
      {label:`What objections will I face selling ${name}?`},
      {label:`Who is the ideal customer for ${name}?`},
      {label:`Give me a sales script for ${name}`},
    ].slice(0,6);
  }
}

function renderChips(chips) {
  const c = document.getElementById('quick-chips');
  c.innerHTML = chips.map(c=>`<div class="quick-chip" onclick="askQuick(this)">${esc(c.label)}</div>`).join('');
  c.classList.remove('hidden');
}

// ── Modal produit ─────────────────────────────────────────────
function openModal() {
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('product-search').value = '';
  renderProductList(allProducts);
  setTimeout(()=>document.getElementById('product-search').focus(),100);
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function closeModalOnBg(e) { if (e.target===document.getElementById('modal-overlay')) closeModal(); }
function filterProducts(q) {
  renderProductList(q.trim() ? allProducts.filter(p=>p.toLowerCase().includes(q.toLowerCase())) : allProducts);
}
function renderProductList(products) {
  document.getElementById('product-list').innerHTML = products.map(p=>
    `<div class="product-item ${selectedProduct===p?'selected':''}" onclick="selectProduct('${esc(p)}')">
      <div class="dot"></div>${esc(p)}</div>`).join('');
  document.getElementById('product-count').textContent = `${products.length} product${products.length!==1?'s':''}`;
}
async function selectProduct(name) {
  selectedProduct = name; closeModal();
  const badge = document.getElementById('product-badge');
  badge.className = 'active-product-badge';
  badge.innerHTML = `<span>◈</span><span class="badge-name">${esc(name)}</span><span style="color:var(--text-dim);font-size:10px;flex-shrink:0">change</span>`;
  document.getElementById('context-bar').classList.remove('hidden');
  document.getElementById('ctx-product-name').textContent = name;
  document.getElementById('question-input').placeholder = `Ask about ${name}…`;
  hideEmpty(); addSystemMsg(`Now asking about: ${name}`);
  const pd = await fetchProductData(name); selectedProductData = pd;
  renderChips(buildDynamicChips(name, pd));
}

function incrementEvaluationCounter() {
  try {
    const raw = localStorage.getItem(EVALUATIONS_STORAGE_KEY);
    const current = Number(raw || 0);
    const next = Number.isFinite(current) ? current + 1 : 1;
    localStorage.setItem(EVALUATIONS_STORAGE_KEY, String(next));
  } catch {}
}

function trackProductMention(name) {
  if (!name) return;
  try {
    const normalizedName = String(name).trim();
    if (!normalizedName) return;
    const raw = localStorage.getItem(PRODUCT_MENTIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const current = Number(parsed[normalizedName] || 0);
    parsed[normalizedName] = Number.isFinite(current) ? current + 1 : 1;
    localStorage.setItem(PRODUCT_MENTIONS_STORAGE_KEY, JSON.stringify(parsed));
  } catch {}
}

function askQuick(btn) {
  if (!selectedProduct) { openModal(); return; }
  document.getElementById('question-input').value = btn.textContent;
  sendQuestion();
}

// ── Messages ──────────────────────────────────────────────────
function hideEmpty() { document.getElementById('empty-state')?.remove(); }
function addSystemMsg(text) {
  const el = document.createElement('div'); el.className='system-msg';
  el.innerHTML=`<span>${esc(text)}</span>`;
  document.getElementById('messages').appendChild(el); scrollBottom();
}
function addUserMsg(text, isVoice) {
  hideEmpty(); logUser(text, isVoice);
  const el = document.createElement('div'); el.className='message user';
  const msgId = 'msg-'+Date.now(); el.id = msgId;
  el.innerHTML=`<div class="edit-wrap">
    <div class="bubble" data-text="${esc(text)}">${esc(text)}</div>
    <button class="edit-btn" onclick="startEdit('${msgId}',this)">edit</button>
  </div><div class="avatar-sm user">You</div>`;
  document.getElementById('messages').appendChild(el); scrollBottom(); return msgId;
}
function addTyping() {
  const el = document.createElement('div'); el.className='message ai'; el.id='typing-indicator';
  el.innerHTML=`<div class="avatar-sm ai">L</div><div class="bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  document.getElementById('messages').appendChild(el); scrollBottom();
}
function addAIBubble(transcriptText) {
  document.getElementById('typing-indicator')?.remove();
  const el = document.createElement('div'); el.className='message ai';
  const tb = transcriptText ? `<div class="transcript-badge">Heard: "${esc(transcriptText)}"</div>` : '';
  el.innerHTML=`<div class="avatar-sm ai">L</div><div class="bubble" id="streaming-bubble">${tb}<span id="streaming-text"></span></div>`;
  document.getElementById('messages').appendChild(el); scrollBottom(); return el;
}

// ── finalizeBubble ────────────────────────────────────────────
function finalizeBubble(fullText, sources, userQuestion) {
  logAI(fullText, sources);
  const textEl = document.getElementById('streaming-text');
  if (textEl) {
    const html = fullText.split('\n\n').filter(p=>p.trim()).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
    textEl.outerHTML = html || '<p></p>';
  }
  const bubble = document.getElementById('streaming-bubble');
  if (bubble) {
    if (sources?.length) {
      bubble.removeAttribute('id');
      const tags = sources.map(s=>`<span class="source-tag">${esc(s.name)}<span class="rel">${Math.round(s.relevance*100)}%</span></span>`).join('');
      bubble.insertAdjacentHTML('beforeend',`<div class="sources"><div class="sources-label">Sources</div>${tags}</div>`);
    } else {
      bubble.removeAttribute('id');
    }
    // Suggestions adaptives — seulement si une question utilisateur est fournie
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

// ── Send question ─────────────────────────────────────────────
async function sendQuestion() {
  const input = document.getElementById('question-input');
  const userText = input.value.trim(); if (!userText||isLoading) return;
  let ragQuestion = userText;
  if (selectedProduct && !userText.toLowerCase().includes(selectedProduct.toLowerCase()))
    ragQuestion = `${userText} — product: ${selectedProduct}`;
  if (selectedProduct) trackProductMention(selectedProduct);
  incrementEvaluationCounter();
  isLoading=true; setSend(true); input.value=''; input.style.height='auto';
  addUserMsg(userText); addTyping(); setStatus('thinking','Thinking…');
  try {
    const res = await fetch(`${API}/chat/ask/stream`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:ragQuestion,n_results:10,mode:trainingMode||'medical'})
    });
    if (!res.ok) throw new Error();
    const reader=res.body.getReader(), dec=new TextDecoder();
    let buf='', msgEl=null, full='', sources=[];
    setStatus('speaking','Responding…');
    while (true) {
      const {value,done}=await reader.read(); if(done) break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\n\n'); buf=lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let c; try{c=JSON.parse(line.slice(6))}catch{continue}
        if (c.type==='token'){if(!msgEl)msgEl=addAIBubble(null);const el=document.getElementById('streaming-text');if(el){full+=c.content;el.textContent=full;scrollBottom();}}
        else if (c.type==='sources') sources=c.sources;
      }
    }
    if (!msgEl) msgEl=addAIBubble(null);
    finalizeBubble(full, sources, ragQuestion);
    if (full) { setStatus('speaking','Speaking…'); await window.speakWithAvatar(full); }
    setStatus('','Ready');
  } catch {
    document.getElementById('typing-indicator')?.remove();
    showError('Cannot reach the API. Run: python backend/main.py');
    setStatus('','Ready');
  } finally { isLoading=false; setSend(false); document.getElementById('question-input').focus(); }
}

// ── Voice ─────────────────────────────────────────────────────
async function toggleMic() { isRecording ? stopRecording() : startRecording(); }
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    mediaRecorder=new MediaRecorder(stream); audioChunks=[];
    mediaRecorder.ondataavailable=e=>audioChunks.push(e.data);
    mediaRecorder.onstop=sendAudio; mediaRecorder.start(); isRecording=true;
    document.getElementById('mic-btn').classList.add('recording');
    document.getElementById('mic-label').textContent='Recording… click to stop';
    document.getElementById('waveform').classList.add('recording-active');
    setStatus('listening','Listening…');
    if (window._avatarReady && window._head?.audioCtx?.state!=='running') await window._head.audioCtx.resume();
  } catch { showError('Microphone access denied.'); }
}
function stopRecording() {
  if (mediaRecorder&&isRecording) {
    mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t=>t.stop()); isRecording=false;
    document.getElementById('mic-btn').classList.remove('recording');
    document.getElementById('mic-label').textContent='Hold to speak';
    document.getElementById('waveform').classList.remove('recording-active');
    setStatus('thinking','Processing…');
  }
}
async function sendAudio() {
  if (!audioChunks.length) return;
  isLoading=true; setSend(true); addTyping();
  const blob=new Blob(audioChunks,{type:'audio/webm'});
  const form=new FormData(); form.append('audio',blob,'rec.webm');
  let voiceQuestion = ''; // ← variable correcte
  try {
    const res=await fetch(`${API}/voice/ask/stream`,{method:'POST',body:form});
    if (!res.ok) throw new Error();
    const reader=res.body.getReader(), dec=new TextDecoder();
    let buf='', msgEl=null, full='', sources=[];
    setStatus('speaking','Responding…');
    while (true) {
      const {value,done}=await reader.read(); if(done) break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\n\n'); buf=lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let c; try{c=JSON.parse(line.slice(6))}catch{continue}
        if (c.type==='transcript') {
          voiceQuestion = c.text; // ← stocké ici
          const heard=c.text.toLowerCase().trim();
          if (!trainingMode) {
            const isMed=/médic|medical|clinique|docteur|pharmacien|scientif/.test(heard);
            const isCom=/commerc|vente|vend|client|convaincre|sales|business/.test(heard);
            if (isMed){addUserMsg(`🎤 ${c.text}`,true);document.getElementById('typing-indicator')?.remove();setMode('medical');addTyping();return;}
            if (isCom){addUserMsg(`🎤 ${c.text}`,true);document.getElementById('typing-indicator')?.remove();setMode('commercial');addTyping();return;}
          }
          addUserMsg(`🎤 ${c.text}`,true);
          document.getElementById('typing-indicator')?.remove(); addTyping();
        } else if (c.type==='token'){
          if(!msgEl)msgEl=addAIBubble(null);const el=document.getElementById('streaming-text');if(el){full+=c.content;el.textContent=full;scrollBottom();}
        } else if (c.type==='sources') sources=c.sources;
      }
    }
    if (!msgEl) msgEl=addAIBubble(null);
    finalizeBubble(full, sources, voiceQuestion); // ← "voiceQuestion" et non "question"
    if (full){setStatus('speaking','Speaking…');await window.speakWithAvatar(full);}
    setStatus('','Ready');
  } catch {
    document.getElementById('typing-indicator')?.remove();
    showError('Voice processing failed.'); setStatus('','Ready');
  } finally { isLoading=false; setSend(false); }
}

// ── Edit ──────────────────────────────────────────────────────
function startEdit(msgId, btn) {
  const msgEl=document.getElementById(msgId);
  const wrap=msgEl.querySelector('.edit-wrap');
  const originalText=msgEl.querySelector('.bubble').getAttribute('data-text')||msgEl.querySelector('.bubble').textContent;
  wrap.innerHTML=`<textarea class="edit-textarea" id="edit-input-${msgId}" rows="2">${originalText}</textarea>
    <div class="edit-actions">
      <button class="edit-cancel" onclick="cancelEdit('${msgId}','${esc(originalText)}')">Cancel</button>
      <button class="edit-save"   onclick="saveEdit('${msgId}')">Send</button>
    </div>`;
  const ta=document.getElementById(`edit-input-${msgId}`);
  ta.style.height='auto'; ta.style.height=ta.scrollHeight+'px';
  ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length);
  ta.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();saveEdit(msgId);}
    if(e.key==='Escape') cancelEdit(msgId,originalText);
  });
}
function cancelEdit(msgId,originalText) {
  const wrap=document.getElementById(msgId).querySelector('.edit-wrap');
  wrap.innerHTML=`<div class="bubble" data-text="${esc(originalText)}">${esc(originalText)}</div>
    <button class="edit-btn" onclick="startEdit('${msgId}',this)">edit</button>`;
}
function saveEdit(msgId) {
  const ta=document.getElementById(`edit-input-${msgId}`);
  const newText=ta.value.trim(); if(!newText) return;
  const wrap=document.getElementById(msgId).querySelector('.edit-wrap');
  wrap.innerHTML=`<div class="bubble" data-text="${esc(newText)}">${esc(newText)}</div>
    <button class="edit-btn" onclick="startEdit('${msgId}',this)">edit</button>`;
  let next=document.getElementById(msgId).nextElementSibling;
  while(next){const rm=next;next=next.nextElementSibling;rm.remove();}
  resendQuestion(newText);
}
async function resendQuestion(userText) {
  let ragQuestion=userText;
  if(selectedProduct&&!userText.toLowerCase().includes(selectedProduct.toLowerCase()))
    ragQuestion=`${userText} — product: ${selectedProduct}`;
  if (selectedProduct) trackProductMention(selectedProduct);
  incrementEvaluationCounter();
  isLoading=true; setSend(true); addTyping(); setStatus('thinking','Thinking…');
  try {
    const res=await fetch(`${API}/chat/ask/stream`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:ragQuestion,n_results:10,mode:trainingMode||'medical'})});
    if(!res.ok) throw new Error();
    const reader=res.body.getReader(),dec=new TextDecoder();
    let buf='',msgEl=null,full='',sources=[];
    setStatus('speaking','Responding…');
    while(true){
      const {value,done}=await reader.read();if(done)break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\n\n');buf=lines.pop();
      for(const line of lines){
        if(!line.startsWith('data: '))continue;
        let c;try{c=JSON.parse(line.slice(6))}catch{continue}
        if(c.type==='token'){if(!msgEl)msgEl=addAIBubble(null);const el=document.getElementById('streaming-text');if(el){full+=c.content;el.textContent=full;scrollBottom();}}
        else if(c.type==='sources') sources=c.sources;
      }
    }
    if(!msgEl) msgEl=addAIBubble(null);
    finalizeBubble(full, sources, ragQuestion);
    if(full){setStatus('speaking','Speaking…');await window.speakWithAvatar(full);}
    setStatus('','Ready');
  } catch {
    document.getElementById('typing-indicator')?.remove();
    showError('Cannot reach the API.'); setStatus('','Ready');
  } finally { isLoading=false; setSend(false); }
}

// ── Log + Rapport ─────────────────────────────────────────────
const conversationLog=[];
window.conversationLog = conversationLog;
function logUser(text,isVoice){
  conversationLog.push({role:'user',text,isVoice:!!isVoice,time:new Date()});
  document.getElementById('report-btn').disabled=false;
  document.getElementById('mindmap-btn')?.removeAttribute('disabled');
}
function logAI(text,sources){ conversationLog.push({role:'ai',text,sources:sources||[],time:new Date()}); }

function openReport(){if(!conversationLog.length)return;buildReportContent();document.getElementById('report-overlay').classList.add('open');}
function closeReport(){document.getElementById('report-overlay').classList.remove('open');}
function closeReportOnBg(e){if(e.target===document.getElementById('report-overlay'))closeReport();}

function buildReportContent(){
  const now=new Date();
  const dateStr=now.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const timeStr=now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  const modeLabel=trainingMode==='commercial'?'Commercial Delegate':'Medical Delegate';
  const modeColor=trainingMode==='commercial'?'#b45309':'#1d4ed8';
  const products=[...new Set(conversationLog.flatMap(e=>(e.sources||[]).map(s=>s.name)))].filter(Boolean);
  const userCount=conversationLog.filter(e=>e.role==='user').length;
  const aiCount=conversationLog.filter(e=>e.role==='ai').length;
  const exchangesHtml=conversationLog.map(entry=>{
    if(entry.role==='user') return `<div class="r-exchange user-ex"><div class="r-role user-role">Delegate ${entry.isVoice?'(voice)':'(text)'}</div><div class="r-text">${entry.isVoice?'🎤 ':''}${escHtml(entry.text)}</div></div>`;
    const tags=entry.sources?.length?`<div class="r-products">${entry.sources.map(s=>`<span class="r-product-tag">${escHtml(s.name)}</span>`).join('')}</div>`:'';
    return `<div class="r-exchange ai-ex"><div class="r-role ai-role">Vita</div><div class="r-text">${escHtml(entry.text)}</div>${tags}</div>`;
  }).join('');
  const prodHtml=products.length?`<div class="r-section-title">Products covered</div><div class="r-products">${products.map(p=>`<span class="r-product-tag">${escHtml(p)}</span>`).join('')}</div>`:'';
  document.getElementById('report-content').innerHTML=`
    <div class="r-header"><div class="r-logo">VitalAgent</div><div class="r-subtitle">Training Session Report — Powered by Vita AI</div>
    <div class="r-meta">
      <div class="r-meta-item"><strong>Date</strong><span>${dateStr} at ${timeStr}</span></div>
      <div class="r-meta-item"><strong>Training mode</strong><span style="color:${modeColor};font-weight:600">${modeLabel}</span></div>
      <div class="r-meta-item"><strong>Exchanges</strong><span>${userCount} questions · ${aiCount} responses</span></div>
      <div class="r-meta-item"><strong>Products discussed</strong><span>${products.length||'None selected'}</span></div>
    </div></div>
    ${prodHtml}
    <div class="r-section-title">Full conversation</div>${exchangesHtml}
    <div class="r-footer"><span>Generated by VitalAgent · Vita AI Trainer</span><span>${dateStr}</span></div>`;
}

function downloadReport(){
  const content=document.getElementById('report-content');
  const now=new Date();
  const win=window.open('','_blank','width=800,height=900');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>vita-report-${now.toISOString().slice(0,10)}.pdf</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Georgia,serif;color:#111;background:#fff}
    #report-content{padding:32px 40px;font-size:13px;line-height:1.7}
    .r-header{border-bottom:2px solid #1d4ed8;padding-bottom:18px;margin-bottom:24px}
    .r-logo{font-size:26px;color:#1d4ed8}.r-subtitle{font-size:11px;color:#6b7280;margin-top:3px;font-family:system-ui}
    .r-meta{display:flex;gap:20px;margin-top:14px;flex-wrap:wrap}.r-meta-item{font-size:11px;font-family:system-ui}
    .r-meta-item strong{display:block;font-size:9px;text-transform:uppercase;color:#374151;margin-bottom:1px}
    .r-section-title{font-size:10px;text-transform:uppercase;color:#6b7280;font-family:system-ui;font-weight:600;margin:24px 0 10px;border-bottom:1px solid #e5e7eb;padding-bottom:5px}
    .r-exchange{margin-bottom:16px;padding:12px 16px;border-radius:6px;border-left:3px solid #e5e7eb;page-break-inside:avoid}
    .r-exchange.user-ex{background:#f8faff;border-left-color:#1d4ed8}.r-exchange.ai-ex{background:#fafafa;border-left-color:#6b7280}
    .r-role{font-size:9px;text-transform:uppercase;font-family:system-ui;font-weight:600;margin-bottom:5px}
    .r-role.user-role{color:#1d4ed8}.r-role.ai-role{color:#374151}
    .r-text{font-size:12px;line-height:1.6;color:#1f2937}
    .r-products{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
    .r-product-tag{padding:2px 8px;border-radius:10px;font-size:10px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;font-family:system-ui}
    .r-footer{margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;font-family:system-ui;display:flex;justify-content:space-between}
    @page{margin:1.5cm}</style></head><body>${content.outerHTML}
    <script>window.onload=function(){window.print();setTimeout(()=>window.close(),1000)}<\/script></body></html>`);
  win.document.close();
}

function escHtml(str){return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── Helpers ───────────────────────────────────────────────────
function showError(msg){
  document.getElementById('typing-indicator')?.remove();
  const el=document.createElement('div');el.className='message ai';
  el.innerHTML=`<div class="avatar-sm ai" style="background:#7f1d1d">!</div><div class="bubble" style="border-color:rgba(239,68,68,0.2);background:rgba(239,68,68,0.05)"><p style="color:#fca5a5">${esc(msg)}</p></div>`;
  document.getElementById('messages').appendChild(el);scrollBottom();
}
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendQuestion();}}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,100)+'px';}
function setSend(d){document.getElementById('send-btn').disabled=d;}
function scrollBottom(){const el=document.getElementById('messages');el.scrollTop=el.scrollHeight;}
function esc(str){return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── Test menu ─────────────────────────────────────────────────
function toggleTestMenu() {
  const menu = document.getElementById('test-menu');
  const btn  = document.getElementById('test-btn');
  const open = menu.classList.toggle('open');
  btn.classList.toggle('open', open);
}
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('test-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('test-menu')?.classList.remove('open');
    document.getElementById('test-btn')?.classList.remove('open');
  }
});

// ── Suggestions adaptives (déclarées UNE SEULE FOIS) ─────────
async function fetchAndRenderSuggestions(userQuestion, aiAnswer, bubbleEl) {
  if (!userQuestion || !aiAnswer || !bubbleEl) return;

  const mode = trainingMode || 'medical';

  const arabicRatio = (aiAnswer.match(/[\u0600-\u06FF]/g) || []).length / Math.max(aiAnswer.length, 1);
  const lang = arabicRatio > 0.15 ? 'ar'
    : /\b(the|is|are|what|how|does|give|tell)\b/i.test(aiAnswer) ? 'en'
    : 'fr';

  const wrapId = 'suggest-wrap-' + Date.now();
  bubbleEl.insertAdjacentHTML('beforeend', `
    <div class="suggestions-wrap" id="${wrapId}">
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
  const text = btn.textContent.trim();
  if (!text) return;

  const input = document.getElementById('question-input');
  if (input) { input.value = text; autoResize(input); input.focus(); }

  const wrap = btn.closest('.suggestions-wrap');
  if (wrap) {
    wrap.querySelectorAll('.suggestion-chip').forEach(c => {
      c.disabled = true; c.style.opacity = '0.4'; c.style.cursor = 'default';
    });
    btn.style.opacity = '1';
    btn.style.background = 'rgb(183 252 132 / 18%)'
    btn.style.borderColor = 'rgb(75 95 70 / 60%)';
  }

  sendQuestion();
};

init();
