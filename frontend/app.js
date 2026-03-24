import { TalkingHead } from './TalkingHead-main/modules/talkinghead.mjs';

const micBtn    = document.getElementById('micBtn');
const statusMsg = document.getElementById('statusMsg');
const subtitles = document.getElementById('subtitles');
const avatarDiv = document.getElementById('avatarDiv');

let head          = null;
let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;
let isProcessing  = false;

// ── INIT AVATAR ──────────────────────────────
async function initAvatar() {
    statusMsg.textContent = '⏳ Chargement avatar...';
    try {
        head = new TalkingHead(avatarDiv, {
            ttsEndpoint: null,
            cameraView: 'upper',
            lipsyncLang: 'fr',
            // ✅ Ajouter fr et ar aux modules chargés !
            lipsyncModules: ['fi', 'en', 'lt', 'fr', 'ar'],
        });
        await head.showAvatar({
            url: './TalkingHead-main/avatars/avatar.glb',
            body: 'F',
            avatarMood: 'happy',
            lipsyncLang: 'fr',
        });
        statusMsg.textContent = '✅ Prêt ! Appuyez sur le micro pour parler.';
        micBtn.disabled = false;
    } catch(e) {
        statusMsg.textContent = '❌ Erreur avatar : ' + e.message;
        console.error(e);
    }
}

// ── LANGUE LIP SYNC ───────────────────────────
function getLipsyncLang(lang) {
    const map = {
        'fr': 'fr',
        'en': 'en',
        'ar': 'ar',  // ✅ module arabe custom chargé !
        'de': 'de',
        'fi': 'fi',
    };
    return map[lang] || 'en';
}

// ── MICRO : start/stop ────────────────────────
async function startRecording() {
    if (isProcessing) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks  = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            await processAudio(blob);
        };

        mediaRecorder.start();
        isRecording = true;
        micBtn.classList.add('recording');
        micBtn.textContent = '⏹';
        statusMsg.textContent = '🎤 Écoute... Appuyez pour arrêter.';

    } catch(e) {
        statusMsg.textContent = '❌ Micro inaccessible : ' + e.message;
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.classList.add('processing');
        micBtn.textContent = '⏳';
        micBtn.disabled = true;
        statusMsg.textContent = '⏳ Traitement...';
    }
}

// ── PIPELINE COMPLET ──────────────────────────
async function processAudio(audioBlob) {
    isProcessing = true;
    try {
        statusMsg.textContent = '📝 Transcription...';
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.webm');

        const sttRes = await fetch('http://localhost:8000/api/transcribe', {
            method: 'POST',
            body: formData
        });
        if (!sttRes.ok) throw new Error('Erreur STT');
        const sttData = await sttRes.json();
        const userText = sttData.text;
        const lang     = sttData.lang;

        if (!userText) {
            statusMsg.textContent = '⚠️ Rien entendu, réessayez.';
            return;
        }

        subtitles.innerHTML = `<span class="user">👤 ${userText}</span>`;

        statusMsg.textContent = '🧠 Réflexion...';
        const llmRes = await fetch('http://localhost:8000/api/think', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: userText, lang })
        });
        if (!llmRes.ok) throw new Error('Erreur LLM');
        const llmData = await llmRes.json();
        const response = llmData.response;

        subtitles.innerHTML += `<span class="avatar">🤖 ${response}</span>`;

        statusMsg.textContent = '🔊 Synthèse...';
        const ttsRes = await fetch('http://localhost:8000/api/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: response, lang })
        });
        if (!ttsRes.ok) throw new Error('Erreur TTS');
        const ttsData = await ttsRes.json();

        statusMsg.textContent = '🗣️ Avatar parle...';
        await speakAvatar(ttsData.audio, response, lang);
        statusMsg.textContent = '✅ Appuyez pour reparler.';

    } catch(e) {
        statusMsg.textContent = '❌ Erreur : ' + e.message;
        console.error(e);
    } finally {
        isProcessing = false;
        micBtn.disabled  = false;
        micBtn.classList.remove('processing');
        micBtn.textContent = '🎤';
    }
}

// ── AVATAR PARLE AVEC LIP SYNC ────────────────
async function speakAvatar(audioB64, text, lang) {
    if (head.audioCtx.state !== 'running') {
        await head.audioCtx.resume();
    }

    const binary = atob(audioB64);
    const buffer = new ArrayBuffer(binary.length);
    const view   = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);

    const audioBuffer = await head.audioCtx.decodeAudioData(buffer);
    const lipsyncLang = getLipsyncLang(lang);
    const duration    = audioBuffer.duration * 1000;

    // Pour l'arabe → utiliser les caractères comme mots
    let words, wtimes, wdurations;
    if (lang === 'ar') {
        const chars = [...text.replace(/\s+/g, '')].filter(c => /[\u0600-\u06FF]/.test(c));
        if (chars.length > 0) {
            const charDur = duration / chars.length;
            words      = chars;
            wtimes     = chars.map((_, i) => i * charDur);
            wdurations = chars.map(() => charDur);
        } else {
            words      = text.trim().split(/\s+/);
            const wd   = duration / words.length;
            wtimes     = words.map((_, i) => i * wd);
            wdurations = words.map(() => wd);
        }
    } else {
        words      = text.trim().split(/\s+/);
        const wd   = duration / words.length;
        wtimes     = words.map((_, i) => i * wd);
        wdurations = words.map(() => wd);
    }

    console.log(`🗣️ lipsync: ${lang} → ${lipsyncLang}, ${words.length} mots`);

    head.speakAudio(
        { audio: audioBuffer, words, wtimes, wdurations },
        { lipsyncLang }
    );

    await new Promise((resolve) => {
        const check = setInterval(() => {
            if (!head.isSpeaking && !head.isAudioPlaying) {
                clearInterval(check);
                resolve();
            }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); },
            audioBuffer.duration * 1000 + 2000);
    });
}

// ── BOUTON MICRO ──────────────────────────────
micBtn.addEventListener('click', async () => {
    if (head?.audioCtx) {
        if (head.audioCtx.state === 'suspended' || head.audioCtx.state === 'interrupted') {
            await head.audioCtx.resume();
        }
    }
    if (isProcessing) return;
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
});

// ── DÉMARRAGE ────────────────────────────────
micBtn.disabled = true;
initAvatar();