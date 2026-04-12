import { TalkingHead } from '/TalkingHead-main/modules/talkinghead.mjs';

window._avatarReady = false;
window._head        = null;

// ── Initialisation de l'avatar ─────────────────────────────────────
window.initAvatar = async function () {
  try {
    window._head = new TalkingHead(document.getElementById('avatarDiv'), {
      ttsEndpoint   : null,
      cameraView    : 'upper',
      lipsyncLang   : 'fr',
      lipsyncModules: ['fr', 'en', 'ar'],
    });

    await window._head.showAvatar({
      url        : '/TalkingHead-main/avatars/avatar.glb',
      body       : 'F',
      avatarMood : 'happy',
      lipsyncLang: 'fr',
    });

    window._avatarReady = true;
    document.getElementById('avatar-loading').classList.add('hidden');
    document.getElementById('mic-btn').disabled = false;
    window.setStatus('', 'Ready');

  } catch (e) {
    console.error('TalkingHead error:', e);
    document.getElementById('avatar-loading').innerHTML =
      '<span style="color:var(--text-dim);font-size:10px;padding:8px">Avatar unavailable</span>';
    document.getElementById('mic-btn').disabled = false;
    window.setStatus('', 'Ready');
  }
};

// ── Mapping langue pour lipsync ───────────────────────────────────
function getLipsyncLang(lang) {
  const map = { fr: 'fr', en: 'en', ar: 'ar' };
  return map[lang] || 'fr';
}

// ── Fonction principale de parole avec lip-sync ───────────────────
window.speakWithAvatar = async function (text, forcedLang = null) {
  if (!window._avatarReady || !window._head || !text?.trim()) return;

  const head = window._head;
  const API  = window._API;

  try {
    const res = await fetch(`${API}/tts/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim(), lang: forcedLang || "auto" })
    });

    if (!res.ok) throw new Error(`TTS error ${res.status}`);
    const data = await res.json();
    if (!data.audio_b64) throw new Error("No audio_b64");

    const detectedLang = data.lang || forcedLang || 'fr';

    if (head.audioCtx.state !== "running") {
      await head.audioCtx.resume();
    }

    const binary = atob(data.audio_b64);
    const buf = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);

    const audioBuffer = await head.audioCtx.decodeAudioData(buf);
    const durationMs  = audioBuffer.duration * 1000;

    let words, wtimes, wdurations;

    if (detectedLang === 'ar') {
      // Pour l'arabe : timing par caractères arabes
      const arabicChars = [...text.replace(/\s+/g, '')].filter(c =>
        /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(c));
      if (arabicChars.length > 3) {
        const charDuration = durationMs / arabicChars.length;
        words      = arabicChars;
        wtimes     = arabicChars.map((_, i) => i * charDuration);
        wdurations = arabicChars.map(() => charDuration);
      } else {
        words = text.trim().split(/\s+/);
        const wd = durationMs / Math.max(words.length, 1);
        wtimes     = words.map((_, i) => i * wd);
        wdurations = words.map(() => wd);
      }
    } else {
      // Français & Anglais : découpage en lettres avec timing par mot
      const rawWords = text.trim().split(/\s+/);
      const wordDuration = durationMs / Math.max(rawWords.length, 1);

      words      = [];
      wtimes     = [];
      wdurations = [];

      rawWords.forEach((word, i) => {
        const wordStart = i * wordDuration;
        const letters   = word.split('');
        const letterDur = wordDuration / Math.max(letters.length, 1);

        letters.forEach((letter, j) => {
          words.push(letter);
          wtimes.push(wordStart + j * letterDur);
          wdurations.push(letterDur);
        });
      });
    }

    console.log(`🗣️ Speaking [${detectedLang.toUpperCase()}] → ${words.length} units | duration ${durationMs.toFixed(0)}ms`);

    const lipsyncLang = getLipsyncLang(detectedLang);

    head.speakAudio(
      { audio: audioBuffer, words, wtimes, wdurations },
      { lipsyncLang }
    );

    await new Promise(resolve => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (!head.isSpeaking && !head.isAudioPlaying) {
          clearInterval(checkInterval);
          resolve();
        }
        if (Date.now() - startTime > durationMs + 1500) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 80);
    });

  } catch (e) {
    console.error("❌ speakWithAvatar error:", e);
    console.warn("Falling back to simple audio playback");
  }
};