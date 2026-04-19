// frontend/js/mindmap.js
// Améliorations : tooltips au survol des bulles + texte sous l'image exportée

const _MINDMAP_API = window._API || 'http://localhost:8000';
let _mindmapSvgCache = null;
let _mindmapConceptsCache = null;

// ── Ouvrir la modale et lancer la génération ───────────────────────────────
window.openMindmap = async function () {
  if (!window.conversationLog || window.conversationLog.length < 2) {
    _mindmapToast('Commence une conversation d\'abord !');
    return;
  }

  const overlay = document.getElementById('mindmap-overlay');
  if (!overlay) return;
  overlay.classList.add('open');

  document.getElementById('mindmap-loading').style.display    = 'flex';
  document.getElementById('mindmap-svg-container').style.display = 'none';
  document.getElementById('mindmap-error').style.display      = 'none';
  _injectExportButtons();
  _disableExportButtons();
  _mindmapSvgCache   = null;
  _mindmapConceptsCache = null;

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

    _mindmapSvgCache    = data.svg;
    _mindmapConceptsCache = data.concepts;

    const container = document.getElementById('mindmap-svg-container');
    container.innerHTML = '';

    // ── Wrapper avec SVG + tooltip overlay ────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;gap:12px;';

    // SVG
    const svgHolder = document.createElement('div');
    svgHolder.style.cssText = 'position:relative;width:100%;flex:1;min-height:0;';
    svgHolder.innerHTML = data.svg;

    const svgEl = svgHolder.querySelector('svg');
    if (svgEl) {
      svgEl.style.width        = '100%';
      svgEl.style.height       = '100%';
      svgEl.style.maxHeight    = '520px';
      svgEl.style.borderRadius = '12px';
      svgEl.style.display      = 'block';
    }

    // Tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'mindmap-tooltip';
    tooltip.style.cssText = [
      'position:absolute',
      'pointer-events:none',
      'display:none',
      'max-width:220px',
      'padding:10px 14px',
      'background:rgba(10,14,30,0.93)',
      'border:1px solid rgba(126,184,247,0.35)',
      'border-radius:10px',
      'font-family:Inter,Jost,system-ui,sans-serif',
      'font-size:12px',
      'line-height:1.5',
      'color:rgba(230,234,244,0.92)',
      'z-index:99',
      'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
      'transition:opacity 0.15s',
    ].join(';');
    svgHolder.appendChild(tooltip);

    // Caption sous le mindmap (PATCH 1 - version enrichie)
    const caption = document.createElement('div');
    caption.id = 'mindmap-caption';
    const center  = data.concepts?.center || 'Session';
    const branches = data.concepts?.branches || [];
    const topics   = branches.map(b => b.label).filter(Boolean).slice(0, 5).join(' · ');
    
    const centerDesc = data.concepts?.center_description || '';
    const firstBranch = (data.concepts?.branches || [])[0];
    const firstBranchDesc = firstBranch?.description || '';

    // Construire un résumé lisible depuis les descriptions LLM
    const summaryParts = [];
    if (centerDesc) summaryParts.push(centerDesc.trim());
    if (firstBranchDesc && firstBranchDesc !== centerDesc) summaryParts.push(firstBranchDesc.trim());
    const summaryText = summaryParts.join(' ');

    caption.style.cssText = [
      'width:100%',
      'text-align:center',
      'font-family:Inter,Jost,system-ui,sans-serif',
      'font-size:11px',
      'color:rgba(200,208,220,0.7)',
      'letter-spacing:0.04em',
      'padding:0 12px 8px',
      'border-top:1px solid rgba(255,255,255,0.05)',
      'padding-top:10px',
      'user-select:none',
    ].join(';');
    
    caption.innerHTML = `
      <div style="margin-bottom:6px;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;">
        <span style="color:rgba(126,184,247,0.9);font-weight:600;font-size:12px;letter-spacing:0.05em;">${_escHtml(center)}</span>
        ${topics ? `<span style="opacity:0.35;font-size:11px;">·</span><span style="font-size:11px;color:rgba(180,192,210,0.75);">${_escHtml(topics)}</span>` : ''}
      </div>
      ${summaryText ? `<div style="font-size:12px;color:rgba(200,215,235,0.75);line-height:1.65;max-width:820px;margin:0 auto 6px;">${_escHtml(summaryText)}</div>` : ''}
      <div style="font-size:10px;color:rgba(140,155,175,0.45);letter-spacing:0.06em;margin-top:2px;">Généré par VitalAgent AI · Passez la souris sur les bulles pour mémoriser</div>
    `;

    wrapper.appendChild(svgHolder);
    wrapper.appendChild(caption);
    container.appendChild(wrapper);

    // ── Attacher les tooltips aux noeuds SVG ───────────────────────────────
    _attachTooltips(svgHolder, tooltip, data.concepts);

    // Badge sujet
    const subtitle = document.getElementById('mindmap-subtitle');
    if (subtitle) subtitle.textContent = `Sujet : ${center}`;

    document.getElementById('mindmap-loading').style.display    = 'none';
    container.style.display                                      = 'flex';
    _enableExportButtons();

  } catch (err) {
    console.error('[mindmap]', err);
    document.getElementById('mindmap-loading').style.display = 'none';
    const errEl  = document.getElementById('mindmap-error');
    errEl.style.display = 'flex';
    const detail = document.getElementById('mindmap-error-detail');
    if (detail) detail.textContent = err.message || 'Erreur inconnue';
  }
};

function _attachTooltips(container, tooltip, concepts) {
  if (!concepts) return;

  const svgEl = container.querySelector('svg');
  if (!svgEl) return;

  // Construire le dictionnaire label → {title, desc, color}
  // en utilisant les descriptions générées par le LLM depuis la vraie conversation
  const descriptions = {};

  // Centre
  if (concepts.center) {
    descriptions[concepts.center.toLowerCase()] = {
      title: concepts.center,
      desc:  concepts.center_description || `Sujet principal de la session de formation.`,
      type:  'center',
      color: '#7eb8f7',
    };
  }

  // Branches + enfants
  (concepts.branches || []).forEach(branch => {
    if (!branch.label) return;

    descriptions[branch.label.toLowerCase()] = {
      title: branch.label,
      desc:  branch.description || `Thème abordé dans la conversation.`,
      type:  'branch',
      color: branch.color || '#7eb8f7',
    };

    (branch.children || []).forEach(child => {
      if (!child) return;
      // child peut être un dict {label, description} ou un string (ancien format)
      const childLabel = typeof child === 'object' ? (child.label || '') : String(child);
      const childDesc  = typeof child === 'object' ? (child.description || '') : '';
      if (!childLabel) return;

      descriptions[childLabel.toLowerCase()] = {
        title: childLabel,
        desc:  childDesc || `Élément spécifique lié au thème "${branch.label}".`,
        type:  'child',
        color: branch.color || '#7eb8f7',
      };
    });
  });

  // Attacher les événements aux textes SVG
  const textEls = svgEl.querySelectorAll('text');

  textEls.forEach(textEl => {
    const rawLabel = textEl.textContent?.trim();
    if (!rawLabel || rawLabel.length < 2) return;

    let match = null;
    const rawLow = rawLabel.toLowerCase();

    // Correspondance exacte
    if (descriptions[rawLow]) {
      match = descriptions[rawLow];
    } else {
      // Correspondance partielle (labels wrappés sur plusieurs lignes SVG)
      for (const [key, val] of Object.entries(descriptions)) {
        if (key.startsWith(rawLow) || rawLow.startsWith(key.slice(0, 5))) {
          match = val;
          break;
        }
      }
    }

    if (!match) return;

    textEl.style.cursor = 'default';

    const showTooltip = (e) => {
      const contRect = container.getBoundingClientRect();
      let x = e.clientX - contRect.left + 14;
      let y = e.clientY - contRect.top  + 14;
      if (x + 240 > contRect.width)  x = e.clientX - contRect.left - 244;
      if (y + 110 > contRect.height) y = e.clientY - contRect.top  - 90;

      tooltip.style.left    = `${x}px`;
      tooltip.style.top     = `${y}px`;
      tooltip.style.display = 'block';
      tooltip.style.opacity = '1';

      const colorDot = match.color
        ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${match.color};margin-right:6px;flex-shrink:0;vertical-align:middle;margin-top:2px"></span>`
        : '';

      tooltip.innerHTML = `
        <div style="font-weight:600;font-size:13px;color:#fff;margin-bottom:6px;display:flex;align-items:flex-start;gap:0;">
          ${colorDot}<span>${_escHtml(match.title)}</span>
        </div>
        <div style="color:rgba(200,215,235,0.88);font-size:11.5px;line-height:1.6;white-space:pre-line;">${_escHtml(match.desc)}</div>
      `;
    };

    const moveTooltip = (e) => {
      if (tooltip.style.display === 'none') return;
      const contRect = container.getBoundingClientRect();
      let x = e.clientX - contRect.left + 14;
      let y = e.clientY - contRect.top  + 14;
      if (x + 240 > contRect.width)  x = e.clientX - contRect.left - 244;
      if (y + 110 > contRect.height) y = e.clientY - contRect.top  - 90;
      tooltip.style.left = `${x}px`;
      tooltip.style.top  = `${y}px`;
    };

    const hideTooltip = () => {
      tooltip.style.opacity = '0';
      setTimeout(() => { tooltip.style.display = 'none'; }, 150);
    };

    textEl.addEventListener('mouseenter', showTooltip);
    textEl.addEventListener('mousemove',  moveTooltip);
    textEl.addEventListener('mouseleave', hideTooltip);

    const parent = textEl.parentElement;
    if (parent && parent !== svgEl && parent.tagName !== 'svg') {
      parent.style.cursor = 'default';
      parent.addEventListener('mouseenter', showTooltip);
      parent.addEventListener('mousemove',  moveTooltip);
      parent.addEventListener('mouseleave', hideTooltip);
    }
  });
}

// ── Fermer ─────────────────────────────────────────────────────────────────
window.closeMindmap = function () {
  document.getElementById('mindmap-overlay')?.classList.remove('open');
};
window.closeMindmapOnBg = function (e) {
  if (e.target === document.getElementById('mindmap-overlay')) window.closeMindmap();
};

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT — SVG / PNG / JPG / HTML interactif
// ══════════════════════════════════════════════════════════════════════════════

async function _svgToBlob(format = 'image/png', scale = 2) {
  if (!_mindmapSvgCache) throw new Error('Aucune mindmap disponible');

  const parser = new DOMParser();
  const doc    = parser.parseFromString(_mindmapSvgCache, 'image/svg+xml');
  const svgEl  = doc.querySelector('svg');
  const W      = parseFloat(svgEl?.getAttribute('width')  || '1000');
  const H      = parseFloat(svgEl?.getAttribute('height') || '720');

  // Construire le SVG enrichi avec caption
  const center   = _mindmapConceptsCache?.center || '';
  const branches = _mindmapConceptsCache?.branches || [];
  const topics   = branches.map(b => b.label).filter(Boolean).slice(0, 5).join(' · ');

  const captionH     = 36;
  const totalH       = H + captionH;
  const captionText1 = center;
  const captionText2 = topics ? `Thèmes : ${topics}` : '';
  const captionText3 = 'VitalAgent AI · Session Mindmap';

  // Créer un SVG composite incluant la caption
  const compositeSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}" style="background:#070b14;font-family:Inter,Jost,system-ui,sans-serif;">
      <g>
        ${_mindmapSvgCache.replace(/<\/?svg[^>]*>/g, '')}
      </g>
      <rect x="0" y="${H}" width="${W}" height="${captionH}" fill="rgba(10,14,26,0.98)"/>
      <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="rgba(126,184,247,0.15)" stroke-width="1"/>
      ${captionText1 ? `<text x="${W/2}" y="${H + 14}" text-anchor="middle" dominant-baseline="central" fill="#7eb8f7" font-size="12" font-weight="600" letter-spacing="0.04em">${_escXml(captionText1)}</text>` : ''}
      ${captionText2 ? `<text x="${W/2}" y="${H + 26}" text-anchor="middle" dominant-baseline="central" fill="rgba(200,210,228,0.6)" font-size="10" letter-spacing="0.02em">${_escXml(captionText2)}</text>` : ''}
      <text x="${W - 12}" y="${H + captionH/2}" text-anchor="end" dominant-baseline="central" fill="rgba(150,160,180,0.4)" font-size="9" font-style="italic">${_escXml(captionText3)}</text>
    </svg>
  `;

  const svgBlob = new Blob([compositeSvg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl  = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas  = document.createElement('canvas');
      canvas.width  = W * scale;
      canvas.height = totalH * scale;

      const ctx = canvas.getContext('2d');

      if (format === 'image/jpeg') {
        ctx.fillStyle = '#070b14';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, W, totalH);
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

// PATCH 2 - Version HTML interactif
window.downloadMindmapSVG = function () {
  if (!_mindmapSvgCache || !_mindmapConceptsCache) {
    _mindmapToast('Aucune mindmap à exporter');
    return;
  }

  // Construire un fichier HTML autonome qui contient :
  // - le SVG du mindmap
  // - les tooltips interactifs fonctionnels
  // - la caption avec le résumé
  // Tout en un seul fichier .html qu'on peut ouvrir dans le navigateur

  const concepts     = _mindmapConceptsCache;
  const center       = concepts.center || 'Session';
  const branches     = concepts.branches || [];
  const topics       = branches.map(b => b.label).filter(Boolean).slice(0, 5).join(' · ');
  const centerDesc   = concepts.center_description || '';
  const firstBDesc   = branches[0]?.description || '';
  const summaryParts = [];
  if (centerDesc) summaryParts.push(centerDesc.trim());
  if (firstBDesc && firstBDesc !== centerDesc) summaryParts.push(firstBDesc.trim());
  const summaryText  = summaryParts.join(' ');
  const dateStr      = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  // Sérialiser les concepts pour le JS inline
  const conceptsJSON = JSON.stringify(concepts).replace(/<\/script>/gi, '<\\/script>');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Mindmap — ${_escHtml(center)} · VitalAgent</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #070b14;
    font-family: 'Inter', 'Jost', system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 20px;
    gap: 0;
  }
  .mindmap-wrapper {
    position: relative;
    width: 100%;
    max-width: 1000px;
  }
  .mindmap-wrapper svg {
    width: 100%;
    height: auto;
    border-radius: 16px;
    display: block;
  }
  #tooltip {
    position: fixed;
    display: none;
    max-width: 260px;
    padding: 12px 16px;
    background: rgba(10,14,30,0.96);
    border: 1px solid rgba(126,184,247,0.4);
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.55;
    color: rgba(230,234,244,0.92);
    pointer-events: none;
    z-index: 999;
    box-shadow: 0 4px 24px rgba(0,0,0,0.6);
    transition: opacity 0.15s;
  }
  .tooltip-title {
    font-weight: 700;
    font-size: 13.5px;
    color: #fff;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .tooltip-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .tooltip-desc {
    color: rgba(200,215,235,0.85);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-line;
  }
  .caption {
    width: 100%;
    max-width: 1000px;
    text-align: center;
    padding: 16px 20px 8px;
    border-top: 1px solid rgba(255,255,255,0.06);
    margin-top: 0;
  }
  .caption-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .caption-center {
    color: rgba(126,184,247,0.9);
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.05em;
  }
  .caption-sep { color: rgba(255,255,255,0.25); font-size: 12px; }
  .caption-topics { font-size: 12px; color: rgba(180,192,210,0.7); }
  .caption-summary {
    font-size: 13px;
    color: rgba(200,215,235,0.78);
    line-height: 1.7;
    max-width: 820px;
    margin: 0 auto 8px;
  }
  .caption-footer {
    font-size: 10px;
    color: rgba(140,155,175,0.4);
    letter-spacing: 0.06em;
  }
  .hint {
    margin-top: 14px;
    font-size: 11px;
    color: rgba(126,184,247,0.4);
    text-align: center;
    letter-spacing: 0.04em;
  }
</style>
</head>
<body>

<div id="tooltip">
  <div class="tooltip-title">
    <span class="tooltip-dot" id="tooltip-dot"></span>
    <span id="tooltip-title-text"></span>
  </div>
  <div class="tooltip-desc" id="tooltip-desc"></div>
</div>

<div class="mindmap-wrapper" id="mindmap-wrapper">
  ${_mindmapSvgCache}
</div>

<div class="caption">
  <div class="caption-header">
    <span class="caption-center">${_escHtml(center)}</span>
    ${topics ? `<span class="caption-sep">·</span><span class="caption-topics">${_escHtml(topics)}</span>` : ''}
  </div>
  ${summaryText ? `<p class="caption-summary">${_escHtml(summaryText)}</p>` : ''}
  <div class="caption-footer">Généré par VitalAgent AI · ${_escHtml(dateStr)} · Passez la souris sur les bulles pour mémoriser</div>
</div>

<div class="hint">↑ Survolez les bulles pour afficher les descriptions de la conversation</div>

<script>
const concepts = ${conceptsJSON};

const descriptions = {};

if (concepts.center) {
  descriptions[concepts.center.toLowerCase()] = {
    title: concepts.center,
    desc:  concepts.center_description || 'Sujet principal de la session.',
    color: '#7eb8f7',
  };
}

(concepts.branches || []).forEach(branch => {
  if (!branch.label) return;
  descriptions[branch.label.toLowerCase()] = {
    title: branch.label,
    desc:  branch.description || 'Thème abordé dans la conversation.',
    color: branch.color || '#7eb8f7',
  };
  (branch.children || []).forEach(child => {
    if (!child) return;
    const lbl  = typeof child === 'object' ? (child.label || '') : String(child);
    const desc = typeof child === 'object' ? (child.description || '') : '';
    if (!lbl) return;
    descriptions[lbl.toLowerCase()] = {
      title: lbl,
      desc:  desc || ('Élément lié au thème "' + branch.label + '".'),
      color: branch.color || '#7eb8f7',
    };
  });
});

const tooltip   = document.getElementById('tooltip');
const ttDot     = document.getElementById('tooltip-dot');
const ttTitle   = document.getElementById('tooltip-title-text');
const ttDesc    = document.getElementById('tooltip-desc');
const wrapper   = document.getElementById('mindmap-wrapper');
const svgEl     = wrapper.querySelector('svg');

function findMatch(rawLabel) {
  const low = rawLabel.toLowerCase().trim();
  if (descriptions[low]) return descriptions[low];
  for (const [key, val] of Object.entries(descriptions)) {
    if (key.startsWith(low) || low.startsWith(key.slice(0, 5))) return val;
  }
  return null;
}

svgEl.querySelectorAll('text').forEach(textEl => {
  const raw = textEl.textContent?.trim();
  if (!raw || raw.length < 2) return;
  const match = findMatch(raw);
  if (!match) return;

  textEl.style.cursor = 'default';

  const show = (e) => {
    ttDot.style.background   = match.color;
    ttTitle.textContent      = match.title;
    ttDesc.textContent       = match.desc;
    tooltip.style.display    = 'block';
    tooltip.style.opacity    = '1';
    position(e);
  };

  const position = (e) => {
    let x = e.clientX + 16;
    let y = e.clientY + 16;
    if (x + 270 > window.innerWidth)  x = e.clientX - 274;
    if (y + 130 > window.innerHeight) y = e.clientY - 110;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  };

  const hide = () => {
    tooltip.style.opacity = '0';
    setTimeout(() => { tooltip.style.display = 'none'; }, 150);
  };

  textEl.addEventListener('mouseenter', show);
  textEl.addEventListener('mousemove',  position);
  textEl.addEventListener('mouseleave', hide);

  const parent = textEl.parentElement;
  if (parent && parent !== svgEl) {
    parent.style.cursor = 'default';
    parent.addEventListener('mouseenter', show);
    parent.addEventListener('mousemove',  position);
    parent.addEventListener('mouseleave', hide);
  }
});
<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  _triggerDownload(blob, `vitalagent-mindmap-${_dateStr()}.html`);
  _mindmapToast('Mindmap HTML téléchargée — ouvrez le fichier dans votre navigateur !');
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

// ── Labels des boutons ─────────────────────────────────────────────────────
function _pngBtnLabel() {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> PNG`;
}
function _jpgBtnLabel() {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> JPG`;
}

// ── Injection des boutons d'export ─────────────────────────────────────────
function _injectExportButtons() {
  const actionsEl = document.querySelector('.mindmap-modal-actions');
  if (!actionsEl || document.getElementById('mindmap-dl-png')) return;

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

  // PATCH 3 - Changer le label du bouton SVG
  const svgBtn = document.createElement('button');
  svgBtn.id        = 'mindmap-dl-svg';
  svgBtn.className = 'mindmap-download-btn';
  svgBtn.disabled  = true;
  svgBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ✨ HTML interactif`;
  svgBtn.onclick   = window.downloadMindmapSVG;

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

function _enableExportButtons() {
  ['mindmap-dl-png', 'mindmap-dl-jpg', 'mindmap-dl-svg'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = false;
  });
  const old = document.getElementById('mindmap-dl-btn');
  if (old) old.disabled = false;
}
function _disableExportButtons() {
  ['mindmap-dl-png', 'mindmap-dl-jpg', 'mindmap-dl-svg'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = true;
  });
}

// ── Activation du bouton mindmap quand la conversation commence ─────────────
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

// ── Helpers ────────────────────────────────────────────────────────────────
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

function _escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _escXml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}