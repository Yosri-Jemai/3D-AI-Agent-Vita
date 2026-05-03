// js/behavioral-ui.js — v4  Widget flottant persistant + panel données temps réel
// ════════════════════════════════════════════════════════════════════════════════
//
// NOUVEAUTÉS v4 :
//   • Widget caméra FLOTTANT — position fixe, toujours visible
//   • Draggable (glisser-déposer) par l'en-tête
//   • Redimensionnable (poignée coin bas-droit)
//   • Taille par défaut généreuse (320×240 pour la vidéo)
//   • Panel données compact collé sous la caméra
//   • Collapse/expand d'un clic sur l'en-tête
//   • Mise à jour des données à chaque frame (~3 fps d'UI)
//   • Indicateur FPS live
//   • Signaux de stress en badges colorés
//
// ════════════════════════════════════════════════════════════════════════════════

import { EXPRESSION_META, GAZE_META, POSTURE_META } from "./behavioral-analysis.js";

let _timerInterval  = null;
let _timerStart     = 0;
let _fpsCounter     = 0;
let _fpsTimestamp   = 0;
let _fpsLive        = 0;

// ── Init widget flottant ──────────────────────────────────────────────────────
export function initBehavioralPanel(videoEl, overlayCanvas) {
  if (document.getElementById("ba-float")) return;

  // ── Injection CSS dans <head> ──
  _injectCSS();

  // ── Structure HTML du widget ──
  const widget = document.createElement("div");
  widget.id    = "ba-float";
  widget.innerHTML = `
    <div class="ba-float-header" id="ba-drag-handle">
      <div class="ba-float-title">
        <span class="ba-live-dot" id="ba-live-dot"></span>
        Analyse comportementale
      </div>
      <div class="ba-float-actions">
        <span class="ba-fps" id="ba-fps">— fps</span>
        <button class="ba-btn-collapse" id="ba-btn-collapse" title="Réduire">▾</button>
        <button class="ba-btn-close" id="ba-btn-close" title="Fermer">✕</button>
      </div>
    </div>

    <div class="ba-float-body" id="ba-float-body">

      <!-- Caméra -->
      <div class="ba-cam-wrap" id="ba-cam-wrap"></div>

      <!-- Données temps réel -->
      <div class="ba-data-grid">

        <div class="ba-data-row">
          <span class="ba-data-icon" id="ba-expr-icon">😐</span>
          <div class="ba-data-info">
            <span class="ba-data-lbl">Expression</span>
            <span class="ba-data-val" id="ba-expr-val">—</span>
          </div>
          <span class="ba-data-icon" id="ba-gaze-icon">👁️</span>
          <div class="ba-data-info">
            <span class="ba-data-lbl">Regard</span>
            <span class="ba-data-val" id="ba-gaze-val">—</span>
          </div>
        </div>

        <div class="ba-data-row">
          <span class="ba-data-icon">🧍</span>
          <div class="ba-data-info">
            <span class="ba-data-lbl">Posture</span>
            <span class="ba-data-val" id="ba-posture-val">—</span>
          </div>
          <span class="ba-data-icon">⏱</span>
          <div class="ba-data-info">
            <span class="ba-data-lbl">Réflexion</span>
            <span class="ba-data-val" id="ba-timer-val">0s</span>
          </div>
        </div>

        <div class="ba-bars">
          <div class="ba-bar-row">
            <span class="ba-bar-lbl">Confiance</span>
            <div class="ba-bar-track"><div class="ba-bar-fill" id="ba-conf-fill" style="background:#22c55e"></div></div>
            <span class="ba-bar-pct" id="ba-conf-pct">0%</span>
          </div>
          <div class="ba-bar-row">
            <span class="ba-bar-lbl">Stress</span>
            <div class="ba-bar-track"><div class="ba-bar-fill" id="ba-stress-fill" style="background:#f59e0b"></div></div>
            <span class="ba-bar-pct" id="ba-stress-pct">0%</span>
          </div>
          <div class="ba-bar-row">
            <span class="ba-bar-lbl">Agitation</span>
            <div class="ba-bar-track"><div class="ba-bar-fill" id="ba-fidget-fill" style="background:#6b7280"></div></div>
            <span class="ba-bar-pct" id="ba-fidget-pct">0%</span>
          </div>
        </div>

        <div class="ba-signals-wrap">
          <div class="ba-signals-hdr">⚠ Signaux détectés</div>
          <div class="ba-signals-list" id="ba-signals-list">
            <span class="ba-sig-empty">Aucun signal actif</span>
          </div>
        </div>

      </div>
    </div>

    <div class="ba-resize-handle" id="ba-resize"></div>
  `;

  document.body.appendChild(widget);

  // ── Monter vidéo + overlay dans le conteneur caméra ──
  const camWrap = document.getElementById("ba-cam-wrap");
  if (camWrap) {
    if (videoEl) {
      videoEl.style.cssText = "display:block;width:100%;height:100%;object-fit:cover;";
      camWrap.appendChild(videoEl);
    }
    if (overlayCanvas) {
      overlayCanvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";
      camWrap.appendChild(overlayCanvas);
    }
  }

  // ── Position initiale : coin bas-gauche ──
  widget.style.left   = "16px";
  widget.style.bottom = "16px";
  widget.style.top    = "auto";

  _makeDraggable(widget, document.getElementById("ba-drag-handle"));
  _makeResizable(widget, document.getElementById("ba-resize"));

  // ── Collapse ──
  const collapseBtn = document.getElementById("ba-btn-collapse");
  const body        = document.getElementById("ba-float-body");
  let collapsed = false;
  collapseBtn.addEventListener("click", () => {
    collapsed = !collapsed;
    body.style.display   = collapsed ? "none" : "flex";
    collapseBtn.textContent = collapsed ? "▸" : "▾";
    collapseBtn.title    = collapsed ? "Développer" : "Réduire";
  });

  // ── Fermer ──
  document.getElementById("ba-btn-close").addEventListener("click", () => {
    widget.style.display = "none";
  });

  // FPS init
  _fpsTimestamp = performance.now();
}

// ── Mise à jour frame ─────────────────────────────────────────────────────────
export function updateLiveFrame(frame) {
  if (!frame) return;

  // FPS
  _fpsCounter++;
  const now = performance.now();
  if (now - _fpsTimestamp >= 1000) {
    _fpsLive = _fpsCounter;
    _fpsCounter = 0;
    _fpsTimestamp = now;
    const fpsEl = document.getElementById("ba-fps");
    if (fpsEl) fpsEl.textContent = `${_fpsLive} fps`;
  }

  // Expression
  const em = EXPRESSION_META[frame.expression] || EXPRESSION_META.neutral;
  _set("ba-expr-icon", em.icon);
  _setVal("ba-expr-val", em.fr, em.color);

  // Gaze
  const gm = GAZE_META[frame.gaze] || GAZE_META.unknown;
  _set("ba-gaze-icon", gm.icon);
  _setVal("ba-gaze-val", gm.fr, gm.color);

  // Posture
  const pm = POSTURE_META[frame.posture] || POSTURE_META.normal;
  _setVal("ba-posture-val", pm.fr, pm.color);

  // Barres
  const stress  = Math.round((frame.stressScore  ?? 0) * 100);
  const conf    = Math.round((frame.confScore    ?? 0.5) * 100);
  const fidget  = Math.round((frame.fidgetScore  ?? 0) * 100);

  _bar("ba-conf-fill",   "ba-conf-pct",   conf,   "#22c55e");
  _bar("ba-stress-fill", "ba-stress-pct", stress, stress>60?"#ef4444":stress>35?"#f59e0b":"#22c55e");
  _bar("ba-fidget-fill", "ba-fidget-pct", fidget, fidget>50?"#f59e0b":"#6b7280");

  // Signaux
  const sigList = document.getElementById("ba-signals-list");
  if (sigList) {
    const sigs = frame.stressSignals || [];
    sigList.innerHTML = sigs.length === 0
      ? `<span class="ba-sig-empty">Aucun signal actif</span>`
      : sigs.map(s => `<span class="ba-sig-badge">${s}</span>`).join("");
  }

  // Dot live
  const dot = document.getElementById("ba-live-dot");
  if (dot) dot.style.background = frame.stressScore > 0.5 ? "#ef4444" : "#22c55e";
}

// ── Timer ─────────────────────────────────────────────────────────────────────
export function startTimer() {
  stopTimer();
  _timerStart    = Date.now();
  _timerInterval = setInterval(() => {
    const el = document.getElementById("ba-timer-val");
    if (el) el.textContent = Math.floor((Date.now()-_timerStart)/1000) + "s";
  }, 500);
}

export function stopTimer() {
  if (_timerInterval) clearInterval(_timerInterval);
  _timerInterval = null;
}

export function destroyPanel() {
  stopTimer();
  document.getElementById("ba-float")?.remove();
}

// ── Helpers DOM ───────────────────────────────────────────────────────────────
function _set(id, txt) { const el=document.getElementById(id); if(el) el.textContent=txt; }
function _setVal(id, txt, color) {
  const el=document.getElementById(id);
  if(el){ el.textContent=txt; el.style.color=color||"#fff"; }
}
function _bar(fillId, pctId, pct, color) {
  const f=document.getElementById(fillId), p=document.getElementById(pctId);
  if(f){ f.style.width=pct+"%"; f.style.background=color; }
  if(p) p.textContent=pct+"%";
}

// ── Draggable ─────────────────────────────────────────────────────────────────
function _makeDraggable(el, handle) {
  let ox=0, oy=0, startX=0, startY=0, dragging=false;

  handle.style.cursor = "grab";

  handle.addEventListener("mousedown", e => {
    if (e.target.closest("button")) return;
    dragging = true;
    handle.style.cursor = "grabbing";

    // Convertir bottom en top si nécessaire
    if (el.style.top === "auto" || !el.style.top) {
      const rect = el.getBoundingClientRect();
      el.style.top    = rect.top + "px";
      el.style.bottom = "auto";
    }

    startX = e.clientX; startY = e.clientY;
    ox = parseInt(el.style.left)||0;
    oy = parseInt(el.style.top)||0;

    e.preventDefault();
  });

  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const nx = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  ox+dx));
    const ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, oy+dy));
    el.style.left = nx+"px"; el.style.top = ny+"px";
  });

  document.addEventListener("mouseup", () => {
    dragging = false; handle.style.cursor = "grab";
  });

  // Touch support
  handle.addEventListener("touchstart", e => {
    if (e.target.closest("button")) return;
    if (el.style.top === "auto" || !el.style.top) {
      const rect = el.getBoundingClientRect();
      el.style.top = rect.top+"px"; el.style.bottom = "auto";
    }
    const t = e.touches[0];
    startX=t.clientX; startY=t.clientY;
    ox=parseInt(el.style.left)||0; oy=parseInt(el.style.top)||0;
    dragging=true; e.preventDefault();
  }, { passive: false });

  document.addEventListener("touchmove", e => {
    if (!dragging) return;
    const t=e.touches[0];
    const nx=Math.max(0,Math.min(window.innerWidth-el.offsetWidth,  ox+(t.clientX-startX)));
    const ny=Math.max(0,Math.min(window.innerHeight-el.offsetHeight, oy+(t.clientY-startY)));
    el.style.left=nx+"px"; el.style.top=ny+"px";
  }, { passive: false });

  document.addEventListener("touchend", ()=>{ dragging=false; });
}

// ── Resizable ─────────────────────────────────────────────────────────────────
function _makeResizable(el, handle) {
  let resizing=false, startX=0, startY=0, startW=0, startH=0;

  handle.addEventListener("mousedown", e => {
    resizing=true;
    startX=e.clientX; startY=e.clientY;
    startW=el.offsetWidth; startH=el.offsetHeight;
    e.preventDefault(); e.stopPropagation();
  });

  document.addEventListener("mousemove", e => {
    if (!resizing) return;
    const w = Math.max(240, startW + (e.clientX-startX));
    const h = Math.max(200, startH + (e.clientY-startY));
    el.style.width  = w+"px";
    el.style.height = h+"px";
  });

  document.addEventListener("mouseup", ()=>{ resizing=false; });
}

// ── Injection CSS inline ──────────────────────────────────────────────────────
function _injectCSS() {
  if (document.getElementById("ba-float-style")) return;
  const s = document.createElement("style");
  s.id = "ba-float-style";
  s.textContent = `
/* ─── Widget flottant ────────────────────────────────────────────────── */
#ba-float {
  position: fixed;
  z-index: 9999;
  width: 320px;
  min-width: 240px;
  min-height: 200px;
  background: rgba(10,12,18,0.92);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: #e2e8f0;
  resize: none; /* géré en JS */
  transition: box-shadow .2s;
}
#ba-float:hover { box-shadow: 0 12px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08); }

/* ─── En-tête ───────────────────────────────────────────────────────── */
.ba-float-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  background: rgba(255,255,255,0.05);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  user-select: none;
  flex-shrink: 0;
}
.ba-float-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.7);
}
.ba-live-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
  box-shadow: 0 0 6px #22c55e;
  transition: background .3s, box-shadow .3s;
  animation: ba-pulse 2s infinite;
}
@keyframes ba-pulse {
  0%,100% { box-shadow: 0 0 4px currentColor; }
  50%      { box-shadow: 0 0 10px currentColor; }
}
.ba-float-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ba-fps {
  font-size: 9px;
  color: rgba(255,255,255,0.35);
  letter-spacing: .03em;
}
.ba-btn-collapse, .ba-btn-close {
  background: none;
  border: none;
  color: rgba(255,255,255,0.45);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 5px;
  border-radius: 4px;
  line-height: 1;
  transition: color .15s, background .15s;
}
.ba-btn-collapse:hover, .ba-btn-close:hover {
  color: #fff;
  background: rgba(255,255,255,0.10);
}

/* ─── Corps ─────────────────────────────────────────────────────────── */
.ba-float-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* ─── Caméra ─────────────────────────────────────────────────────────── */
.ba-cam-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4/3;
  background: #000;
  flex-shrink: 0;
  overflow: hidden;
}
.ba-cam-wrap video {
  display: block; width: 100%; height: 100%;
  object-fit: cover;
}
.ba-cam-wrap canvas {
  position: absolute; top:0; left:0;
  width:100%; height:100%;
  pointer-events: none;
}

/* ─── Grille données ─────────────────────────────────────────────────── */
.ba-data-grid {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ba-data-row {
  display: grid;
  grid-template-columns: 18px 1fr 18px 1fr;
  align-items: center;
  gap: 5px 8px;
}
.ba-data-icon {
  font-size: 13px;
  text-align: center;
}
.ba-data-info {
  display: flex; flex-direction: column; gap: 1px;
  min-width: 0;
}
.ba-data-lbl {
  font-size: 9px;
  color: rgba(255,255,255,0.38);
  text-transform: uppercase;
  letter-spacing: .04em;
  white-space: nowrap;
}
.ba-data-val {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color .25s;
}

/* ─── Barres ─────────────────────────────────────────────────────────── */
.ba-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}
.ba-bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ba-bar-lbl {
  width: 52px;
  font-size: 9.5px;
  color: rgba(255,255,255,0.4);
  flex-shrink: 0;
}
.ba-bar-track {
  flex: 1;
  height: 5px;
  background: rgba(255,255,255,0.09);
  border-radius: 3px;
  overflow: hidden;
}
.ba-bar-fill {
  height: 100%;
  width: 0;
  border-radius: 3px;
  transition: width .3s ease, background .3s ease;
}
.ba-bar-pct {
  width: 26px;
  text-align: right;
  font-size: 9.5px;
  color: rgba(255,255,255,0.45);
  flex-shrink: 0;
}

/* ─── Signaux ────────────────────────────────────────────────────────── */
.ba-signals-wrap {
  border-top: 1px solid rgba(255,255,255,0.07);
  padding-top: 6px;
  margin-top: 2px;
}
.ba-signals-hdr {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: rgba(255,255,255,0.35);
  margin-bottom: 5px;
}
.ba-signals-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 18px;
}
.ba-sig-empty {
  font-size: 10px;
  color: rgba(255,255,255,0.28);
  font-style: italic;
}
.ba-sig-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 20px;
  background: rgba(251,191,36,0.15);
  border: 1px solid rgba(251,191,36,0.32);
  color: #fbbf24;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}

/* ─── Poignée resize ─────────────────────────────────────────────────── */
.ba-resize-handle {
  position: absolute;
  bottom: 0; right: 0;
  width: 18px; height: 18px;
  cursor: nwse-resize;
  opacity: 0.4;
  transition: opacity .15s;
  background: 
    linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.5) 40%, rgba(255,255,255,0.5) 55%, transparent 55%),
    linear-gradient(135deg, transparent 55%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.5) 70%, transparent 70%);
}
.ba-resize-handle:hover { opacity: 1; }

/* ─── Scrollbar ──────────────────────────────────────────────────────── */
.ba-float-body::-webkit-scrollbar { width: 3px; }
.ba-float-body::-webkit-scrollbar-track { background: transparent; }
.ba-float-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
  `;
  document.head.appendChild(s);
}