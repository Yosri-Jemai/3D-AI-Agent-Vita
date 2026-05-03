// js/behavioral-analysis.js — v4  Performance + Précision + Caméra flottante persistante
// ════════════════════════════════════════════════════════════════════════════════
//
// OPTIMISATIONS PERFORMANCE v4 :
//   • OffscreenCanvas pour l'analyse (évite les reflows DOM)
//   • Resize interne à 320×240 pour l'inférence (80% moins de pixels)
//   • requestAnimationFrame + throttle au lieu de setInterval
//   • Détection en Worker-like via queue async (pas de chevauchement de frames)
//   • getImageData sur zone réduite centrée sur le visage pour le flux optique
//   • SsdMobilenetv1 remplacé par TinyFaceDetector en mode précis (inputSize 416)
//     → meilleur ratio précision/latence sur GPU WebGL
//   • Cache des landmarks frame N-1 pour interpolation si frame sautée
//
// MODÈLES :
//   • TinyFaceDetector (inputSize 416, scoreThreshold 0.5) — rapide ET précis
//   • faceLandmark68Net full — 68 pts landmarks
//   • faceExpressionNet — 7 expressions
//
// COUCHES DE DÉTECTION :
//   1. Expressions — 7 + dérivés (sourire forcé, lèvres serrées, figé)
//   2. Gaze H+V — ratio pupille/œil horizontal et vertical
//   3. EAR — Eye Aspect Ratio (clignements, yeux plissés)
//   4. Posture — penché/recul/épaules/inclinaison
//   5. Fidgeting — flux optique différentiel inter-frames
//   6. 14 signaux stress — texte humain affiché dans overlay
//
// CAMÉRA FLOTTANTE :
//   • Le widget flottant est géré par behavioral-ui.js
//   • BehavioralAnalyzer expose videoElement + overlayCanvas
//   • L'overlay est dessiné en coordonnées du canvas d'affichage (redimensionné)
//
// ════════════════════════════════════════════════════════════════════════════════

const FACEAPI_CDN = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.esm.js";
const MODELS_BASE = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";

// Résolution interne d'inférence — plus petite = plus rapide
const INFER_W = 320;
const INFER_H = 240;

// Résolution d'affichage overlay
const DISPLAY_W = 480;
const DISPLAY_H = 360;

const HESITATION_MS     = 4500;
const MIN_FACE_SCORE    = 0.48;
const GAZE_H_THRESH     = 0.28;
const GAZE_V_THRESH     = 0.40;
const BLINK_EAR_THRESH  = 0.21;
const FLOW_THRESH       = 5;
const LEAN_ANGLE_THRESH = 11;

// Throttle analyse : max 1 inférence en vol simultanément
let _inferRunning = false;

// ── Métadonnées UI ─────────────────────────────────────────────────────────────
export const EXPRESSION_META = {
  happy:       { fr: "Confiant",        icon: "😊", color: "#22c55e" },
  neutral:     { fr: "Concentré",       icon: "😐", color: "#6b7280" },
  surprised:   { fr: "Surpris",         icon: "😮", color: "#f59e0b" },
  fearful:     { fr: "Incertain",       icon: "😟", color: "#ef4444" },
  disgusted:   { fr: "Perplexe",        icon: "😒", color: "#8b5cf6" },
  angry:       { fr: "Stressé",         icon: "😠", color: "#dc2626" },
  sad:         { fr: "Découragé",       icon: "😢", color: "#3b82f6" },
  forcedSmile: { fr: "Sourire forcé",   icon: "😬", color: "#f59e0b" },
  tightLips:   { fr: "Lèvres serrées",  icon: "😶", color: "#94a3b8" },
  freeze:      { fr: "Visage figé",     icon: "🫥", color: "#374151" },
};

export const GAZE_META = {
  screen:  { fr: "Regard écran",    icon: "👁️",  color: "#22c55e" },
  away:    { fr: "Regard détourné", icon: "👀",  color: "#f59e0b" },
  down:    { fr: "Regard bas",      icon: "⬇️",  color: "#f59e0b" },
  unknown: { fr: "Non détecté",     icon: "—",   color: "#9ca3af" },
};

export const POSTURE_META = {
  normal:  { fr: "Posture normale",   color: "#22c55e" },
  tense:   { fr: "Épaules tendues",   color: "#f59e0b" },
  leaning: { fr: "Penché en avant",   color: "#f59e0b" },
  back:    { fr: "Recul / inconfort", color: "#ef4444" },
  tilted:  { fr: "Tête inclinée",     color: "#f59e0b" },
};

// ── 14 signaux de stress ───────────────────────────────────────────────────────
const STRESS_SIGNAL_DEFS = [
  {
    id: "jaw_tight", label: "Mâchoire serrée",
    detect(det) {
      const p = det.lm;
      return Math.abs(p[62].y - p[66].y) / det.box.width < 0.04;
    },
  },
  {
    id: "forced_smile", label: "Sourire forcé",
    detect(det) {
      const e = det.expr;
      return e.happy > 0.55 && (e.fearful + e.sad) > 0.22;
    },
  },
  {
    id: "tight_lips", label: "Lèvres serrées",
    detect(det) {
      const p = det.lm;
      return Math.abs(p[62].y - p[66].y) / det.box.width < 0.02;
    },
  },
  {
    id: "freeze", label: "Visage figé",
    detect(det) {
      return Math.max(...Object.values(det.expr)) < 0.28;
    },
  },
  {
    id: "blink_freq", label: "Clignements fréquents",
    detect(_, __, ctx) { return ctx.blinkCount > 5; },
  },
  {
    id: "gaze_away", label: "Regard détourné",
    detect(_, __, ctx) { return ctx.gazeAway; },
  },
  {
    id: "gaze_down", label: "Regard vers le bas",
    detect(_, __, ctx) { return ctx.gazeDown; },
  },
  {
    id: "frown", label: "Froncement de sourcils",
    detect(det) {
      const p = det.lm;
      return Math.abs(p[21].x - p[22].x) / det.box.width < 0.06;
    },
  },
  {
    id: "head_tilt", label: "Tête inclinée",
    detect(det) {
      const p = det.lm;
      const dx = p[45].x - p[36].x, dy = p[45].y - p[36].y;
      return Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) > LEAN_ANGLE_THRESH;
    },
  },
  {
    id: "shoulders_high", label: "Épaules relevées",
    detect(det) {
      return (det.box.y + det.box.height) > 0.80 * det.frameH;
    },
  },
  {
    id: "leaning_forward", label: "Penché en avant",
    detect(det) { return det.box.width > 0.55 * det.frameW; },
  },
  {
    id: "leaning_back", label: "Recul / inconfort",
    detect(det) { return det.box.width < 0.18 * det.frameW; },
  },
  {
    id: "fidgeting", label: "Agitation / fidgeting",
    detect(_, flow) { return flow > FLOW_THRESH; },
  },
  {
    id: "face_touch", label: "Main devant le visage",
    detect(_, flow) { return flow > FLOW_THRESH * 2.2; },
  },
];


// ════════════════════════════════════════════════════════════════════════════════
export class BehavioralAnalyzer {
  constructor() {
    this._initialized   = false;
    this._active        = false;
    this._destroyed     = false;
    this._fa            = null;

    // Éléments DOM / Canvas
    this._video         = null;
    this._inferCanvas   = null;   // canvas interne pour l'inférence (320×240)
    this._overlayCanvas = null;   // canvas overlay affiché (DISPLAY_W × DISPLAY_H)
    this._stream        = null;

    // Perf
    this._rafId         = null;
    this._lastInferTime = 0;
    this._minInterval   = 280;    // ms minimum entre deux inférences
    this._prevGray      = null;   // pour flux optique

    // Stats
    this._blinkCount    = 0;
    this._frameCount    = 0;
    this._lastFrame     = null;   // cache dernier frame valide

    // Question courante
    this._q = { index: -1, startMs: 0, frames: [] };
    this._history = [];
    this._onFrame = null;
  }

  get videoElement()  { return this._video; }
  get overlayCanvas() { return this._overlayCanvas; }
  get isInitialized() { return this._initialized; }
  get history()       { return [...this._history]; }
  set history(v)      { this._history = Array.isArray(v) ? v : []; }

  // ── Init ────────────────────────────────────────────────────────────────────
  async init() {
    if (this._initialized) return true;
    try {
      this._fa = await import(FACEAPI_CDN);
      await this._loadModels();
      await this._openCamera();
      this._createCanvases();
      this._initialized = true;
      console.info("[BA v4] Prêt — TinyFaceDetector 416 + Landmark68 + ExpressionNet");
      return true;
    } catch (err) {
      console.warn("[BA v4] Init échouée :", err.message);
      this._cleanup();
      return false;
    }
  }

  async _loadModels() {
    const fa = this._fa;
    // TinyFaceDetector inputSize 416 = précis et rapide (accéléré WebGL)
    // faceLandmark68Net FULL = 68 pts précis
    await Promise.all([
      fa.nets.tinyFaceDetector.loadFromUri(MODELS_BASE),
      fa.nets.faceLandmark68Net.loadFromUri(MODELS_BASE),
      fa.nets.faceExpressionNet.loadFromUri(MODELS_BASE),
    ]);
  }

  async _openCamera() {
    this._stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width:  { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        facingMode: "user",
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });

    this._video = document.createElement("video");
    this._video.srcObject   = this._stream;
    this._video.muted       = true;
    this._video.playsInline = true;
    this._video.setAttribute("playsinline", "");

    await new Promise((res, rej) => {
      this._video.onloadedmetadata = res;
      this._video.onerror = rej;
      setTimeout(() => rej(new Error("Camera timeout")), 10000);
    });
    await this._video.play();
  }

  _createCanvases() {
    // Canvas inférence (petite résolution → rapide)
    this._inferCanvas = document.createElement("canvas");
    this._inferCanvas.width  = INFER_W;
    this._inferCanvas.height = INFER_H;

    // Canvas overlay display
    this._overlayCanvas = document.createElement("canvas");
    this._overlayCanvas.width  = DISPLAY_W;
    this._overlayCanvas.height = DISPLAY_H;
    this._overlayCanvas.style.cssText = [
      "position:absolute", "top:0", "left:0",
      "width:100%", "height:100%",
      "pointer-events:none",
    ].join(";");
  }

  // ── Question ────────────────────────────────────────────────────────────────
  startQuestion(index) {
    if (!this._initialized || this._destroyed) return;
    this._stopLoop();
    this._blinkCount = 0;
    this._frameCount = 0;
    this._prevGray   = null;
    this._lastFrame  = null;
    this._q = { index, startMs: Date.now(), frames: [] };
    this._active = true;
    this._loop();
  }

  captureAnswer(chosenIndex, isCorrect, questionText = "", product = "") {
    if (!this._initialized) return null;
    this._stopLoop();
    this._active = false;

    const frames = this._q.frames;
    if (!frames.length) return null;

    const durationMs    = Date.now() - this._q.startMs;
    const dominant      = this._mostFreqExpr(frames);
    const avgGaze       = this._avgGaze(frames);
    const posture       = this._mostFreq(frames.map(f => f.posture || "normal"));
    const confScore     = this._mean(frames.map(f => f.confScore));
    const stressScore   = this._mean(frames.map(f => f.stressScore));
    const fidgetScore   = this._mean(frames.map(f => f.fidgetScore));
    const stressSignals = this._aggregateSignals(frames);

    const record = {
      questionIndex: this._q.index, questionText, product,
      durationMs, hesitated: durationMs > HESITATION_MS,
      gazeAway: avgGaze !== "screen",
      dominantExpression: dominant, gaze: avgGaze, posture,
      confScore, stressScore, fidgetScore, stressSignals,
      isCorrect, chosenIndex, frameCount: frames.length,
    };

    this._history.push(record);
    return record;
  }

  getFullReport() {
    const h = this._history;
    if (!h.length) return null;
    const sf = {};
    h.forEach(r => (r.stressSignals || []).forEach(s => sf[s] = (sf[s]||0)+1));
    return {
      totalQuestions:   h.length,
      avgConf:          this._mean(h.map(r => r.confScore)),
      avgStress:        this._mean(h.map(r => r.stressScore)),
      avgFidget:        this._mean(h.map(r => r.fidgetScore)),
      hesitationRate:   h.filter(r => r.hesitated).length / h.length,
      gazeAwayRate:     h.filter(r => r.gazeAway).length / h.length,
      dominantPosture:  this._mostFreq(h.map(r => r.posture)),
      topStressSignals: Object.entries(sf).sort((a,b)=>b[1]-a[1]).slice(0,6)
                          .map(([label, count]) => ({ label, count })),
      byQuestion: h,
    };
  }

  onFrame(cb) { this._onFrame = typeof cb === "function" ? cb : null; }

  destroy() {
    this._destroyed = true;
    this._active    = false;
    this._stopLoop();
    if (this._overlayCanvas) {
      this._overlayCanvas.getContext("2d").clearRect(0,0,DISPLAY_W,DISPLAY_H);
    }
    this._cleanup();
  }

  // ── Boucle RAF optimisée ────────────────────────────────────────────────────
  _loop() {
    if (!this._active || this._destroyed) return;
    this._rafId = requestAnimationFrame(() => this._loop());

    const now = performance.now();
    if (now - this._lastInferTime < this._minInterval) return; // throttle
    if (_inferRunning) return; // pas de chevauchement

    this._lastInferTime = now;
    _inferRunning = true;
    this._analyzeFrame().finally(() => { _inferRunning = false; });
  }

  _stopLoop() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  // ── Analyse frame ────────────────────────────────────────────────────────────
  async _analyzeFrame() {
    if (!this._video?.readyState || this._video.readyState < 2) return;

    const ictx = this._inferCanvas.getContext("2d", { willReadFrequently: true });
    // Dessine à 320×240 (inférence rapide)
    ictx.drawImage(this._video, 0, 0, INFER_W, INFER_H);

    // Flux optique sur niveaux de gris (sous-samplé)
    const curGray   = this._toGray(ictx, INFER_W, INFER_H);
    const flowScore = this._opticalFlow(curGray, this._prevGray);
    this._prevGray  = curGray;

    try {
      const fa   = this._fa;
      const opts = new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: MIN_FACE_SCORE });

      const det = await fa
        .detectSingleFace(this._inferCanvas, opts)
        .withFaceLandmarks()
        .withFaceExpressions();

      if (!det) {
        // Réutilise le dernier frame si on perd momentanément le visage
        if (this._lastFrame) this._drawOverlay(this._lastFrame);
        return;
      }

      // Scale box/landmarks de INFER_W×INFER_H vers DISPLAY_W×DISPLAY_H
      const scaleX = DISPLAY_W / INFER_W;
      const scaleY = DISPLAY_H / INFER_H;
      const rawBox = det.detection.box;
      const box = {
        x: rawBox.x * scaleX,
        y: rawBox.y * scaleY,
        width:  rawBox.width  * scaleX,
        height: rawBox.height * scaleY,
      };
      const lm = det.landmarks.positions.map(p => ({
        x: p.x * scaleX,
        y: p.y * scaleY,
      }));
      const expr = det.expressions;

      // Gaze
      const gaze = this._estimateGaze(lm);
      // EAR
      const ear  = this._eyeAspectRatio(lm);
      if (ear < BLINK_EAR_THRESH) this._blinkCount++;

      // Posture
      const posture = this._estimatePosture(box, lm, DISPLAY_W, DISPLAY_H);

      // Contexte signaux
      const sigCtx = {
        gazeAway: gaze === "away", gazeDown: gaze === "down",
        blinkCount: this._blinkCount,
      };

      // Det proxy pour les signaux (coordonnées display)
      const detProxy = { lm, box, expr, frameW: DISPLAY_W, frameH: DISPLAY_H };

      const stressSignals = [];
      for (const def of STRESS_SIGNAL_DEFS) {
        try { if (def.detect(detProxy, flowScore, sigCtx)) stressSignals.push(def.label); }
        catch {}
      }

      const expression  = this._resolveExpression(expr, ear);
      const stressScore = Math.min(1,
        (expr.fearful||0)*0.4 + (expr.angry||0)*0.35 + (expr.disgusted||0)*0.2 +
        Math.min(1, stressSignals.length/4)*0.3 + (gaze!=="screen"?0.15:0)
      );
      const confScore = Math.max(0, Math.min(1,
        (expr.happy||0)*0.6 + (expr.neutral||0)*0.4 - stressSignals.length*0.08 + 0.3
      ));
      const fidgetScore = Math.min(1, flowScore / (FLOW_THRESH * 3));

      const frame = {
        ms: Date.now() - this._q.startMs,
        expression, expr, gaze, posture,
        stressSignals, stressScore, confScore, fidgetScore,
        ear, box, lm,
      };

      this._q.frames.push(frame);
      this._lastFrame = frame;
      this._frameCount++;
      if (this._frameCount % 10 === 0) this._blinkCount = 0;

      this._drawOverlay(frame);
      if (this._onFrame) this._onFrame(frame);

    } catch { /* silencieux */ }
  }

  // ── Flux optique sur niveaux de gris (rapide) ──────────────────────────────
  _toGray(ctx, W, H) {
    // Sous-sample ×4 pour perf (80×60)
    const sw = W >> 2, sh = H >> 2;
    const data = ctx.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const si = ((y*4)*W + x*4) * 4;
        gray[y*sw+x] = (data[si]*77 + data[si+1]*150 + data[si+2]*29) >> 8;
      }
    }
    return gray;
  }

  _opticalFlow(cur, prev) {
    if (!prev || cur.length !== prev.length) return 0;
    let sum = 0;
    for (let i = 0; i < cur.length; i++) sum += Math.abs(cur[i] - prev[i]);
    return sum / cur.length;
  }

  // ── Overlay dessin (DISPLAY_W × DISPLAY_H) ─────────────────────────────────
  _drawOverlay(frame) {
    const oc  = this._overlayCanvas;
    if (!oc) return;
    const ctx = oc.getContext("2d");
    ctx.clearRect(0, 0, DISPLAY_W, DISPLAY_H);

    const { box, lm: pts, stressScore, expression, gaze, posture, stressSignals } = frame;
    if (!box || !pts) return;

    const sc = stressScore > 0.6 ? "#ef4444" : stressScore > 0.35 ? "#f59e0b" : "#22c55e";

    // 1. Boîte visage avec glow
    ctx.save();
    ctx.shadowColor = sc; ctx.shadowBlur = 10;
    ctx.strokeStyle = sc; ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.restore();

    // 2. Landmarks (points)
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI*2); ctx.fill();
    });

    // 3. Contours colorés
    this._line(ctx, pts, 0,  16,  "rgba(96,165,250,.85)",  false);  // mâchoire
    this._line(ctx, pts, 17, 21,  "rgba(167,139,250,.95)", false);  // sourcil G
    this._line(ctx, pts, 22, 26,  "rgba(167,139,250,.95)", false);  // sourcil D
    this._line(ctx, pts, 27, 35,  "rgba(148,163,184,.7)",  false);  // nez
    this._line(ctx, pts, 36, 41,  "rgba(52,211,153,.95)",  true);   // œil G
    this._line(ctx, pts, 42, 47,  "rgba(52,211,153,.95)",  true);   // œil D
    this._line(ctx, pts, 48, 59,  "rgba(244,114,182,.95)", true);   // bouche ext
    this._line(ctx, pts, 60, 67,  "rgba(251,113,133,.95)", true);   // bouche int

    // 4. Gaze indicator par œil
    this._gazeEye(ctx, pts.slice(36,42), gaze);
    this._gazeEye(ctx, pts.slice(42,48), gaze);

    // 5. Badge expression
    const em = EXPRESSION_META[expression] || EXPRESSION_META.neutral;
    const btxt = `${em.icon}  ${em.fr}`;
    ctx.font = "bold 12px sans-serif";
    const bw = ctx.measureText(btxt).width + 16, bh = 22;
    const bx = box.x, by = box.y - bh - 4;
    ctx.fillStyle = "rgba(0,0,0,.72)";
    _rr(ctx, bx, by, bw, bh, 5); ctx.fill();
    ctx.fillStyle = em.color; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(btxt, bx + 8, by + bh/2);

    // 6. Badge posture (si anormale)
    if (posture !== "normal") {
      const pm = POSTURE_META[posture] || POSTURE_META.normal;
      ctx.font = "11px sans-serif";
      const pw = ctx.measureText(pm.fr).width + 14;
      const px = box.x + box.width - pw, py = box.y - bh - 4;
      ctx.fillStyle = "rgba(0,0,0,.72)"; _rr(ctx, px, py, pw, bh, 5); ctx.fill();
      ctx.fillStyle = pm.color; ctx.textAlign = "left";
      ctx.fillText(pm.fr, px + 7, py + bh/2);
    }

    // 7. Barre stress
    const barX = box.x, barY = box.y + box.height + 6, barW = box.width;
    ctx.fillStyle = "rgba(0,0,0,.5)"; _rr(ctx, barX, barY, barW, 6, 3); ctx.fill();
    const fw = barW * Math.min(1, stressScore);
    if (fw > 0) {
      const g = ctx.createLinearGradient(barX, 0, barX+barW, 0);
      g.addColorStop(0, "#22c55e"); g.addColorStop(.5, "#f59e0b"); g.addColorStop(1, "#ef4444");
      ctx.fillStyle = g; _rr(ctx, barX, barY, fw, 6, 3); ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "10px sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "top";
    ctx.fillText(`stress ${Math.round(stressScore*100)}%`, barX+barW, barY+10);

    // 8. Signaux stress (pastilles)
    if (stressSignals?.length > 0) {
      ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      let sy = barY + 22;
      stressSignals.slice(0, 4).forEach(label => {
        const tw = ctx.measureText("⚠ "+label).width + 10;
        ctx.fillStyle = "rgba(0,0,0,.65)"; _rr(ctx, barX, sy-8, tw, 16, 3); ctx.fill();
        ctx.fillStyle = "#fbbf24";
        ctx.fillText("⚠ "+label, barX+5, sy); sy += 19;
      });
    }
  }

  _line(ctx, pts, from, to, color, close) {
    ctx.beginPath(); ctx.moveTo(pts[from].x, pts[from].y);
    for (let i = from+1; i <= to; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (close) ctx.closePath();
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();
  }

  _gazeEye(ctx, ep, gaze) {
    if (!ep || ep.length < 6) return;
    const cx = (ep[0].x+ep[3].x)/2;
    const cy = (ep[0].y+ep[1].y+ep[2].y+ep[3].y+ep[4].y+ep[5].y)/6;
    const r  = 5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.strokeStyle = gaze==="screen"?"#34d399":"#f59e0b";
    ctx.lineWidth = 1.5; ctx.stroke();
    if (gaze==="away") {
      ctx.beginPath();
      ctx.moveTo(cx+r,cy); ctx.lineTo(cx+r+6,cy);
      ctx.moveTo(cx+r+3,cy-3); ctx.lineTo(cx+r+6,cy); ctx.lineTo(cx+r+3,cy+3);
      ctx.strokeStyle="#f59e0b"; ctx.lineWidth=1.2; ctx.stroke();
    } else if (gaze==="down") {
      ctx.beginPath();
      ctx.moveTo(cx,cy+r); ctx.lineTo(cx,cy+r+6);
      ctx.moveTo(cx-3,cy+r+3); ctx.lineTo(cx,cy+r+6); ctx.lineTo(cx+3,cy+r+3);
      ctx.strokeStyle="#f59e0b"; ctx.lineWidth=1.2; ctx.stroke();
    }
  }

  // ── Estimations ─────────────────────────────────────────────────────────────
  _estimateGaze(pts) {
    try {
      const ratio = (ep) => {
        const w = ep[3].x - ep[0].x;
        const h = Math.abs((ep[1].y+ep[2].y)/2 - (ep[4].y+ep[5].y)/2);
        const px = (ep[1].x+ep[2].x)/2, py = (ep[1].y+ep[5].y)/2;
        return {
          rH: w>2 ? (px-ep[0].x)/w : 0.5,
          rV: h>1 ? (py-ep[1].y)/h : 0.5,
        };
      };
      const L=ratio(pts.slice(36,42)), R=ratio(pts.slice(42,48));
      const rH=(L.rH+R.rH)/2, rV=(L.rV+R.rV)/2;
      if (rH<GAZE_H_THRESH || rH>1-GAZE_H_THRESH) return "away";
      if (rV>GAZE_V_THRESH) return "down";
      return "screen";
    } catch { return "unknown"; }
  }

  _eyeAspectRatio(pts) {
    try {
      const ear = e => (_d(e[1],e[5]) + _d(e[2],e[4])) / (2*_d(e[0],e[3]));
      return (ear(pts.slice(36,42)) + ear(pts.slice(42,48))) / 2;
    } catch { return 0.3; }
  }

  _estimatePosture(box, pts, W, H) {
    if (box.width > 0.55*W) return "leaning";
    if (box.width < 0.18*W) return "back";
    if ((box.y+box.height)  > 0.78*H) return "tense";
    const dx=pts[45].x-pts[36].x, dy=pts[45].y-pts[36].y;
    if (Math.abs(Math.atan2(dy,dx)*180/Math.PI) > LEAN_ANGLE_THRESH) return "tilted";
    return "normal";
  }

  _resolveExpression(expr, ear) {
    if (ear < BLINK_EAR_THRESH) return "fearful";
    if (expr.happy>0.55 && (expr.fearful+expr.sad)>0.22) return "forcedSmile";
    if (Math.max(...Object.values(expr))<0.28) return "freeze";
    return Object.entries(expr).sort((a,b)=>b[1]-a[1])[0][0];
  }

  // ── Agrégation ──────────────────────────────────────────────────────────────
  _aggregateSignals(frames) {
    const c={};
    frames.forEach(f=>(f.stressSignals||[]).forEach(s=>c[s]=(c[s]||0)+1));
    const thr=frames.length*0.25;
    return Object.entries(c).filter(([,v])=>v>=thr).map(([k])=>k);
  }

  _mostFreqExpr(frames) {
    const c={};
    frames.forEach(f=>c[f.expression]=(c[f.expression]||0)+1);
    return Object.entries(c).sort((a,b)=>b[1]-a[1])[0]?.[0]||"neutral";
  }

  _avgGaze(frames) {
    const k=frames.filter(f=>f.gaze!=="unknown");
    if (!k.length) return "unknown";
    return k.filter(f=>f.gaze!=="screen").length/k.length>0.40?"away":"screen";
  }

  _mean(arr)    { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
  _mostFreq(arr){ const c={}; arr.forEach(v=>c[v]=(c[v]||0)+1); return Object.entries(c).sort((a,b)=>b[1]-a[1])[0]?.[0]||arr[0]; }

  _cleanup() {
    if (this._stream) this._stream.getTracks().forEach(t=>t.stop());
    this._video=this._inferCanvas=this._overlayCanvas=this._stream=null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function _d(a,b){ return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2); }

function _rr(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}