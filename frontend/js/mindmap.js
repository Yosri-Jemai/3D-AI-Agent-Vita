// frontend/js/mindmap.js
// Fichier autonome — chargé après main.js ou commercial.js

const _MINDMAP_API = window._API || 'http://localhost:8000';
let _mindmapSvgCache = null;

// ── Ouvrir la modale et lancer la génération ───────────────────────────────
window.openMindmap = async function () {
  if (!window.conversationLog || window.conversationLog.length < 2) {
    _mindmapToast('Commence une conversation d\'abord !');
    return;
  }

  const overlay = document.getElementById('mindmap-overlay');
  if (!overlay) return;
  overlay.classList.add('open');

  // Reset UI
  document.getElementById('mindmap-loading').style.display    = 'flex';
  document.getElementById('mindmap-svg-container').style.display = 'none';
  document.getElementById('mindmap-error').style.display      = 'none';
  document.getElementById('mindmap-dl-btn').disabled          = true;
  _mindmapSvgCache = null;

  // Détecter la langue
  const allText = window.conversationLog.map(m => m.text || '').join(' ');
  const arRatio = (allText.match(/[\u0600-\u06FF]/g) || []).length / Math.max(allText.length, 1);
  const lang    = arRatio > 0.15 ? 'ar'
    : /\b(the|is|are|what|how)\b/i.test(allText) ? 'en'
    : 'fr';

  const mode = window.trainingMode || window.MODE || 'medical';

  try {
    const res = await fetch(`${_MINDMAP_API}/analytics/mindmap`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        conversation: window.conversationLog.map(m => ({
          role: m.role === 'ai' ? 'assistant' : m.role,
          text: m.text || m.content || '',
        })),
        mode,
        lang,
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Erreur HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.svg) throw new Error('Aucun SVG reçu du serveur');

    _mindmapSvgCache = data.svg;

    // Injecter le SVG
    const container = document.getElementById('mindmap-svg-container');
    container.innerHTML = data.svg;
    const svgEl = container.querySelector('svg');
    if (svgEl) {
      svgEl.style.width     = '100%';
      svgEl.style.height    = '100%';
      svgEl.style.maxHeight = '560px';
      svgEl.style.borderRadius = '12px';
    }

    // Badge sujet
    const center   = data.concepts?.center || 'Session';
    const subtitle = document.getElementById('mindmap-subtitle');
    if (subtitle) subtitle.textContent = `Sujet : ${center}`;

    document.getElementById('mindmap-loading').style.display    = 'none';
    container.style.display                                      = 'flex';
    document.getElementById('mindmap-dl-btn').disabled          = false;

  } catch (err) {
    console.error('[mindmap]', err);
    document.getElementById('mindmap-loading').style.display = 'none';
    const errEl  = document.getElementById('mindmap-error');
    errEl.style.display = 'flex';
    const detail = document.getElementById('mindmap-error-detail');
    if (detail) detail.textContent = err.message || 'Erreur inconnue';
  }
};

// ── Fermer ─────────────────────────────────────────────────────────────────
window.closeMindmap = function () {
  document.getElementById('mindmap-overlay')?.classList.remove('open');
};
window.closeMindmapOnBg = function (e) {
  if (e.target === document.getElementById('mindmap-overlay')) window.closeMindmap();
};

// ══════════════════════════════════════════════════════════════════════════════
// ★ EXPORT — SVG / PNG / JPG
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Convert the cached SVG to a Blob via Canvas.
 * @param {string} format  'image/png' | 'image/jpeg'
 * @param {number} scale   pixel density multiplier (2 = @2x)
 */
async function _svgToBlob(format = 'image/png', scale = 2) {
  if (!_mindmapSvgCache) throw new Error('Aucune mindmap disponible');

  // 1. Parse SVG dimensions
  const parser = new DOMParser();
  const doc    = parser.parseFromString(_mindmapSvgCache, 'image/svg+xml');
  const svgEl  = doc.querySelector('svg');
  const W      = parseFloat(svgEl?.getAttribute('width')  || '1000');
  const H      = parseFloat(svgEl?.getAttribute('height') || '720');

  // 2. Create a Blob URL for the SVG
  const svgBlob = new Blob([_mindmapSvgCache], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl  = URL.createObjectURL(svgBlob);

  // 3. Draw onto canvas
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas  = document.createElement('canvas');
      canvas.width  = W * scale;
      canvas.height = H * scale;

      const ctx = canvas.getContext('2d');

      // For JPEG: fill white background (JPEG has no transparency)
      if (format === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(svgUrl);

      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else      reject(new Error('Canvas toBlob failed'));
      }, format, format === 'image/jpeg' ? 0.94 : undefined);
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error('Failed to load SVG as image'));
    };
    img.src = svgUrl;
  });
}

function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function _dateStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── Public download functions ──────────────────────────────────────────────

window.downloadMindmapSVG = function () {
  if (!_mindmapSvgCache) return;
  const blob = new Blob([_mindmapSvgCache], { type: 'image/svg+xml' });
  _triggerDownload(blob, `vitalagent-mindmap-${_dateStr()}.svg`);
};

window.downloadMindmapPNG = async function () {
  const btn = document.getElementById('mindmap-dl-png');
  if (btn) { btn.disabled = true; btn.textContent = 'Export…'; }
  try {
    const blob = await _svgToBlob('image/png', 2);
    _triggerDownload(blob, `vitalagent-mindmap-${_dateStr()}.png`);
  } catch (e) {
    console.error('[mindmap export]', e);
    _mindmapToast('Export PNG échoué : ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = _pngBtnLabel(); }
  }
};

window.downloadMindmapJPG = async function () {
  const btn = document.getElementById('mindmap-dl-jpg');
  if (btn) { btn.disabled = true; btn.textContent = 'Export…'; }
  try {
    const blob = await _svgToBlob('image/jpeg', 2);
    _triggerDownload(blob, `vitalagent-mindmap-${_dateStr()}.jpg`);
  } catch (e) {
    console.error('[mindmap export]', e);
    _mindmapToast('Export JPG échoué : ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = _jpgBtnLabel(); }
  }
};

function _pngBtnLabel() {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> PNG`;
}
function _jpgBtnLabel() {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> JPG`;
}

// ── Inject extra buttons into header (called once after DOM ready) ─────────
function _injectExportButtons() {
  const actionsEl = document.querySelector('.mindmap-modal-actions');
  if (!actionsEl || document.getElementById('mindmap-dl-png')) return;

  // Remove old single SVG download button and replace with 3 buttons
  const oldBtn = document.getElementById('mindmap-dl-btn');

  const pngBtn = document.createElement('button');
  pngBtn.id        = 'mindmap-dl-png';
  pngBtn.className = 'mindmap-download-btn';
  pngBtn.disabled  = true;
  pngBtn.innerHTML = _pngBtnLabel();
  pngBtn.onclick   = window.downloadMindmapPNG;

  const jpgBtn = document.createElement('button');
  jpgBtn.id        = 'mindmap-dl-jpg';
  jpgBtn.className = 'mindmap-download-btn';
  jpgBtn.disabled  = true;
  jpgBtn.innerHTML = _jpgBtnLabel();
  jpgBtn.onclick   = window.downloadMindmapJPG;

  const svgBtn = document.createElement('button');
  svgBtn.id        = 'mindmap-dl-svg';
  svgBtn.className = 'mindmap-download-btn';
  svgBtn.disabled  = true;
  svgBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> SVG`;
  svgBtn.onclick   = window.downloadMindmapSVG;

  // Insert before close button
  const closeBtn = actionsEl.querySelector('.mindmap-close-btn');
  if (closeBtn) {
    actionsEl.insertBefore(svgBtn, closeBtn);
    actionsEl.insertBefore(jpgBtn, closeBtn);
    actionsEl.insertBefore(pngBtn, closeBtn);
    if (oldBtn) oldBtn.remove();
  } else {
    actionsEl.appendChild(pngBtn);
    actionsEl.appendChild(jpgBtn);
    actionsEl.appendChild(svgBtn);
    if (oldBtn) oldBtn.remove();
  }
}

// Enable all 3 export buttons after SVG is ready
function _enableExportButtons() {
  ['mindmap-dl-png', 'mindmap-dl-jpg', 'mindmap-dl-svg'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = false;
  });
  // Backward compat: also enable old button if still present
  const old = document.getElementById('mindmap-dl-btn');
  if (old) old.disabled = false;
}
function _disableExportButtons() {
  ['mindmap-dl-png', 'mindmap-dl-jpg', 'mindmap-dl-svg'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = true;
  });
}

// Override openMindmap to also manage the new buttons
const _origOpenMindmap = window.openMindmap;
window.openMindmap = async function () {
  _injectExportButtons();
  _disableExportButtons();

  if (!window.conversationLog || window.conversationLog.length < 2) {
    _mindmapToast('Commence une conversation d\'abord !');
    return;
  }

  const overlay = document.getElementById('mindmap-overlay');
  if (!overlay) return;
  overlay.classList.add('open');

  document.getElementById('mindmap-loading').style.display       = 'flex';
  document.getElementById('mindmap-svg-container').style.display = 'none';
  document.getElementById('mindmap-error').style.display         = 'none';
  _mindmapSvgCache = null;

  const allText = window.conversationLog.map(m => m.text || '').join(' ');
  const arRatio = (allText.match(/[\u0600-\u06FF]/g) || []).length / Math.max(allText.length, 1);
  const lang    = arRatio > 0.15 ? 'ar'
    : /\b(the|is|are|what|how)\b/i.test(allText) ? 'en'
    : 'fr';

  const mode = window.trainingMode || window.MODE || 'medical';

  try {
    const res = await fetch(`${_MINDMAP_API}/analytics/mindmap`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        conversation: window.conversationLog.map(m => ({
          role: m.role === 'ai' ? 'assistant' : m.role,
          text: m.text || m.content || '',
        })),
        mode,
        lang,
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Erreur HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.svg) throw new Error('Aucun SVG reçu du serveur');

    _mindmapSvgCache = data.svg;

    const container = document.getElementById('mindmap-svg-container');
    container.innerHTML = data.svg;
    const svgEl = container.querySelector('svg');
    if (svgEl) {
      svgEl.style.width        = '100%';
      svgEl.style.height       = '100%';
      svgEl.style.maxHeight    = '560px';
      svgEl.style.borderRadius = '12px';
    }

    const center   = data.concepts?.center || 'Session';
    const subtitle = document.getElementById('mindmap-subtitle');
    if (subtitle) subtitle.textContent = `Sujet : ${center}`;

    document.getElementById('mindmap-loading').style.display       = 'none';
    container.style.display                                         = 'flex';
    _enableExportButtons();

  } catch (err) {
    console.error('[mindmap]', err);
    document.getElementById('mindmap-loading').style.display = 'none';
    const errEl = document.getElementById('mindmap-error');
    errEl.style.display = 'flex';
    const detail = document.getElementById('mindmap-error-detail');
    if (detail) detail.textContent = err.message || 'Erreur inconnue';
  }
};

// ── Activate mindmap button when conversation starts ───────────────────────
const _reportBtn  = document.getElementById('report-btn');
const _mindmapBtn = document.getElementById('mindmap-btn');
if (_reportBtn && _mindmapBtn) {
  const _check = setInterval(() => {
    if (!_reportBtn.disabled) {
      _mindmapBtn.disabled = false;
      clearInterval(_check);
    }
  }, 500);
}

// ── Toast helper ───────────────────────────────────────────────────────────
function _mindmapToast(msg) {
  if (typeof showToast === 'function') { showToast(msg); return; }
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '24px', left: '50%',
    transform: 'translateX(-50%)',
    background: '#1e2d4a', color: '#e8eaf0',
    padding: '10px 20px', borderRadius: '10px',
    fontSize: '13px', zIndex: '9999',
    border: '1px solid rgba(126,184,247,0.3)',
    fontFamily: 'system-ui',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}