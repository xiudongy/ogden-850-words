// ===== Word Fun - Basic English 850 Learning App =====
// Vanilla JS, no build step. All data lives in localStorage.

// ===== Lucide Icon Helper =====
function icon(name, size) {
  const cls = size <= 16 ? 'icon-sm' : size <= 20 ? 'icon-md' : size <= 28 ? 'icon-lg' : '';
  const style = cls ? '' : `style="width:${size || 24}px;height:${size || 24}px;"`;
  return `<i data-lucide="${name}" class="${cls}" ${style}></i>`;
}

function refreshIcons() {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// ===== Dates =====
function isoDate(d) {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}
function daysSince(ts) {
  if (!ts) return 7;
  return Math.min(7, Math.floor((Date.now() - ts) / 86400000));
}

// ===== Storage =====
const STORAGE_KEY = 'wordfun_progress';
let storageOk = true;

function probeStorage() {
  try {
    localStorage.setItem('wordfun_probe', '1');
    localStorage.removeItem('wordfun_probe');
    storageOk = true;
  } catch {
    storageOk = false;
    const banner = document.getElementById('storage-banner');
    if (banner) banner.style.display = '';
  }
}

function loadProgress() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

function saveProgress(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') {
      data.recentWords = (data.recentWords || []).slice(0, 5);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return; } catch {}
    }
    storageOk = false;
    const banner = document.getElementById('storage-banner');
    if (banner) banner.style.display = '';
  }
}

function defaultProgress() {
  return {
    v: 2,
    words: {},
    stars: 0,
    starsSpent: 0,
    streak: 0,
    lastDate: null,
    recentWords: [],
    levels: {},
    dailyLog: {},
    owned: [],
    activeTheme: 'default',
    repairCards: 0,
    celebrated: {}
  };
}

// One-time migration: clean Chinese ghost keys written by the old quiz bug,
// normalize lastDate to ISO, fill new fields.
function migrateProgress(saved) {
  const p = defaultProgress();
  if (!saved || typeof saved !== 'object') return p;
  if (saved.words && typeof saved.words === 'object' && !Array.isArray(saved.words)) {
    for (const [key, val] of Object.entries(saved.words)) {
      if (findWordZh(key) === '') continue; // ghost key (e.g. Chinese text) — drop
      p.words[key] = {
        status: ['new', 'learning', 'mastered'].includes(val.status) ? val.status : 'new',
        lastSeen: Number(val.lastSeen) || 0,
        correct: Number(val.correct) || 0,
        wrong: Number(val.wrong) || 0,
        recent: Array.isArray(val.recent) ? val.recent.slice(-3) : []
      };
    }
  }
  p.stars = Number(saved.stars) || 0;
  p.starsSpent = Number(saved.starsSpent) || 0;
  p.streak = Number(saved.streak) || 0;
  if (saved.lastDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(saved.lastDate)) {
      p.lastDate = saved.lastDate;
    } else {
      const d = new Date(saved.lastDate);
      p.lastDate = isNaN(d.getTime()) ? null : isoDate(d);
    }
  }
  p.recentWords = (Array.isArray(saved.recentWords) ? saved.recentWords : [])
    .filter(w => w && w.en && findWordZh(w.en) !== '')
    .map(w => ({ en: w.en, zh: findWordZh(w.en), timestamp: w.timestamp || 0 }))
    .slice(0, 20);
  p.levels = (saved.levels && typeof saved.levels === 'object') ? saved.levels : {};
  p.dailyLog = (saved.dailyLog && typeof saved.dailyLog === 'object') ? saved.dailyLog : {};
  p.owned = Array.isArray(saved.owned) ? saved.owned : [];
  p.activeTheme = saved.activeTheme || 'default';
  p.repairCards = Number(saved.repairCards) || 0;
  p.celebrated = (saved.celebrated && typeof saved.celebrated === 'object') ? saved.celebrated : {};
  return p;
}

let progressCache = null;
function getProgress() {
  if (!progressCache) {
    const saved = loadProgress();
    progressCache = migrateProgress(saved);
    saveProgress(progressCache);
  }
  return progressCache;
}
function persist() {
  saveProgress(getProgress());
}
function resetAllProgress() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  progressCache = null;
  getProgress();
}

// ===== Word lookup =====
let wordZhMap = null;
function findWordZh(en) {
  if (!wordZhMap) {
    wordZhMap = {};
    getAllWords().forEach(w => { wordZhMap[w.en.toLowerCase()] = w.zh; });
  }
  return wordZhMap[String(en).toLowerCase()] || '';
}
function wordEmoji(en) {
  return (typeof WORD_EMOJI !== 'undefined' && WORD_EMOJI[en]) || '';
}

// ===== Unified word state machine =====
// sources: 'flashcard' (self-assessed) | 'quiz' | 'spelling' | 'dictation' (objective)
// memory matches go through recordSeen() and never touch correct/wrong.
const OBJECTIVE_SOURCES = ['quiz', 'spelling', 'dictation'];

function ensureWord(progress, en) {
  if (!progress.words[en]) {
    progress.words[en] = { status: 'new', lastSeen: 0, correct: 0, wrong: 0, recent: [] };
  }
  if (!Array.isArray(progress.words[en].recent)) progress.words[en].recent = [];
  return progress.words[en];
}

function touchRecentWords(progress, en) {
  progress.recentWords = progress.recentWords.filter(w => w.en !== en);
  progress.recentWords.unshift({ en, zh: findWordZh(en), timestamp: Date.now() });
  if (progress.recentWords.length > 20) progress.recentWords = progress.recentWords.slice(0, 20);
}

function bumpDaily(progress, isCorrect, isNewWord) {
  const today = isoDate();
  if (!progress.dailyLog[today]) progress.dailyLog[today] = { answered: 0, correct: 0, newWords: 0 };
  const log = progress.dailyLog[today];
  log.answered++;
  if (isCorrect) log.correct++;
  if (isNewWord) log.newWords++;
  // keep the log bounded (last 60 days)
  const keys = Object.keys(progress.dailyLog).sort();
  while (keys.length > 60) progress.dailyLog && delete progress.dailyLog[keys.shift()];
}

// Streak counts only on real learning activity (first answer of the day).
function updateStreakOnLearn(progress) {
  const today = isoDate();
  if (progress.lastDate === today) return;
  const yesterday = isoDaysAgo(1);
  if (progress.lastDate === yesterday) {
    progress.streak++;
  } else if (progress.lastDate === null) {
    progress.streak = 1;
  } else if (progress.lastDate === isoDaysAgo(2) && progress.repairCards > 0) {
    // missed exactly one day but owns a repair card — auto-use it
    progress.repairCards--;
    progress.streak++;
    showToast('🔥 用掉一张补签卡，连续天数保住啦！');
  } else {
    progress.streak = 1;
  }
  progress.lastDate = today;
}

function recordResult(en, isCorrect, source, opts) {
  opts = opts || {};
  const progress = getProgress();
  const w = ensureWord(progress, en);
  const wasNew = w.status === 'new';
  w.lastSeen = Date.now();
  w.recent.push(!!isCorrect);
  if (w.recent.length > 3) w.recent = w.recent.slice(-3);
  const objective = OBJECTIVE_SOURCES.includes(source);

  if (isCorrect) {
    if (!opts.noMastery) w.correct++;
    if (w.status === 'new') w.status = 'learning';
    if (objective && !opts.noMastery && w.correct >= 4 && w.status !== 'mastered') {
      w.status = 'mastered';
    }
  } else {
    w.wrong++;
    // Demote only on the last-2-wrong rule, and never below 'learning'.
    const r = w.recent;
    if (w.status === 'mastered' && r.length >= 2 && !r[r.length - 1] && !r[r.length - 2]) {
      w.status = 'learning';
    }
    if (w.status === 'new' && source === 'flashcard') {
      // stays 'new' — the kid says they don't know it yet
    }
  }

  if (w.status !== 'new') touchRecentWords(progress, en);
  bumpDaily(progress, isCorrect, wasNew && w.status !== 'new');
  updateStreakOnLearn(progress);
  persist();
  checkMilestones(en);
}

// Memory match: exposure only, no correctness accounting.
function recordSeen(en) {
  const progress = getProgress();
  const w = ensureWord(progress, en);
  w.lastSeen = Date.now();
  bumpDaily(progress, true, false);
  updateStreakOnLearn(progress);
  persist();
}

function starBalance() {
  const p = getProgress();
  return p.stars - p.starsSpent;
}
function addStars(count) {
  if (count <= 0) return;
  const progress = getProgress();
  progress.stars += count;
  persist();
  showToast(`+${count} ⭐ 已存进你的星星罐！`);
}

// ===== Speech =====
let preferredVoice = null;
let speechSessionId = 0;
let currentAudio = null;   // in-flight pre-recorded pronunciation clip
let audioPrimed = false;   // mobile browsers block audio until the first user gesture

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return;
  const preferredNames = ['Samantha', 'Karen', 'Google US English', 'Microsoft Zira', 'Victoria', 'Fiona', 'Susan', 'Tessa'];
  let best = null;
  for (const name of preferredNames) {
    const found = voices.find(v => v.lang.startsWith('en') && v.name.includes(name));
    if (found) { best = found; break; }
  }
  if (!best) {
    best = voices.find(v => v.lang === 'en-US') || voices.find(v => v.lang.startsWith('en'));
  }
  preferredVoice = best;
}

if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

// Primary path: play the pre-recorded high-quality clip (audio/<word>.m4a).
// Falls back to the device TTS engine if the clip is missing or can't play.
function speakWord(word, single, onDone) {
  const done = () => { try { if (onDone) onDone(); } catch { /* ignore */ } };
  if (!word) { done(); return; }
  stopPronunciation(); // never let two cards talk over each other
  const slug = word.toLowerCase().replace(/[^a-z]/g, '');
  const src = `audio/${slug}.m4a`;
  let fellBack = false;
  const fallback = () => { if (fellBack) return; fellBack = true; ttsSpeak(word, single, onDone); };

  const a = new Audio(src);
  currentAudio = a;
  try { a.preservesPitch = true; a.webkitPreservesPitch = true; } catch { /* ignore */ }
  a.addEventListener('error', fallback, { once: true });
  a.addEventListener('ended', () => {
    if (single) { done(); return; }
    // gentle slow repeat — same clip, pitch preserved so it doesn't sound chipmunk-y
    const b = new Audio(src);
    currentAudio = b;
    try { b.preservesPitch = true; b.webkitPreservesPitch = true; } catch { /* ignore */ }
    b.playbackRate = 0.75;
    b.addEventListener('ended', done, { once: true });
    b.addEventListener('error', done, { once: true });
    b.play().catch(done);
  }, { once: true });
  a.play().catch(fallback);
}

// Device speech-synthesis fallback (also used when no clip exists).
function ttsSpeak(word, single, onDone) {
  const done = () => { try { if (onDone) onDone(); } catch { /* ignore */ } };
  try {
    if (!('speechSynthesis' in window)) { done(); return; }
    window.speechSynthesis.cancel();
    if (!preferredVoice) loadVoices(); // voices can load late on first play
    const sessionId = ++speechSessionId;
    const ended = () => { if (speechSessionId === sessionId) done(); };

    const u1 = new SpeechSynthesisUtterance(word);
    u1.lang = 'en-US';
    u1.rate = 0.8;
    if (preferredVoice) u1.voice = preferredVoice;

    if (!single) {
      const u2 = new SpeechSynthesisUtterance(word);
      u2.lang = 'en-US';
      u2.rate = 0.7;
      if (preferredVoice) u2.voice = preferredVoice;
      u2.onend = ended;
      u2.onerror = ended;
      u1.onend = () => {
        if (speechSessionId === sessionId) {
          setTimeout(() => {
            if (speechSessionId === sessionId) window.speechSynthesis.speak(u2);
            else done();
          }, 500);
        }
      };
      u1.onerror = ended;
    } else {
      u1.onend = ended;
      u1.onerror = ended;
    }
    window.speechSynthesis.speak(u1);
  } catch { done(); }
}

function stopPronunciation() {
  speechSessionId++;
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* ignore */ }
  if (currentAudio) { try { currentAudio.pause(); } catch { /* ignore */ } currentAudio = null; }
}
function stopSpeech() {
  stopPronunciation();
  const sp = document.getElementById('fc-speak');
  if (sp) sp.classList.remove('playing');
}

// Unlock audio + speech on the first user gesture (iOS/Safari block both until then,
// which would otherwise silently swallow the auto-play-once on the first card).
function primeAudio() {
  if (audioPrimed) return;
  audioPrimed = true;
  try { getAudioCtx().resume(); } catch { /* ignore */ }
  loadVoices();
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch { /* ignore */ }
  try {
    const probe = new Audio('audio/go.m4a');
    probe.volume = 0;
    probe.play().then(() => { probe.pause(); probe.currentTime = 0; }).catch(() => {});
  } catch { /* ignore */ }
}
['pointerdown', 'touchend', 'keydown'].forEach((evt) =>
  window.addEventListener(evt, primeAudio, { once: true, passive: true }));

// ===== Sound Effects =====
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playSound(type) {
  try {
    const ctx = getAudioCtx();
    if (ctx.state !== 'running') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'correct') {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } else if (type === 'wrong') {
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.setValueAtTime(150, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'flip') {
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === 'match') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.setValueAtTime(800, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } else if (type === 'gentle') {
      // soft, neutral end-of-round chime (never punishing)
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(554, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } else if (type === 'victory') {
      const notes = [523, 587, 659, 784, 880, 1047];
      notes.forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
        g.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.12 + 0.2);
        o.start(ctx.currentTime + i * 0.12);
        o.stop(ctx.currentTime + i * 0.12 + 0.2);
      });
    }
  } catch { /* ignore */ }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
});

// Mechanical keystroke click: a tiny filtered white-noise burst — a tone sounds
// synthetic, but band-passed noise reads as a real key "snap". Buffer is reused.
let keyNoiseBuf = null;
function getKeyNoise(ctx) {
  if (keyNoiseBuf) return keyNoiseBuf;
  const len = Math.floor(ctx.sampleRate * 0.03);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const decay = Math.pow(1 - i / len, 2); // sharp percussive tail
    data[i] = (Math.random() * 2 - 1) * decay;
  }
  keyNoiseBuf = buf;
  return buf;
}
function playKeyClick(isPress) {
  try {
    const ctx = getAudioCtx();
    if (ctx.state !== 'running') ctx.resume();
    const t = ctx.currentTime;

    // Layer 1 — the high "click" (noise burst through a high-pass)
    const src = ctx.createBufferSource();
    src.buffer = getKeyNoise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = isPress ? 1200 : 900;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(isPress ? 0.5 : 0.32, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(hp); hp.connect(clickGain); clickGain.connect(ctx.destination);
    src.start(t); src.stop(t + 0.04);

    // Layer 2 — the low "thock" body (short sine), slightly pitch-varied per key
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = (isPress ? 175 : 130) + (Math.random() * 24 - 12);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.05);
    const body = ctx.createGain();
    body.gain.setValueAtTime(isPress ? 0.32 : 0.22, t);
    body.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(body); body.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.07);
  } catch { /* ignore */ }
}
function vibrate(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}

// ===== Toast =====
let toastTimer = null;
function showToast(msg) {
  let el = document.querySelector('.toast');
  if (el) el.remove();
  el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2200);
}

// ===== Dialog helpers (no native alert/confirm) =====
function showDialog(html, onMount) {
  const overlay = document.createElement('div');
  overlay.className = 'word-popup-overlay';
  overlay.innerHTML = `<div class="word-popup">${html}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  if (onMount) onMount(overlay);
  refreshIcons();
  return overlay;
}

function confirmDialog(message, okText, cancelText) {
  return new Promise((resolve) => {
    const overlay = showDialog(`
      <div class="wp-emoji">🤔</div>
      <div class="result-title" style="font-size:1.2rem;">${message}</div>
      <div class="dialog-actions">
        <button class="cancel-btn" data-act="cancel">${cancelText || '先不要'}</button>
        <button class="danger-btn" data-act="ok">${okText || '确定'}</button>
      </div>
    `, (ov) => {
      ov.querySelector('[data-act="ok"]').addEventListener('click', () => { ov.remove(); resolve(true); });
      ov.querySelector('[data-act="cancel"]').addEventListener('click', () => { ov.remove(); resolve(false); });
      ov.addEventListener('click', (e) => { if (e.target === ov) resolve(false); });
    });
    void overlay;
  });
}

// ===== Confetti (all math in CSS pixels) =====
const confettiCanvas = document.getElementById('confetti-canvas');
const confettiCtx = confettiCanvas.getContext('2d');
let confettiPieces = [];
let confettiAnimating = false;

function resizeConfetti() {
  const dpr = window.devicePixelRatio || 1;
  confettiCanvas.width = window.innerWidth * dpr;
  confettiCanvas.height = window.innerHeight * dpr;
  confettiCanvas.style.width = window.innerWidth + 'px';
  confettiCanvas.style.height = window.innerHeight + 'px';
  confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeConfetti);
resizeConfetti();

function launchConfetti() {
  confettiPieces = [];
  const colors = ['#6C63FF', '#FF6584', '#43E97B', '#FFB347', '#A78BFA', '#F093FB', '#38F9D7'];
  for (let i = 0; i < 70; i++) {
    confettiPieces.push({
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * 100,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4,
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10
    });
  }
  if (!confettiAnimating) {
    confettiAnimating = true;
    animateConfetti();
  }
}

function animateConfetti() {
  confettiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  confettiPieces = confettiPieces.filter(p => p.y < window.innerHeight + 20);
  confettiPieces.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.rotation += p.rotSpeed;
    p.vy += 0.1;
    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.rotation * Math.PI / 180);
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    confettiCtx.restore();
  });
  if (confettiPieces.length > 0) {
    requestAnimationFrame(animateConfetti);
  } else {
    confettiAnimating = false;
    confettiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

// ===== Stars rendering =====
function renderStars(count, total) {
  let html = '';
  for (let i = 0; i < total; i++) {
    if (i < count) {
      html += `<svg width="32" height="32" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#FBBF24" stroke="#FBBF24" stroke-width="2"/></svg>`;
    } else {
      html += `<svg width="32" height="32" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="none" stroke="#D1D5DB" stroke-width="2"/></svg>`;
    }
  }
  return html;
}
function resultIconClass(pct) {
  return pct >= 90 ? 'icon-success' : pct >= 70 ? 'icon-good' : 'icon-encourage';
}
function resultIconName(pct) {
  return pct >= 90 ? 'trophy' : pct >= 70 ? 'thumbs-up' : 'sprout';
}
function mascotReaction(pct) {
  return pct >= 90 ? '🦊🎉' : pct >= 70 ? '🦊👍' : '🦊💪';
}

// ===== Levels (85 levels x 10 words, mixed categories) =====
// Each level blends all five categories proportionally (~5 general, 2-3
// picturable, 1 operation, 1 quality) via a deterministic least-progress
// round-robin, so kids always get concrete words alongside abstract ones.
const LEVEL_SIZE = 10;
let orderedWordsCache = null;
function orderedWords() {
  if (!orderedWordsCache) orderedWordsCache = getAllWords();
  return orderedWordsCache;
}
let levelSeqCache = null;
function levelSequence() {
  if (levelSeqCache) return levelSeqCache;
  const cats = WORD_DATA.categories.map(c => ({ words: getWordsByCategory(c.id), i: 0 }));
  const out = [];
  const total = cats.reduce((s, c) => s + c.words.length, 0);
  for (let n = 0; n < total; n++) {
    let best = null;
    for (const c of cats) {
      if (c.i >= c.words.length) continue;
      if (!best || c.i / c.words.length < best.i / best.words.length - 1e-9) best = c;
    }
    out.push(best.words[best.i++]);
  }
  levelSeqCache = out;
  return out;
}
function levelCount() { return Math.ceil(levelSequence().length / LEVEL_SIZE); }
function levelWords(idx) {
  return levelSequence().slice(idx * LEVEL_SIZE, (idx + 1) * LEVEL_SIZE);
}
function levelStars(idx) {
  const p = getProgress();
  return p.levels[idx] || 0;
}
function levelUnlocked(idx) {
  return idx === 0 || levelStars(idx - 1) >= 1;
}
function currentLevelIdx() {
  for (let i = 0; i < levelCount(); i++) {
    if (levelStars(i) < 1) return i;
  }
  return levelCount() - 1;
}
function passedLevels() {
  let n = 0;
  for (let i = 0; i < levelCount(); i++) if (levelStars(i) >= 1) n++;
  return n;
}

// "奇奇的环游冒险" level map: one continuous road through 9 themed
// landscape zones. The travelled stretch is painted gold, scenery
// stickers line the way, the fox stands on the current level.
const CHAPTER_SIZE = 10;
const STEP_Y = 78;        // vertical distance between nodes (px)
const TOP_PAD = 64;
const WAVE_X = [50, 73, 82, 73, 50, 27, 18, 27]; // x positions in %, period 8

// deep = node fill (white bold text >= 3:1), soft = zone wash
const ZONES = [
  { name: '青青草原', deep: '#16A34A', soft: '#E8F9EE', deco: ['🌼', '🐰', '🌳'] },
  { name: '蘑菇森林', deep: '#047857', soft: '#E2F5EC', deco: ['🍄', '🌲', '🦉'] },
  { name: '花海溪谷', deep: '#DB2777', soft: '#FDEDF4', deco: ['🌸', '🦋', '🌷'] },
  { name: '金色沙滩', deep: '#D97706', soft: '#FDF3DF', deco: ['🐚', '🦀', '⛱️'] },
  { name: '蓝色海洋', deep: '#0284C7', soft: '#E6F4FC', deco: ['🐬', '🐠', '🌊'] },
  { name: '彩虹山丘', deep: '#7C3AED', soft: '#F1EBFD', deco: ['🌈', '🪁', '⛰️'] },
  { name: '冰雪雪山', deep: '#0369A1', soft: '#E8F3FA', deco: ['⛄', '❄️', '🏔️'] },
  { name: '星空夜原', deep: '#4F46E5', soft: '#ECEBFC', deco: ['🌙', '⭐', '✨'] },
  { name: '云端城堡', deep: '#BE185D', soft: '#FDEDF2', deco: ['☁️', '🎈', '👑'] }
];
function zoneOf(level) { return ZONES[Math.floor(level / CHAPTER_SIZE) % ZONES.length]; }

function nodeXY(i) {
  return { x: WAVE_X[i % WAVE_X.length], y: TOP_PAD + i * STEP_Y };
}

function trailPathD(from, to) {
  let d = '';
  for (let i = from; i <= to; i++) {
    const { x, y } = nodeXY(i);
    if (i === from) {
      d = `M ${x} ${y}`;
    } else {
      const p = nodeXY(i - 1);
      const midY = (p.y + y) / 2;
      d += ` C ${p.x} ${midY}, ${x} ${midY}, ${x} ${y}`;
    }
  }
  return d;
}

function renderLevelMap() {
  const map = document.getElementById('level-map');
  if (!map) return;
  map.innerHTML = '';
  const cur = currentLevelIdx();
  const total = levelCount();
  const height = TOP_PAD + (total - 1) * STEP_Y + 96;
  const travelled = passedLevels() > 0 ? Math.min(cur, total - 1) : 0;

  const inner = document.createElement('div');
  inner.className = 'level-trail';
  inner.style.height = height + 'px';

  // landscape washes, one per zone, behind everything
  let bandsHtml = '';
  for (let ch = 0; ch * CHAPTER_SIZE < total; ch++) {
    const zone = ZONES[ch % ZONES.length];
    const from = ch * CHAPTER_SIZE;
    const count = Math.min(CHAPTER_SIZE, total - from);
    const top = nodeXY(from).y - 46;
    const bandH = count * STEP_Y + (ch * CHAPTER_SIZE + count >= total ? 80 : 0);
    bandsHtml += `<div class="zone-band" style="top:${top}px;height:${bandH - 8}px;background:${zone.soft}"></div>`;
  }

  // the road: pale base, gold travelled stretch, dotted centerlines
  const dAll = trailPathD(0, total - 1);
  const dDone = travelled > 0 ? trailPathD(0, travelled) : '';
  inner.innerHTML = `
    <div class="zone-bands">${bandsHtml}</div>
    <svg class="trail-svg" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${dAll}" fill="none" stroke="#FFFFFF" stroke-width="18" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <path d="${dAll}" fill="none" stroke="#E4DEF8" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 13" vector-effect="non-scaling-stroke"/>
      ${dDone ? `<path d="${dDone}" fill="none" stroke="#F59E0B" stroke-width="18" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <path d="${dDone}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 13" vector-effect="non-scaling-stroke"/>` : ''}
    </svg>`;

  // scenery stickers: deterministic spots on the side opposite the road
  for (let ch = 0; ch * CHAPTER_SIZE < total; ch++) {
    const zone = ZONES[ch % ZONES.length];
    zone.deco.forEach((emoji, k) => {
      const idx = ch * CHAPTER_SIZE + 1 + k * 3;
      if (idx >= total) return;
      const { x, y } = nodeXY(idx);
      const deco = document.createElement('span');
      deco.className = 'trail-deco';
      deco.textContent = emoji;
      deco.style.left = Math.max(8, Math.min(92, 100 - x + (k % 2 ? 6 : -6))) + '%';
      deco.style.top = (y + 26) + 'px';
      inner.appendChild(deco);
    });
  }

  let currentNodeEl = null;
  for (let i = 0; i < total; i++) {
    const { x, y } = nodeXY(i);
    const ch = Math.floor(i / CHAPTER_SIZE);
    const zone = ZONES[ch % ZONES.length];

    // zone badge floats on the side opposite the road
    if (i % CHAPTER_SIZE === 0) {
      const chip = document.createElement('div');
      chip.className = 'chapter-chip';
      chip.style.top = (y - 18) + 'px';
      if (x >= 50) { chip.style.left = '5%'; } else { chip.style.right = '5%'; }
      chip.innerHTML = `<span class="chapter-pill" style="background:${zone.deep}">第${ch + 1}章 · ${zone.name}</span>`;
      inner.appendChild(chip);
    }

    const stars = levelStars(i);
    const unlocked = levelUnlocked(i);
    const isCurrent = i === cur && unlocked && stars < 1;
    const isBoss = i % CHAPTER_SIZE === CHAPTER_SIZE - 1 || i === total - 1; // chapter finale
    const node = document.createElement('button');
    node.className = 'level-node ' + (isCurrent ? 'current' : stars >= 1 ? 'done' : unlocked ? 'unlocked' : 'locked');
    node.style.left = x + '%';
    node.style.top = y + 'px';
    if (stars >= 1 || unlocked) node.style.background = zone.deep;
    if (isCurrent) {
      node.style.boxShadow = `0 0 0 4px #FFFFFF, 0 6px 18px ${zone.deep}66`;
      node.innerHTML = `<span class="node-fox">🦊</span><span class="node-num">${i + 1}</span>`;
      node.setAttribute('aria-label', `第${i + 1}关，当前位置，点击开始`);
      currentNodeEl = node;
    } else if (stars >= 1) {
      node.innerHTML = `<span class="node-num">${i + 1}</span><span class="node-stars">${'★'.repeat(stars)}</span>`;
      node.setAttribute('aria-label', `第${i + 1}关，已通过 ${stars} 星`);
    } else {
      node.innerHTML = `<span class="node-num">${i + 1}</span>`;
      node.setAttribute('aria-label', `第${i + 1}关${unlocked ? '' : '，未解锁'}`);
    }
    if (isBoss) {
      const badge = document.createElement('span');
      badge.className = 'node-boss';
      badge.textContent = stars >= 1 ? '👑' : '🎁';
      node.appendChild(badge);
    }
    if (unlocked) node.addEventListener('click', () => startLevel(i));
    inner.appendChild(node);
  }

  // journey ends at the cloud castle
  const last = nodeXY(total - 1);
  const goal = document.createElement('div');
  goal.className = 'trail-goal';
  goal.style.left = last.x + '%';
  goal.style.top = (last.y + 58) + 'px';
  goal.innerHTML = '🏰';
  inner.appendChild(goal);

  map.appendChild(inner);

  const sub = document.getElementById('levelmap-sub');
  if (sub) sub.textContent = `已通过 ${passedLevels()}/${levelCount()} 关`;

  // keep the kid's current position in view
  if (currentNodeEl) {
    requestAnimationFrame(() => {
      map.scrollTop = Math.max(0, currentNodeEl.offsetTop - map.clientHeight / 2 + 30);
    });
  }
}

// ===== Mascot =====
function mascotMessage() {
  const p = getProgress();
  const today = p.dailyLog[isoDate()] || { answered: 0 };
  const hour = new Date().getHours();
  if (today.answered >= 10) return '今日目标完成啦，你真厉害！🎉';
  if (today.answered > 0) return `已经答对 ${today.answered} 题啦，继续加油！`;
  if (p.streak >= 3) return `连续学了 ${p.streak} 天，别让小火苗熄灭哦！`;
  if (hour < 12) return '早上好呀！来认几个新单词吧！';
  if (hour < 18) return '下午好！一起玩单词游戏吧！';
  return '晚上好！睡前学 10 个词，梦里都记得！';
}
function mascotEmojiWithAccessories() {
  const p = getProgress();
  let s = '🦊';
  if (p.owned.includes('acc-hat')) s += '🎩';
  if (p.owned.includes('acc-glasses')) s += '🕶️';
  return s;
}

// ===== Navigation (with browser history) =====
let currentPage = 'home';
let quizTimer = null;
let spellingTimer = null;

function clearPendingTimers() {
  clearTimeout(quizTimer); quizTimer = null;
  clearTimeout(spellingTimer); spellingTimer = null;
}

function navigateTo(page, fromPop) {
  clearPendingTimers();
  stopSpeech();
  const cont = document.getElementById('quiz-continue');
  if (cont) cont.style.display = 'none';

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  currentPage = page;

  if (!fromPop) {
    try {
      if (page === 'home') {
        history.replaceState({ page: 'home' }, '', location.pathname);
      } else {
        history.pushState({ page }, '', location.pathname);
      }
    } catch {}
  }

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  let navPage = page;
  if (page === 'category' || page === 'spelling' || page === 'shop') navPage = 'home';
  const navItem = document.querySelector(`.nav-item[data-page="${navPage}"]`);
  if (navItem) navItem.classList.add('active');

  if (page === 'home') refreshHome();
  if (page === 'progress') refreshProgressPage();
  if (page === 'shop') renderShop();

  window.scrollTo(0, 0);
}

window.addEventListener('popstate', (e) => {
  const page = (e.state && e.state.page) || 'home';
  navigateTo(page, true);
});

function goBack() {
  if (currentPage === 'home') return;
  try { history.back(); } catch { navigateTo('home'); }
}

// ===== Home =====
function refreshHome() {
  const progress = getProgress();
  const all = orderedWords();
  const learned = all.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new').length;
  const mastered = all.filter(w => progress.words[w.en] && progress.words[w.en].status === 'mastered').length;

  const cur = currentLevelIdx();
  document.getElementById('progress-text').textContent = `第 ${cur + 1} 关 / ${levelCount()} 关`;
  document.getElementById('progress-fill').style.width = `${(passedLevels() / levelCount()) * 100}%`;
  document.getElementById('stat-stars').textContent = starBalance();
  document.getElementById('star-balance').textContent = starBalance();
  document.getElementById('stat-learned').textContent = learned;
  document.getElementById('stat-mastered').textContent = mastered;
  document.getElementById('streak-count').textContent = progress.streak;

  // streak flame lit only when today has learning activity
  const todayLog = progress.dailyLog[isoDate()] || { answered: 0 };
  document.getElementById('streak-badge').classList.toggle('unlit', todayLog.answered === 0);

  // daily goal
  const goal = Math.min(10, todayLog.answered);
  document.getElementById('daily-goal-fill').style.width = `${goal * 10}%`;
  document.getElementById('daily-goal-text').textContent = todayLog.answered >= 10 ? '今日目标完成！🔥' : `今日目标 ${todayLog.answered}/10`;

  // mascot
  document.getElementById('mascot-emoji').textContent = mascotEmojiWithAccessories();
  document.getElementById('mascot-msg').textContent = mascotMessage();

  renderLevelMap();

  // Category list
  const listEl = document.getElementById('category-list');
  listEl.innerHTML = '';
  WORD_DATA.categories.forEach(cat => {
    const catWords = getWordsByCategory(cat.id);
    const catLearned = catWords.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new').length;
    const pct = Math.round((catLearned / catWords.length) * 100);
    const circumference = 2 * Math.PI * 18;
    const dashoffset = circumference - (pct / 100) * circumference;

    const card = document.createElement('div');
    card.className = 'category-card';
    card.innerHTML = `
      <div class="cat-icon-block" style="background:${cat.color};">
        ${icon(cat.icon, 28)}
        ${pct === 100 ? '<span class="cat-crown">👑</span>' : ''}
      </div>
      <div class="cat-info">
        <div class="cat-name">${cat.nameZh} <span class="cat-name-en">· ${cat.name}</span></div>
        <div class="cat-desc">${cat.description} · <strong>${catWords.length}</strong> 词</div>
      </div>
      <div class="cat-progress-mini">
        <svg width="48" height="48" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="18" fill="none" stroke="#EDE9FE" stroke-width="3"/>
          <circle cx="24" cy="24" r="18" fill="none" stroke="${cat.color}" stroke-width="3"
            stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}" stroke-linecap="round"/>
        </svg>
        <span class="progress-text">${pct}%</span>
      </div>
    `;
    card.addEventListener('click', () => openCategory(cat.id));
    listEl.appendChild(card);
  });
  refreshIcons();
}

document.getElementById('cta-learn').addEventListener('click', () => startLevel(currentLevelIdx()));
document.getElementById('star-chip').addEventListener('click', () => navigateTo('shop'));

// ===== Category Page =====
function isCategoryLearned(categoryId) {
  const progress = getProgress();
  return getWordsByCategory(categoryId).every(w => progress.words[w.en] && progress.words[w.en].status !== 'new');
}

function openCategory(categoryId) {
  const cat = WORD_DATA.categories.find(c => c.id === categoryId);
  if (!cat) return;

  document.getElementById('category-title').textContent = cat.nameZh + (isCategoryLearned(cat.id) ? ' 👑' : '');
  navigateTo('category');

  const progress = getProgress();
  const catWords = getWordsByCategory(cat.id);
  const catLearned = catWords.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new').length;
  document.getElementById('category-progress').textContent = `${catLearned}/${catWords.length}`;

  const grid = document.getElementById('word-grid');
  grid.innerHTML = '';
  catWords.forEach(w => {
    const status = progress.words[w.en] ? progress.words[w.en].status : 'new';
    const cell = document.createElement('div');
    cell.className = `word-cell ${status}`;
    cell.innerHTML = `<div class="word-en">${w.en}</div><div class="word-zh">${w.zh}</div>`;
    cell.addEventListener('click', () => showWordPopup(w));
    grid.appendChild(cell);
  });
  refreshIcons();
}

function showWordPopup(word) {
  const progress = getProgress();
  const status = progress.words[word.en] ? progress.words[word.en].status : 'new';
  const statusIcon = status === 'mastered' ? 'star' : status === 'learning' ? 'book-open' : 'plus-circle';
  const statusText = status === 'mastered' ? '我学会啦' : status === 'learning' ? '正在学' : '还没学';
  const emoji = wordEmoji(word.en);

  showDialog(`
    ${emoji ? `<div class="wp-emoji">${emoji}</div>` : ''}
    <div class="wp-en">${word.en} <button class="wp-speak" title="朗读">${icon('volume-2', 20)}</button></div>
    <div class="wp-zh">${word.zh}</div>
    <div class="wp-status">${icon(statusIcon, 16)} ${word.categoryName} · ${statusText}</div>
    <br><button class="wp-close">关闭</button>
  `, (overlay) => {
    overlay.querySelector('.wp-speak').addEventListener('click', (e) => {
      e.stopPropagation();
      speakWord(word.en);
    });
    overlay.querySelector('.wp-close').addEventListener('click', () => overlay.remove());
  });
  speakWord(word.en);
}

// ===== Word pools & weighted sampling =====
function isWeakWord(progress, w) {
  const rec = progress.words[w.en];
  if (!rec) return false;
  if (rec.wrong > rec.correct) return true;
  return rec.recent && rec.recent.length > 0 && rec.recent[rec.recent.length - 1] === false;
}

function poolForMode(category) {
  const progress = getProgress();
  const all = orderedWords();
  if (category === 'all') return all;
  if (category === 'new') return all.filter(w => !progress.words[w.en] || progress.words[w.en].status === 'new');
  if (category === 'learned') return all.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new');
  if (category === 'wrong') return all.filter(w => isWeakWord(progress, w));
  return getWordsByCategory(category);
}

// SRS-flavoured weighted pick: wrong words and long-unseen words come back more often.
function weightedSample(words, count) {
  const progress = getProgress();
  const pool = words.map(w => {
    const rec = progress.words[w.en];
    let weight;
    if (!rec || rec.status === 'new') {
      weight = 4; // fresh words get a healthy chance
    } else {
      weight = 1 + Math.min(rec.wrong * 3, 9) + daysSince(rec.lastSeen);
    }
    return { w, weight };
  });
  const result = [];
  while (result.length < count && pool.length > 0) {
    let total = 0;
    for (const item of pool) total += item.weight;
    let r = Math.random() * total;
    let pick = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) { pick = i; break; }
    }
    result.push(pool[pick].w);
    pool.splice(pick, 1);
  }
  return result;
}

function getWordsForMode(category, count) {
  const pool = poolForMode(category);
  return weightedSample(pool, Math.min(count, pool.length));
}

// Empty-pool helper: guides the kid instead of silently falling back.
function handleEmptyPool(category) {
  if (category === 'new') {
    showDialog(`
      <div class="wp-emoji">🎓</div>
      <div class="result-title" style="font-size:1.2rem;">哇！850 个单词你都见过啦！</div>
      <div class="result-detail">没有没学过的词了，挑别的玩法练一练吧</div>
      <div class="dialog-actions"><button class="primary-btn" data-act="ok">好嘞</button></div>
    `, (ov) => ov.querySelector('[data-act="ok"]').addEventListener('click', () => { ov.remove(); navigateTo('home'); }));
    return;
  }
  if (category === 'wrong') {
    showDialog(`
      <div class="wp-emoji">💪</div>
      <div class="result-title" style="font-size:1.2rem;">没有要加强的词，太棒了！</div>
      <div class="result-detail">每个词都答得很好，去闯新关卡吧</div>
      <div class="dialog-actions"><button class="primary-btn" data-act="ok">去闯关</button></div>
    `, (ov) => ov.querySelector('[data-act="ok"]').addEventListener('click', () => { ov.remove(); navigateTo('home'); }));
    return;
  }
  // 'learned' (or anything else empty): guide to flashcards first
  showDialog(`
    <div class="wp-emoji">🦊</div>
    <div class="result-title" style="font-size:1.2rem;">先去认识几个单词吧！</div>
    <div class="result-detail">学过的词才能用来考试哦，奇奇陪你去翻卡片</div>
    <div class="dialog-actions">
      <button class="cancel-btn" data-act="home">回首页</button>
      <button class="primary-btn" data-act="fc">去翻卡片</button>
    </div>
  `, (ov) => {
    ov.querySelector('[data-act="home"]').addEventListener('click', () => { ov.remove(); navigateTo('home'); });
    ov.querySelector('[data-act="fc"]').addEventListener('click', () => {
      ov.remove();
      navigateTo('flashcard');
      initFlashcard();
    });
  });
}

// Mid-session settings change guard
async function confirmRestart(sessionActive) {
  if (!sessionActive) return true;
  return confirmDialog('换设置会重新开始这一轮哦', '换吧', '先不换');
}

// ===== Flashcard Mode =====
let fcWords = [];
let fcIndex = 0;
let fcFlipped = false;
let fcLocked = false;
let fcKnown = 0;
let fcLevel = null;          // level index when in level mode
let fcCustomWords = null;    // fixed word list (weak-word practice)
let fcRequeued = new Set();
let fcSessionDone = true;

function setFlashcardChrome() {
  const title = document.getElementById('flashcard-title');
  const settings = document.getElementById('flashcard-settings');
  if (fcLevel !== null) {
    title.textContent = `第 ${fcLevel + 1} 关 · 学一学`;
    settings.style.display = 'none';
  } else {
    title.textContent = '翻卡片';
    settings.style.display = '';
  }
}

function initFlashcard(opts) {
  opts = opts || {};
  fcLevel = (typeof opts.level === 'number') ? opts.level : null;
  fcCustomWords = opts.words || null;

  if (fcLevel !== null) {
    fcWords = shuffle(levelWords(fcLevel));
  } else if (fcCustomWords) {
    fcWords = shuffle(fcCustomWords).slice(0, 50);
  } else {
    const category = document.getElementById('fc-category').value;
    const count = parseInt(document.getElementById('fc-count').value);
    fcWords = getWordsForMode(category, count);
    if (fcWords.length === 0) {
      handleEmptyPool(category);
      fcSessionDone = true;
      fcWords = [];
      return;
    }
  }
  fcIndex = 0;
  fcFlipped = false;
  fcLocked = false;
  fcKnown = 0;
  fcRequeued = new Set();
  fcSessionDone = false;
  setFlashcardChrome();
  showFlashcard(true);
}

function fcSetButtons(enabled) {
  document.getElementById('fc-no').disabled = !enabled;
  document.getElementById('fc-yes').disabled = !enabled;
}

function showFlashcard(immediate) {
  if (fcIndex >= fcWords.length) {
    finishFlashcardRound();
    return;
  }

  const word = fcWords[fcIndex];
  const apply = () => {
    document.getElementById('flashcard-en').textContent = word.en;
    document.getElementById('flashcard-en').classList.toggle('fc-long', word.en.length > 9);
    document.getElementById('flashcard-zh').textContent = word.zh;
    document.getElementById('flashcard-zh').classList.toggle('fc-long', word.zh.length > 6);
    document.getElementById('flashcard-cat').textContent = word.categoryName;
    document.getElementById('flashcard-emoji').textContent = wordEmoji(word.en);
    document.getElementById('flashcard-counter').textContent = `${fcIndex + 1}/${fcWords.length}`;
    fcLocked = false;
    fcSpeak(); // 默认自动播放一次
  };

  fcFlipped = false;
  fcSetButtons(true); // 不强制翻卡：认识就能直接评价，翻卡只是为了核对答案
  const card = document.getElementById('flashcard');
  if (card.classList.contains('flipped')) {
    // flip back first, then swap the text so the next answer isn't spoiled
    card.classList.remove('flipped');
    setTimeout(() => { if (!fcSessionDone) apply(); }, 320);
  } else if (immediate) {
    apply();
  } else {
    setTimeout(apply, 60);
  }
}

function finishFlashcardRound() {
  fcSessionDone = true;
  fcLocked = false;
  fcSetButtons(false);
  document.getElementById('flashcard').classList.remove('flipped');
  playSound('victory');
  launchConfetti();

  if (fcLevel !== null) {
    const lvl = fcLevel;
    showDialog(`
      <div class="wp-emoji">🦊✨</div>
      <div class="result-title">第 ${lvl + 1} 关学完啦！</div>
      <div class="result-detail">下面来闯关测验，答对 7 题就能点亮星星！</div>
      <div class="dialog-actions">
        <button class="cancel-btn" data-act="again">再看一遍</button>
        <button class="primary-btn" data-act="quiz">去闯关！</button>
      </div>
    `, (ov) => {
      ov.querySelector('[data-act="again"]').addEventListener('click', () => { ov.remove(); initFlashcard({ level: lvl }); });
      ov.querySelector('[data-act="quiz"]').addEventListener('click', () => {
        ov.remove();
        navigateTo('quiz');
        initQuiz({ level: lvl });
      });
    });
    return;
  }

  const total = fcWords.length || 1;
  const stars = Math.max(1, Math.min(3, Math.round((fcKnown / total) * 3)));
  addStars(stars);
  showDialog(`
    <div class="wp-emoji">${mascotReaction((fcKnown / total) * 100)}</div>
    <div class="result-title">卡片翻完啦！</div>
    <div class="result-detail">认识 ${fcKnown}/${total} 个词</div>
    <div class="result-stars">${renderStars(stars, 3)}</div>
    <div class="dialog-actions">
      <button class="cancel-btn" data-act="home">回首页</button>
      <button class="primary-btn" data-act="again">再来一组</button>
    </div>
  `, (ov) => {
    ov.querySelector('[data-act="home"]').addEventListener('click', () => { ov.remove(); navigateTo('home'); });
    ov.querySelector('[data-act="again"]').addEventListener('click', () => { ov.remove(); initFlashcard(fcCustomWords ? { words: fcCustomWords } : {}); });
  });
}

document.getElementById('flashcard-container').addEventListener('click', () => {
  if (fcLocked || fcSessionDone || fcIndex >= fcWords.length) return;
  fcFlipped = !fcFlipped;
  document.getElementById('flashcard').classList.toggle('flipped');
  playSound('flip');
});

// 朗读：默认自动播放一次，点喇叭随时重听（不触发翻卡），播放时图标有动效反馈
function fcSpeak() {
  if (fcSessionDone || fcIndex >= fcWords.length) return;
  const btn = document.getElementById('fc-speak');
  if (btn) btn.classList.add('playing');
  speakWord(fcWords[fcIndex].en, false, () => { if (btn) btn.classList.remove('playing'); });
}
document.getElementById('fc-speak').addEventListener('click', (e) => {
  e.stopPropagation();
  fcSpeak();
});

function answerFlashcard(known) {
  if (fcLocked || fcSessionDone || fcIndex >= fcWords.length) return;
  fcLocked = true;
  const word = fcWords[fcIndex];
  recordResult(word.en, known, 'flashcard');
  if (known) {
    fcKnown++;
    playSound('correct');
    vibrate(40);
  } else {
    playSound('flip');
    // unknown word comes back at the end of this round (once)
    if (!fcRequeued.has(word.en)) {
      fcRequeued.add(word.en);
      fcWords.push(word);
    }
  }
  fcIndex++;
  showFlashcard();
}

document.getElementById('fc-no').addEventListener('click', () => answerFlashcard(false));
document.getElementById('fc-yes').addEventListener('click', () => answerFlashcard(true));

document.getElementById('fc-category').addEventListener('change', async (e) => {
  const ok = await confirmRestart(!fcSessionDone && fcIndex > 0);
  if (ok) initFlashcard();
  else e.target.value = e.target.dataset.prev || 'all';
});
document.getElementById('fc-count').addEventListener('change', async (e) => {
  const ok = await confirmRestart(!fcSessionDone && fcIndex > 0);
  if (ok) initFlashcard();
  else e.target.value = e.target.dataset.prev || '10';
});
['fc-category', 'fc-count'].forEach(id => {
  const el = document.getElementById(id);
  el.dataset.prev = el.value;
  el.addEventListener('focus', () => { el.dataset.prev = el.value; });
});

// ===== Quiz Mode =====
let quizWords = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;
let quizLevel = null;
let quizCustomWords = null;
let quizWrongWords = [];
let quizSessionDone = true;

function setQuizChrome() {
  const title = document.getElementById('quiz-title');
  const settings = document.getElementById('quiz-settings');
  if (quizLevel !== null) {
    title.textContent = `第 ${quizLevel + 1} 关 · 闯关测验`;
    settings.style.display = 'none';
  } else {
    title.textContent = '选择题';
    settings.style.display = '';
  }
}

function initQuiz(opts) {
  opts = opts || {};
  quizLevel = (typeof opts.level === 'number') ? opts.level : null;
  quizCustomWords = opts.words || null;

  if (quizLevel !== null) {
    quizWords = shuffle(levelWords(quizLevel));
  } else if (quizCustomWords) {
    quizWords = shuffle(quizCustomWords).slice(0, 20);
  } else {
    const category = document.getElementById('quiz-category').value;
    const count = parseInt(document.getElementById('quiz-count').value);
    quizWords = getWordsForMode(category, count);
    if (quizWords.length === 0) {
      handleEmptyPool(category);
      quizSessionDone = true;
      quizWords = [];
      return;
    }
  }
  quizIndex = 0;
  quizScore = 0;
  quizWrongWords = [];
  quizSessionDone = false;
  document.getElementById('quiz-score').textContent = '0';
  document.getElementById('quiz-area').style.display = '';
  document.getElementById('quiz-result').style.display = 'none';
  setQuizChrome();
  showQuizQuestion();
}

function getUniqueZhOptions(correctWord, count) {
  const correctZh = correctWord.zh;
  const allWords = orderedWords().filter(w => w.en !== correctWord.en && w.zh !== correctZh);
  const shuffled = shuffle(allWords);
  const seen = new Set();
  const result = [];
  for (const w of shuffled) {
    if (!seen.has(w.zh) && result.length < count) {
      seen.add(w.zh);
      result.push(w.zh);
    }
  }
  return result;
}

function getUniqueEnOptions(correctWord, count) {
  // distractors must differ in BOTH en and zh from the answer
  const result = [];
  const seen = new Set([correctWord.en]);
  for (const w of shuffle(orderedWords())) {
    if (result.length >= count) break;
    if (seen.has(w.en) || w.zh === correctWord.zh) continue;
    seen.add(w.en);
    result.push(w.en);
  }
  return result;
}

function showQuizQuestion() {
  if (quizIndex >= quizWords.length) {
    showQuizResult();
    return;
  }
  if (currentPage !== 'quiz') return; // page was left while a timer was pending

  quizAnswered = false;
  document.getElementById('quiz-continue').style.display = 'none';
  const word = quizWords[quizIndex];
  const isEnToZh = Math.random() > 0.3;

  document.getElementById('quiz-progress-fill').style.width = `${(quizIndex / quizWords.length) * 100}%`;

  if (isEnToZh) {
    document.getElementById('quiz-prompt').innerHTML = `<span class="quiz-speak-btn" data-word="${word.en}" style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;">${word.en} ${icon('volume-2', 20)}</span><br><span class="quiz-sub">这个单词是什么意思？</span>`;
    speakWord(word.en);
    const options = shuffle([word.zh, ...getUniqueZhOptions(word, 3)]);
    renderQuizOptions(options, word.zh, word);
  } else {
    document.getElementById('quiz-prompt').innerHTML = `<span>${word.zh}</span><br><span class="quiz-sub">对应的英文是哪个？</span>`;
    const options = shuffle([word.en, ...getUniqueEnOptions(word, 3)]);
    renderQuizOptions(options, word.en, word);
  }
  refreshIcons();
}

document.addEventListener('click', (e) => {
  const speakBtn = e.target.closest('.quiz-speak-btn');
  if (speakBtn) speakWord(speakBtn.dataset.word);
});

const QUIZ_OPTION_KEYS = ['A', 'B', 'C', 'D'];

function renderQuizOptions(options, correctAnswer, word) {
  const container = document.getElementById('quiz-options');
  container.innerHTML = '';
  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option';
    const key = QUIZ_OPTION_KEYS[i] || '';
    btn.dataset.key = key;
    const keySpan = document.createElement('span');
    keySpan.className = 'quiz-option-key';
    keySpan.textContent = key;
    const textSpan = document.createElement('span');
    textSpan.className = 'quiz-option-text';
    textSpan.textContent = opt;
    btn.append(keySpan, textSpan);
    btn.addEventListener('click', () => {
      if (quizAnswered) return;
      quizAnswered = true;

      const isCorrect = opt === correctAnswer;
      if (isCorrect) {
        btn.classList.add('correct');
        quizScore++;
        document.getElementById('quiz-score').textContent = quizScore;
        playSound('correct');
        vibrate(40);
        recordResult(word.en, true, 'quiz');
        speakWord(word.en, true);
        quizTimer = setTimeout(() => {
          quizIndex++;
          showQuizQuestion();
        }, 1000);
      } else {
        btn.classList.add('wrong');
        container.querySelectorAll('.quiz-option').forEach(b => {
          if (b.querySelector('.quiz-option-text')?.textContent === correctAnswer) b.classList.add('correct');
        });
        playSound('wrong');
        recordResult(word.en, false, 'quiz');
        quizWrongWords.push(word);
        speakWord(word.en, true);
        // no auto-advance on a miss — let the kid read the right answer
        document.getElementById('quiz-continue').style.display = '';
        refreshIcons();
      }
    });
    container.appendChild(btn);
  });
}

document.getElementById('quiz-continue').addEventListener('click', () => {
  document.getElementById('quiz-continue').style.display = 'none';
  quizIndex++;
  showQuizQuestion();
});

// A/B/C/D keyboard shortcuts on the quiz page
document.addEventListener('keydown', (e) => {
  if (currentPage !== 'quiz') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  const key = e.key.toUpperCase();
  if (key === 'ENTER' || key === ' ') {
    const cont = document.getElementById('quiz-continue');
    if (cont && cont.style.display !== 'none') { e.preventDefault(); cont.click(); }
    return;
  }
  if (!QUIZ_OPTION_KEYS.includes(key)) return;
  if (quizAnswered) return;
  const btn = document.querySelector(`.quiz-option[data-key="${key}"]`);
  if (btn) { e.preventDefault(); btn.click(); }
});

function showQuizResult() {
  quizSessionDone = true;
  const total = quizWords.length || 1;
  const pct = Math.round((quizScore / total) * 100);

  if (quizLevel !== null) {
    finishLevelQuiz(pct);
    return;
  }

  document.getElementById('quiz-area').style.display = 'none';
  document.getElementById('quiz-result').style.display = '';
  document.getElementById('quiz-progress-fill').style.width = '100%';

  const stars = pct >= 90 ? 3 : pct >= 70 ? 2 : 1; // finishing a round is always worth one star

  const resultIconEl = document.getElementById('result-icon');
  resultIconEl.className = `result-icon ${resultIconClass(pct)}`;
  resultIconEl.innerHTML = icon(resultIconName(pct), 40);
  document.getElementById('quiz-result-mascot').textContent = mascotReaction(pct);

  document.getElementById('result-title').textContent = pct >= 90 ? '太棒了！' : pct >= 70 ? '不错哦！' : '没关系，错的词下次一定记得住！';
  document.getElementById('result-detail').textContent = `答对 ${quizScore}/${quizWords.length} 题（${pct}%）`;
  document.getElementById('result-stars').innerHTML = renderStars(stars, 3);

  const wrongBox = document.getElementById('quiz-wrong-words');
  const retryWrongBtn = document.getElementById('quiz-retry-wrong');
  if (quizWrongWords.length > 0) {
    wrongBox.innerHTML = quizWrongWords.map(w => `<span class="rww">${w.en} ${w.zh}</span>`).join('');
    retryWrongBtn.style.display = '';
  } else {
    wrongBox.innerHTML = '';
    retryWrongBtn.style.display = 'none';
  }

  addStars(stars);
  if (pct >= 70) launchConfetti();
  playSound(pct >= 70 ? 'victory' : 'gentle');
  refreshIcons();
}

function finishLevelQuiz(pct) {
  const lvl = quizLevel;
  const earned = pct >= 90 ? 3 : pct >= 80 ? 2 : pct >= 70 ? 1 : 0;
  const progress = getProgress();
  const prev = progress.levels[lvl] || 0;
  if (earned > prev) {
    progress.levels[lvl] = earned;
    persist();
  }
  const passed = earned >= 1;
  if (passed) {
    addStars(Math.max(0, earned));
    launchConfetti();
    playSound('victory');
  } else {
    playSound('gentle');
  }
  const wrongChips = quizWrongWords.map(w => `<span class="rww">${w.en} ${w.zh}</span>`).join('');
  const nextExists = lvl + 1 < levelCount();
  showDialog(`
    <div class="wp-emoji">${passed ? '🦊🎉' : '🦊💪'}</div>
    <div class="result-title">${passed ? `第 ${lvl + 1} 关通过！` : '差一点点！'}</div>
    <div class="result-detail">答对 ${quizScore}/${quizWords.length} 题（${pct}%）${passed ? '' : '，答对 7 题就能过关，再试一次吧！'}</div>
    <div class="result-stars">${renderStars(earned, 3)}</div>
    ${wrongChips ? `<div class="result-wrong-words">${wrongChips}</div>` : ''}
    <div class="dialog-actions">
      <button class="cancel-btn" data-act="map">回地图</button>
      ${passed && nextExists ? '<button class="primary-btn" data-act="next">下一关！</button>' : '<button class="primary-btn" data-act="retry">再闯一次</button>'}
    </div>
  `, (ov) => {
    ov.querySelector('[data-act="map"]').addEventListener('click', () => { ov.remove(); navigateTo('home'); });
    const next = ov.querySelector('[data-act="next"]');
    if (next) next.addEventListener('click', () => { ov.remove(); startLevel(lvl + 1); });
    const retry = ov.querySelector('[data-act="retry"]');
    if (retry) retry.addEventListener('click', () => { ov.remove(); startLevel(lvl); });
  });
  // reset quiz so the nav guard re-inits next time
  quizWords = [];
  quizLevel = null;
}

document.getElementById('quiz-retry').addEventListener('click', () => initQuiz(quizCustomWords ? { words: quizCustomWords } : {}));
document.getElementById('quiz-retry-wrong').addEventListener('click', () => {
  if (quizWrongWords.length > 0) initQuiz({ words: quizWrongWords.slice() });
});
document.getElementById('quiz-category').addEventListener('change', async (e) => {
  const ok = await confirmRestart(!quizSessionDone && quizIndex > 0);
  if (ok) initQuiz();
  else e.target.value = e.target.dataset.prev || 'learned';
});
document.getElementById('quiz-count').addEventListener('change', async (e) => {
  const ok = await confirmRestart(!quizSessionDone && quizIndex > 0);
  if (ok) initQuiz();
  else e.target.value = e.target.dataset.prev || '10';
});
['quiz-category', 'quiz-count'].forEach(id => {
  const el = document.getElementById(id);
  el.dataset.prev = el.value;
  el.addEventListener('focus', () => { el.dataset.prev = el.value; });
});

// ===== Level flow =====
function startLevel(idx) {
  if (!levelUnlocked(idx)) {
    showToast('先通过上一关才能解锁哦！');
    return;
  }
  navigateTo('flashcard');
  initFlashcard({ level: idx });
}

// ===== Spelling Mode =====
let spellingWords = [];
let spellingIndex = 0;
let spellingScore = 0;
let spellingAnswered = false;
let spellingHintLevel = 0;
let spellingAttempts = 0;
let spellingRetype = false;
let spellingWrongWords = [];
let spellingSessionDone = true;
let spellingListenMode = false;
let spellingPrevLen = 0;

// Render the letter cells from the current input value. Cells = max(word length,
// chars typed) so the row always reveals the target length (a gentle scaffold)
// but never reveals which letters are right — that's still checked only on submit.
function renderSpellingCells(justFilledIndex) {
  const cellsEl = document.getElementById('spelling-cells');
  const word = spellingWords[spellingIndex];
  if (!word) { cellsEl.innerHTML = ''; return; }
  const val = document.getElementById('spelling-input').value;
  const targetLen = word.en.length;
  const n = Math.max(targetLen, val.length);

  // reconcile cell count in place — never rebuild the row, or every existing
  // letter would replay its pop animation on each keystroke (the jank)
  while (cellsEl.children.length < n) {
    const s = document.createElement('span');
    s.className = 'cell';
    cellsEl.appendChild(s);
  }
  while (cellsEl.children.length > n) cellsEl.removeChild(cellsEl.lastChild);

  for (let i = 0; i < n; i++) {
    const cell = cellsEl.children[i];
    const ch = val[i];
    const filled = ch !== undefined;
    const text = filled ? ch : '';
    if (cell.textContent !== text) cell.textContent = text;
    cell.classList.toggle('filled', filled);
    cell.classList.toggle('current', !filled && i === val.length);
    cell.classList.toggle('overflow', filled && i >= targetLen); // typed past the word
  }

  // one-shot pop on only the cell that just received a letter
  const popCell = justFilledIndex != null && cellsEl.children[justFilledIndex];
  if (popCell) { popCell.classList.remove('pop'); void popCell.offsetWidth; popCell.classList.add('pop'); }

  // invite a check once the row is exactly full (common case, no overflow)
  document.getElementById('spelling-submit').classList.toggle(
    'ready', val.length === targetLen && !spellingAnswered
  );
}

// Set the input value programmatically and keep the cells + keystroke state in sync.
function setSpellingValue(val) {
  document.getElementById('spelling-input').value = val;
  spellingPrevLen = val.length;
  renderSpellingCells();
}

// Replay the shake animation (must drop + re-add the class to restart it).
function flashSpellingShake() {
  const cells = document.getElementById('spelling-cells');
  cells.classList.remove('shake');
  void cells.offsetWidth;
  cells.classList.add('shake');
  vibrate(60);
}

function initSpelling(opts) {
  opts = opts || {};
  spellingListenMode = document.getElementById('spelling-mode').value === 'listen';
  const category = document.getElementById('spelling-category').value;
  const count = parseInt(document.getElementById('spelling-count').value);

  let pool;
  if (opts.words) {
    pool = opts.words;
  } else {
    pool = poolForMode(category);
    // function words (operations) make poor spelling prompts — drop them
    pool = pool.filter(w => w.category !== 'operations');
  }
  spellingWords = opts.words ? shuffle(pool).slice(0, 20) : weightedSample(pool, Math.min(count, pool.length));
  if (spellingWords.length === 0) {
    handleEmptyPool(category);
    spellingSessionDone = true;
    spellingWords = [];
    return;
  }
  spellingIndex = 0;
  spellingScore = 0;
  spellingWrongWords = [];
  spellingSessionDone = false;
  document.getElementById('spelling-score').textContent = '0';
  document.getElementById('spelling-area').style.display = '';
  document.getElementById('spelling-result').style.display = 'none';
  showSpellingQuestion();
}

function showSpellingQuestion() {
  if (spellingIndex >= spellingWords.length) {
    showSpellingResult();
    return;
  }
  if (currentPage !== 'spelling') return;

  spellingAnswered = false;
  spellingHintLevel = 0;
  spellingAttempts = 0;
  spellingRetype = false;

  const word = spellingWords[spellingIndex];
  document.getElementById('spelling-progress-fill').style.width = `${(spellingIndex / spellingWords.length) * 100}%`;

  const listenBtn = document.getElementById('spelling-listen');
  if (spellingListenMode) {
    document.getElementById('spelling-prompt').textContent = '听一听，拼出来！';
    listenBtn.style.display = '';
    speakWord(word.en);
  } else {
    document.getElementById('spelling-prompt').textContent = word.zh;
    listenBtn.style.display = 'none';
  }

  document.getElementById('spelling-hint-text').textContent = '';
  document.getElementById('spelling-feedback').textContent = '';
  document.getElementById('spelling-feedback').className = 'spelling-feedback';
  const input = document.getElementById('spelling-input');
  input.disabled = false;
  setSpellingValue('');
  document.getElementById('spelling-cells').classList.remove('shake', 'win');
  document.getElementById('spelling-submit').disabled = false;
  const hintBtn = document.getElementById('spelling-hint-btn');
  hintBtn.style.opacity = '';
  hintBtn.style.pointerEvents = '';
  input.focus();
}

function advanceSpelling(delay) {
  spellingTimer = setTimeout(() => {
    spellingIndex++;
    showSpellingQuestion();
  }, delay);
}

function checkSpelling() {
  if (spellingAnswered && !spellingRetype) return;
  const word = spellingWords[spellingIndex];
  if (!word) return;
  const inputEl = document.getElementById('spelling-input');
  const input = inputEl.value.trim().toLowerCase();
  const feedback = document.getElementById('spelling-feedback');

  if (input === '') {
    feedback.innerHTML = '先输入单词再点确认哦 ✏️';
    feedback.className = 'spelling-feedback';
    inputEl.focus();
    return; // empty input never costs an attempt
  }

  // accept any word that shares the same Chinese meaning (defence in depth;
  // the data layer also guarantees zh uniqueness)
  const acceptable = orderedWords().filter(w => w.zh === word.zh).map(w => w.en.toLowerCase());
  const correct = acceptable.includes(input);

  if (spellingRetype) {
    // copy-the-answer step after two misses: doesn't change the score
    if (input === word.en.toLowerCase()) {
      feedback.innerHTML = `${icon('circle-check', 16)} 照着拼对啦，记住它！`;
      feedback.className = 'spelling-feedback correct';
      playSound('correct');
      inputEl.disabled = true;
      document.getElementById('spelling-submit').disabled = true;
      advanceSpelling(900);
    } else {
      feedback.innerHTML = `再仔细看一眼：<strong>${word.en}</strong>`;
      feedback.className = 'spelling-feedback wrong';
      setSpellingValue('');
      flashSpellingShake();
      inputEl.focus();
    }
    refreshIcons();
    return;
  }

  if (correct) {
    spellingAnswered = true;
    spellingScore++;
    document.getElementById('spelling-score').textContent = spellingScore;
    feedback.innerHTML = `${icon('circle-check', 16)} 拼对啦！`;
    feedback.className = 'spelling-feedback correct';
    const cellsEl = document.getElementById('spelling-cells');
    cellsEl.classList.add('win');
    document.getElementById('spelling-submit').classList.remove('ready');
    playSound('correct');
    vibrate(40);
    // hints make it easier — a hinted word doesn't move toward "mastered"
    recordResult(word.en, true, spellingListenMode ? 'dictation' : 'spelling', { noMastery: spellingHintLevel > 0 });
    speakWord(word.en, true);
    inputEl.disabled = true;
    document.getElementById('spelling-submit').disabled = true;
    advanceSpelling(1100);
  } else {
    spellingAttempts++;
    playSound('wrong');
    if (spellingListenMode && spellingAttempts === 1) {
      // in dictation, the first miss reveals the Chinese meaning
      document.getElementById('spelling-hint-text').textContent = `意思是：${word.zh}`;
    }
    if (spellingAttempts >= 2) {
      spellingAnswered = true;
      recordResult(word.en, false, spellingListenMode ? 'dictation' : 'spelling');
      spellingWrongWords.push(word);
      feedback.innerHTML = `正确答案是 <strong>${word.en}</strong>，照着拼一遍吧！`;
      feedback.className = 'spelling-feedback wrong';
      speakWord(word.en, true);
      spellingRetype = true;
      setSpellingValue('');
      flashSpellingShake();
      inputEl.focus();
    } else {
      feedback.innerHTML = `${icon('circle-x', 16)} 差一点，再试一次！`;
      feedback.className = 'spelling-feedback wrong';
      flashSpellingShake();
      inputEl.select();
    }
  }
  refreshIcons();
}

document.getElementById('spelling-submit').addEventListener('click', checkSpelling);
document.getElementById('spelling-input').addEventListener('input', () => {
  const len = document.getElementById('spelling-input').value.length;
  if (len > spellingPrevLen) { playKeyClick(true); renderSpellingCells(len - 1); }
  else { if (len < spellingPrevLen) playKeyClick(false); renderSpellingCells(); }
  spellingPrevLen = len;
});
document.getElementById('spelling-input').addEventListener('keydown', (e) => {
  // ignore Enter while an IME is composing (keyCode 229)
  if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) checkSpelling();
});
// tapping anywhere on the cells refocuses the hidden input (pops the mobile keyboard)
document.getElementById('spelling-type').addEventListener('click', () => {
  try { const c = getAudioCtx(); if (c.state !== 'running') c.resume(); } catch { /* ignore */ }
  const input = document.getElementById('spelling-input');
  if (!input.disabled) input.focus();
});
document.getElementById('spelling-listen').addEventListener('click', () => {
  const word = spellingWords[spellingIndex];
  if (word) speakWord(word.en);
});

document.getElementById('spelling-hint-btn').addEventListener('click', () => {
  if (spellingAnswered) return;
  const word = spellingWords[spellingIndex];
  if (!word) return;
  spellingHintLevel++;

  const en = word.en;
  if (spellingHintLevel === 1) {
    document.getElementById('spelling-hint-text').textContent = `${en[0]}${'_'.repeat(Math.max(0, en.length - 1))} (${en.length}个字母)`;
  } else if (spellingHintLevel === 2) {
    const revealed = en.split('').map((c, i) => i < Math.ceil(en.length * 0.5) ? c : '_').join('');
    document.getElementById('spelling-hint-text').textContent = revealed;
  } else if (spellingHintLevel === 3) {
    // final hint: scrambled letters, never the n-1 giveaway
    const scrambled = shuffle(en.split('')).join(' ');
    document.getElementById('spelling-hint-text').textContent = `把字母排排队：${scrambled}`;
  }
  if (spellingHintLevel >= 3) {
    document.getElementById('spelling-hint-btn').style.opacity = '0.5';
    document.getElementById('spelling-hint-btn').style.pointerEvents = 'none';
  }
});

function showSpellingResult() {
  spellingSessionDone = true;
  document.getElementById('spelling-area').style.display = 'none';
  document.getElementById('spelling-result').style.display = '';

  const total = spellingWords.length || 1;
  const pct = Math.round((spellingScore / total) * 100);
  const stars = pct >= 90 ? 3 : pct >= 70 ? 2 : 1;

  const resultIconEl = document.getElementById('spelling-result-icon');
  resultIconEl.className = `result-icon ${resultIconClass(pct)}`;
  resultIconEl.innerHTML = icon(resultIconName(pct), 40);
  document.getElementById('spelling-result-mascot').textContent = mascotReaction(pct);

  document.getElementById('spelling-result-title').textContent = pct >= 90 ? '拼写高手！' : pct >= 70 ? '不错哦！' : '没关系，多拼几遍就记住啦！';
  document.getElementById('spelling-result-detail').textContent = `拼对 ${spellingScore}/${spellingWords.length}（${pct}%）`;
  document.getElementById('spelling-result-stars').innerHTML = renderStars(stars, 3);

  const wrongBox = document.getElementById('spelling-wrong-words');
  const retryWrongBtn = document.getElementById('spelling-retry-wrong');
  if (spellingWrongWords.length > 0) {
    wrongBox.innerHTML = spellingWrongWords.map(w => `<span class="rww">${w.en} ${w.zh}</span>`).join('');
    retryWrongBtn.style.display = '';
  } else {
    wrongBox.innerHTML = '';
    retryWrongBtn.style.display = 'none';
  }

  addStars(stars);
  if (pct >= 70) launchConfetti();
  playSound(pct >= 70 ? 'victory' : 'gentle');
  refreshIcons();
}

document.getElementById('spelling-retry').addEventListener('click', () => initSpelling());
document.getElementById('spelling-retry-wrong').addEventListener('click', () => {
  if (spellingWrongWords.length > 0) initSpelling({ words: spellingWrongWords.slice() });
});
['spelling-category', 'spelling-count', 'spelling-mode'].forEach(id => {
  const el = document.getElementById(id);
  el.dataset.prev = el.value;
  el.addEventListener('focus', () => { el.dataset.prev = el.value; });
  el.addEventListener('change', async (e) => {
    const ok = await confirmRestart(!spellingSessionDone && spellingIndex > 0);
    if (ok) initSpelling();
    else e.target.value = e.target.dataset.prev;
  });
});

// ===== Memory Match Game =====
let memCards = [];
let memFlipped = [];
let memMatched = 0;
let memTotal = 0;
let memMoves = 0;
let memLocked = false;

function initMemory() {
  const pairsCount = parseInt(document.getElementById('memory-pairs-count').value);
  const emojiMode = document.getElementById('memory-mode').value === 'emoji';
  memTotal = pairsCount;
  memMatched = 0;
  memMoves = 0;
  memLocked = false;
  memFlipped = [];

  document.getElementById('memory-moves').textContent = '0';
  document.getElementById('memory-pairs').textContent = '0';
  document.getElementById('memory-total').textContent = pairsCount;
  document.getElementById('memory-result').style.display = 'none';

  const progress = getProgress();
  let pool = emojiMode
    ? getWordsByCategory('picturable').filter(w => wordEmoji(w.en))
    : orderedWords();

  // prefer words the kid has already met, fall back to the full pool
  const learnedPool = pool.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new');
  const basePool = learnedPool.length >= pairsCount ? learnedPool : pool;

  // never deal two cards with the same Chinese text
  const seenZh = new Set();
  const words = [];
  for (const w of shuffle(basePool)) {
    if (words.length >= pairsCount) break;
    if (seenZh.has(w.zh)) continue;
    seenZh.add(w.zh);
    words.push(w);
  }

  memCards = [];
  words.forEach((w, i) => {
    memCards.push({ id: i, type: 'en', text: w.en, pairId: i, word: w });
    if (emojiMode) {
      memCards.push({ id: i, type: 'emoji', text: wordEmoji(w.en), pairId: i, word: w });
    } else {
      memCards.push({ id: i, type: 'zh', text: w.zh, pairId: i, word: w });
    }
  });
  memCards = shuffle(memCards);

  const board = document.getElementById('memory-board');
  board.innerHTML = '';

  memCards.forEach((card, index) => {
    const el = document.createElement('div');
    el.className = 'memory-card';
    el.dataset.index = index;
    let backInner;
    if (card.type === 'en') {
      backInner = `<span class="mem-en ${card.text.length > 8 ? 'mem-long' : ''}">${card.text}</span>`;
    } else if (card.type === 'emoji') {
      backInner = `<span class="mem-emoji">${card.text}</span>`;
    } else {
      backInner = `<span class="mem-zh">${card.text}</span>`;
    }
    el.innerHTML = `
      <div class="memory-card-inner">
        <div class="memory-card-face memory-card-front">${icon('help-circle', 28)}</div>
        <div class="memory-card-face memory-card-back">${backInner}</div>
      </div>
    `;
    el.addEventListener('click', () => flipMemCard(index));
    board.appendChild(el);
  });
  refreshIcons();
}

function flipMemCard(index) {
  if (memLocked) return;
  const el = document.querySelector(`.memory-card[data-index="${index}"]`);
  if (!el || el.classList.contains('flipped') || el.classList.contains('matched')) return;

  el.classList.add('flipped');
  playSound('flip');
  memFlipped.push(index);

  if (memFlipped.length === 2) {
    memLocked = true;
    memMoves++;
    document.getElementById('memory-moves').textContent = memMoves;

    const [i1, i2] = memFlipped;
    const card1 = memCards[i1];
    const card2 = memCards[i2];

    if (card1.pairId === card2.pairId && card1.type !== card2.type) {
      setTimeout(() => {
        document.querySelector(`.memory-card[data-index="${i1}"]`).classList.add('matched');
        document.querySelector(`.memory-card[data-index="${i2}"]`).classList.add('matched');
        playSound('match');
        vibrate(40);
        memMatched++;
        document.getElementById('memory-pairs').textContent = memMatched;
        // a memory miss is a position-memory slip, not a vocabulary mistake —
        // matches only refresh exposure, they never write correct/wrong
        recordSeen(card1.word.en);
        speakWord(card1.word.en, true);
        memFlipped = [];
        memLocked = false;
        if (memMatched === memTotal) {
          setTimeout(showMemoryResult, 500);
        }
      }, 400);
    } else {
      setTimeout(() => {
        document.querySelector(`.memory-card[data-index="${i1}"]`).classList.remove('flipped');
        document.querySelector(`.memory-card[data-index="${i2}"]`).classList.remove('flipped');
        memFlipped = [];
        memLocked = false;
      }, 800);
    }
  }
}

function showMemoryResult() {
  document.getElementById('memory-result').style.display = '';
  const perfect = memMoves <= memTotal + 2;
  const stars = perfect ? 3 : memMoves <= memTotal * 1.5 ? 2 : 1;

  const efficiency = memTotal / Math.max(1, memMoves);
  const pct = Math.min(100, Math.round(efficiency * 100));
  const resultIconEl = document.getElementById('memory-result-icon');
  // icon follows the same "perfect" judgement as the title
  resultIconEl.className = `result-icon ${perfect ? 'icon-success' : resultIconClass(pct)}`;
  resultIconEl.innerHTML = icon(perfect ? 'trophy' : resultIconName(pct), 40);
  document.getElementById('memory-result-mascot').textContent = perfect ? '🦊🎉' : '🦊👍';

  document.getElementById('memory-result-title').textContent = perfect ? '完美配对！' : '配对完成！';
  document.getElementById('memory-result-detail').textContent = `${memMoves} 步完成 ${memTotal} 对配对`;
  document.getElementById('memory-result-stars').innerHTML = renderStars(stars, 3);

  addStars(stars);
  launchConfetti();
  playSound('victory');
  refreshIcons();
}

document.getElementById('memory-retry').addEventListener('click', initMemory);
document.getElementById('memory-pairs-count').addEventListener('change', initMemory);
document.getElementById('memory-mode').addEventListener('change', initMemory);

// ===== Progress Page =====
function refreshProgressPage() {
  const progress = getProgress();
  const all = orderedWords();
  const learned = all.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new').length;
  const mastered = all.filter(w => progress.words[w.en] && progress.words[w.en].status === 'mastered').length;

  document.getElementById('pg-total-learned').textContent = learned;
  document.getElementById('pg-total-mastered').textContent = mastered;
  document.getElementById('pg-total-stars').textContent = progress.stars;
  document.getElementById('pg-streak').textContent = progress.streak;

  // 7-day chart
  const chart = document.getElementById('daily-chart');
  chart.innerHTML = '';
  const days = [];
  let maxAnswered = 1;
  for (let i = 6; i >= 0; i--) {
    const key = isoDaysAgo(i);
    const log = progress.dailyLog[key] || { answered: 0, correct: 0 };
    maxAnswered = Math.max(maxAnswered, log.answered);
    days.push({ key, log, dayNum: Number(key.slice(8, 10)), isToday: i === 0 });
  }
  days.forEach(d => {
    const col = document.createElement('div');
    col.className = 'chart-col';
    const h = Math.round((d.log.answered / maxAnswered) * 100);
    col.innerHTML = `
      <span class="chart-num">${d.log.answered || ''}</span>
      <div class="chart-bar-wrap"><div class="chart-bar ${d.log.answered === 0 ? 'empty' : ''}" style="height:${Math.max(4, h)}%"></div></div>
      <span class="chart-day">${d.isToday ? '今天' : d.dayNum + '日'}</span>
    `;
    chart.appendChild(col);
  });

  // weak words
  const weakEl = document.getElementById('weak-words');
  weakEl.innerHTML = '';
  const weak = all
    .map(w => ({ w, rec: progress.words[w.en] }))
    .filter(x => x.rec && x.rec.wrong > 0 && isWeakWord(progress, x.w))
    .sort((a, b) => (b.rec.wrong - b.rec.correct) - (a.rec.wrong - a.rec.correct))
    .slice(0, 10);
  if (weak.length > 0) {
    weak.forEach(({ w, rec }) => {
      const chip = document.createElement('button');
      chip.className = 'weak-word';
      chip.innerHTML = `${w.en} <span class="ww-zh">${w.zh}</span> <span class="ww-count">×${rec.wrong}</span>`;
      chip.addEventListener('click', () => showWordPopup(w));
      weakEl.appendChild(chip);
    });
    const practice = document.createElement('button');
    practice.className = 'weak-practice-btn';
    practice.innerHTML = `${icon('repeat', 18)} 专练这些词`;
    practice.addEventListener('click', () => {
      navigateTo('flashcard');
      initFlashcard({ words: weak.map(x => x.w) });
    });
    weakEl.appendChild(practice);
  } else {
    weakEl.innerHTML = `
      <div class="empty-state">
        <div class="es-emoji">💪</div>
        <div class="es-text">没有要加强的词，每个都答得很好！</div>
      </div>`;
  }

  // Category progress
  const listEl = document.getElementById('category-progress-list');
  listEl.innerHTML = '';
  WORD_DATA.categories.forEach(cat => {
    const catWords = getWordsByCategory(cat.id);
    const catLearned = catWords.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new').length;
    const pct = Math.round((catLearned / catWords.length) * 100);

    const item = document.createElement('div');
    item.className = 'cat-prog-item';
    item.innerHTML = `
      <div class="cat-prog-icon-block" style="background:${cat.color};">
        ${icon(cat.icon, 20)}
      </div>
      <div class="cat-prog-info">
        <div class="cat-prog-name">${cat.nameZh}${pct === 100 ? ' 👑' : ''}</div>
        <div class="cat-prog-bar"><div class="cat-prog-fill" style="width:${pct}%;background:${cat.color}"></div></div>
      </div>
      <span class="cat-prog-pct">${pct}%</span>
    `;
    listEl.appendChild(item);
  });

  // Recent words
  const recentEl = document.getElementById('recent-words');
  recentEl.innerHTML = '';
  if (progress.recentWords && progress.recentWords.length > 0) {
    progress.recentWords.slice(0, 20).forEach(w => {
      const span = document.createElement('span');
      span.className = 'recent-word';
      span.innerHTML = `${w.en}<span class="rw-zh">${w.zh}</span>`;
      recentEl.appendChild(span);
    });
  } else {
    recentEl.innerHTML = `
      <div class="empty-state">
        <div class="es-emoji">🦊</div>
        <div class="es-text">还没学过单词，和奇奇一起开始吧！</div>
        <button class="primary-btn" id="es-start-btn">去翻卡片</button>
      </div>`;
    const btn = document.getElementById('es-start-btn');
    if (btn) btn.addEventListener('click', () => { navigateTo('flashcard'); initFlashcard(); });
  }
  refreshIcons();
}

// ===== Parent zone (arithmetic gate) =====
document.getElementById('parent-btn').addEventListener('click', () => {
  const a = 2 + Math.floor(Math.random() * 7);
  const b = 3 + Math.floor(Math.random() * 7);
  showDialog(`
    <div class="wp-emoji">🔒</div>
    <div class="result-title" style="font-size:1.2rem;">家长专区</div>
    <div class="result-detail">请回答：${a} × ${b} = ?</div>
    <div style="margin-top:12px;"><input class="gate-input" type="number" inputmode="numeric" id="gate-input"></div>
    <div class="dialog-actions">
      <button class="cancel-btn" data-act="cancel">取消</button>
      <button class="primary-btn" data-act="ok">确认</button>
    </div>
  `, (ov) => {
    const input = ov.querySelector('#gate-input');
    input.focus();
    const submit = () => {
      if (parseInt(input.value) === a * b) {
        ov.remove();
        openParentZone();
      } else {
        input.value = '';
        input.placeholder = '再想想';
      }
    };
    ov.querySelector('[data-act="ok"]').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    ov.querySelector('[data-act="cancel"]').addEventListener('click', () => ov.remove());
  });
});

function openParentZone() {
  const progress = getProgress();
  let answered7 = 0, correct7 = 0, new7 = 0;
  for (let i = 0; i < 7; i++) {
    const log = progress.dailyLog[isoDaysAgo(i)];
    if (log) { answered7 += log.answered; correct7 += log.correct; new7 += log.newWords; }
  }
  const rate = answered7 > 0 ? Math.round((correct7 / answered7) * 100) : 0;
  const all = orderedWords();
  const learned = all.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new').length;

  showDialog(`
    <div class="wp-emoji">👨‍👩‍👧</div>
    <div class="result-title" style="font-size:1.2rem;">家长专区</div>
    <div style="text-align:left;margin-top:12px;">
      <div class="parent-row"><span>近 7 天答题</span><span>${answered7} 题</span></div>
      <div class="parent-row"><span>近 7 天正确率</span><span>${rate}%</span></div>
      <div class="parent-row"><span>近 7 天新学单词</span><span>${new7} 个</span></div>
      <div class="parent-row"><span>累计学过</span><span>${learned} / 850</span></div>
      <div class="parent-row"><span>连续学习</span><span>${progress.streak} 天</span></div>
    </div>
    <div class="dialog-actions">
      <button class="danger-btn" data-act="reset">重置全部进度</button>
      <button class="cancel-btn" data-act="close">关闭</button>
    </div>
  `, (ov) => {
    ov.querySelector('[data-act="close"]').addEventListener('click', () => ov.remove());
    ov.querySelector('[data-act="reset"]').addEventListener('click', async () => {
      ov.remove();
      const ok = await confirmDialog('确定重置吗？孩子的所有学习记录和星星都会清空，无法恢复！', '确定清空', '不重置了');
      if (ok) {
        resetAllProgress();
        showToast('已重置全部进度');
        refreshProgressPage();
        refreshHome();
      }
    });
  });
}

// ===== Milestones =====
function checkMilestones(en) {
  const progress = getProgress();
  const word = orderedWords().find(w => w.en === en);
  if (!word) return;

  // category fully learned
  if (!progress.celebrated[word.category] && isCategoryLearned(word.category)) {
    progress.celebrated[word.category] = true;
    persist();
    const cat = WORD_DATA.categories.find(c => c.id === word.category);
    launchConfetti();
    playSound('victory');
    showDialog(`
      <div class="wp-emoji">👑</div>
      <div class="result-title">${cat.nameZh}全部学完啦！</div>
      <div class="result-detail">${cat.words.length} 个单词都见过你了，这顶皇冠属于你！</div>
      <div class="dialog-actions"><button class="primary-btn" data-act="ok">耶！</button></div>
    `, (ov) => ov.querySelector('[data-act="ok"]').addEventListener('click', () => ov.remove()));
    return;
  }

  // full graduation: every word learned
  if (!progress.celebrated.graduation) {
    const all = orderedWords();
    const learnedAll = all.every(w => progress.words[w.en] && progress.words[w.en].status !== 'new');
    if (learnedAll) {
      progress.celebrated.graduation = true;
      persist();
      showGraduation();
    }
  }
}

function showGraduation() {
  launchConfetti();
  playSound('victory');
  const progress = getProgress();
  showDialog(`
    <div class="wp-emoji">🎓</div>
    <div class="result-title">毕业典礼！</div>
    <div class="result-detail">850 个单词全部学完，你太了不起了！这是你的毕业证书：</div>
    <div class="certificate-canvas-wrap"><canvas id="cert-canvas" width="600" height="420"></canvas></div>
    <div class="dialog-actions">
      <button class="primary-btn" data-act="save">保存证书</button>
      <button class="cancel-btn" data-act="close">关闭</button>
    </div>
  `, (ov) => {
    const canvas = ov.querySelector('#cert-canvas');
    const x = canvas.getContext('2d');
    const g = x.createLinearGradient(0, 0, 600, 420);
    g.addColorStop(0, '#6C63FF'); g.addColorStop(1, '#A78BFA');
    x.fillStyle = g; x.fillRect(0, 0, 600, 420);
    x.fillStyle = 'rgba(255,255,255,0.95)';
    x.fillRect(20, 20, 560, 380);
    x.fillStyle = '#6C63FF';
    x.font = '900 40px Nunito, sans-serif';
    x.textAlign = 'center';
    x.fillText('🎓 毕业证书 🎓', 300, 90);
    x.fillStyle = '#2D3436';
    x.font = '700 22px sans-serif';
    x.fillText('恭喜你学完了', 300, 150);
    x.fillStyle = '#6C63FF';
    x.font = '900 34px Nunito, sans-serif';
    x.fillText('Basic English 850', 300, 200);
    x.fillStyle = '#2D3436';
    x.font = '700 20px sans-serif';
    x.fillText(`共获得 ${progress.stars} 颗星星 · 连续学习 ${progress.streak} 天`, 300, 250);
    x.font = '600 18px sans-serif';
    x.fillStyle = '#636E72';
    x.fillText(`${isoDate()} · 词趣`, 300, 310);
    x.font = '40px sans-serif';
    x.fillText('🦊⭐👑', 300, 365);

    ov.querySelector('[data-act="save"]').addEventListener('click', () => {
      try {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `词趣毕业证书-${isoDate()}.png`;
        a.click();
      } catch { showToast('保存失败，长按图片试试'); }
    });
    ov.querySelector('[data-act="close"]').addEventListener('click', () => ov.remove());
  });
}

// ===== Shop =====
const SHOP_ITEMS = [
  { id: 'theme-ocean', type: 'theme', name: '海洋卡片', desc: '蓝色海洋风的翻卡主题', cost: 30, preview: 'linear-gradient(135deg, #0EA5E9, #2563EB)', emoji: '🌊' },
  { id: 'theme-sunset', type: 'theme', name: '日落卡片', desc: '橙粉色日落风的翻卡主题', cost: 50, preview: 'linear-gradient(135deg, #F97316, #DB2777)', emoji: '🌅' },
  { id: 'theme-space', type: 'theme', name: '星空卡片', desc: '深紫色星空风的翻卡主题', cost: 80, preview: 'linear-gradient(135deg, #1E1B4B, #6D28D9)', emoji: '🌌' },
  { id: 'acc-hat', type: 'accessory', name: '奇奇的礼帽', desc: '给小狐狸戴上绅士礼帽', cost: 40, emoji: '🎩' },
  { id: 'acc-glasses', type: 'accessory', name: '奇奇的墨镜', desc: '给小狐狸戴上酷酷的墨镜', cost: 60, emoji: '🕶️' },
  { id: 'repair-card', type: 'consumable', name: '补签卡', desc: '忘记学习一天？它能保住连续天数', cost: 30, emoji: '🔥' }
];

function applyTheme() {
  const p = getProgress();
  const front = document.getElementById('flashcard-front');
  front.classList.remove('theme-ocean', 'theme-sunset', 'theme-space');
  if (p.activeTheme && p.activeTheme !== 'default') front.classList.add(p.activeTheme);
}

function renderShop() {
  const p = getProgress();
  document.getElementById('shop-balance').textContent = starBalance();
  const grid = document.getElementById('shop-grid');
  grid.innerHTML = '';
  SHOP_ITEMS.forEach(item => {
    const owned = item.type === 'consumable' ? false : p.owned.includes(item.id);
    const isActiveTheme = item.type === 'theme' && p.activeTheme === item.id;
    const canAfford = starBalance() >= item.cost;
    const div = document.createElement('div');
    div.className = 'shop-item';
    let btnHtml;
    if (item.type === 'consumable') {
      btnHtml = `<button class="si-btn" ${canAfford ? '' : 'disabled'}>⭐${item.cost} 买一张${p.repairCards > 0 ? `（有${p.repairCards}张）` : ''}</button>`;
    } else if (isActiveTheme) {
      btnHtml = `<button class="si-btn active-theme">使用中 ${icon('check', 16)}</button>`;
    } else if (owned && item.type === 'theme') {
      btnHtml = `<button class="si-btn owned">用这个</button>`;
    } else if (owned) {
      btnHtml = `<button class="si-btn owned">已拥有 ${icon('check', 16)}</button>`;
    } else {
      btnHtml = `<button class="si-btn" ${canAfford ? '' : 'disabled'}>⭐${item.cost} 兑换</button>`;
    }
    div.innerHTML = `
      <div class="si-preview" style="background:${item.preview || 'var(--primary-pale)'}">${item.emoji}</div>
      <div class="si-name">${item.name}</div>
      <div class="si-desc">${item.desc}</div>
      ${btnHtml}
    `;
    const btn = div.querySelector('.si-btn');
    btn.addEventListener('click', () => handleShopClick(item));
    grid.appendChild(div);
  });
  refreshIcons();
}

function handleShopClick(item) {
  const p = getProgress();
  const owned = p.owned.includes(item.id);

  if (item.type === 'theme' && owned) {
    p.activeTheme = (p.activeTheme === item.id) ? 'default' : item.id;
    persist();
    applyTheme();
    showToast(p.activeTheme === item.id ? `已换上${item.name}！` : '换回默认卡片');
    renderShop();
    return;
  }
  if (owned) return;
  if (starBalance() < item.cost) {
    showToast('星星还不够，去闯关赚星星吧！');
    return;
  }
  p.starsSpent += item.cost;
  if (item.type === 'consumable') {
    p.repairCards++;
  } else {
    p.owned.push(item.id);
    if (item.type === 'theme') p.activeTheme = item.id;
  }
  persist();
  applyTheme();
  playSound('match');
  showToast(`兑换成功！${item.emoji}`);
  renderShop();
}

// ===== Navigation Events =====
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    navigateTo(page);
    if (page === 'flashcard' && (fcWords.length === 0 || fcIndex >= fcWords.length)) initFlashcard();
    if (page === 'quiz' && (quizWords.length === 0 || quizSessionDone)) initQuiz();
    if (page === 'memory' && (memCards.length === 0 || memMatched === memTotal)) initMemory();
    if (page === 'spelling' && (spellingWords.length === 0 || spellingSessionDone)) initSpelling();
  });
});

document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    const mode = card.dataset.mode;
    navigateTo(mode);
    if (mode === 'flashcard') initFlashcard();
    if (mode === 'quiz') initQuiz();
    if (mode === 'memory') initMemory();
    if (mode === 'spelling') initSpelling();
  });
});

document.querySelectorAll('.back-btn').forEach(btn => {
  btn.addEventListener('click', () => goBack());
});

// ===== Initialize =====
probeStorage();
getProgress();
applyTheme();
try { history.replaceState({ page: 'home' }, '', location.pathname); } catch {}
refreshHome();
refreshIcons();

// register the service worker for offline use
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
