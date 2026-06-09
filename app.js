// ===== Word Fun - Basic English 850 Learning App =====

// ===== Lucide Icon Helper =====
function icon(name, size) {
  const s = size || 24;
  return `<i data-lucide="${name}" style="width:${s}px;height:${s}px;"></i>`;
}

function refreshIcons() {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// ===== Storage =====
const STORAGE_KEY = 'wordfun_progress';

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
    // Handle quota exceeded - trim old data
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      data.recentWords = data.recentWords.slice(0, 5);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
    }
  }
}

function getProgress() {
  const saved = loadProgress();
  if (saved) return saved;
  return {
    words: {},
    stars: 0,
    streak: 0,
    lastDate: null,
    recentWords: []
  };
}

function updateWordStatus(en, status) {
  const progress = getProgress();
  if (!progress.words[en]) {
    progress.words[en] = { status: 'new', lastSeen: 0, correct: 0, wrong: 0 };
  }
  progress.words[en].status = status;
  progress.words[en].lastSeen = Date.now();
  if (status === 'learning' || status === 'mastered') {
    progress.recentWords = progress.recentWords.filter(w => w.en !== en);
    progress.recentWords.unshift({ en, zh: findWordZh(en), timestamp: Date.now() });
    if (progress.recentWords.length > 20) progress.recentWords = progress.recentWords.slice(0, 20);
  }
  saveProgress(progress);
}

function recordAnswer(en, isCorrect) {
  const progress = getProgress();
  if (!progress.words[en]) {
    progress.words[en] = { status: 'new', lastSeen: 0, correct: 0, wrong: 0 };
  }
  progress.words[en].lastSeen = Date.now();
  if (isCorrect) {
    progress.words[en].correct++;
    if (progress.words[en].correct >= 4 && progress.words[en].status !== 'mastered') {
      progress.words[en].status = 'mastered';
    } else if (progress.words[en].correct >= 2 && progress.words[en].status === 'new') {
      progress.words[en].status = 'learning';
    }
  } else {
    progress.words[en].wrong++;
    if (progress.words[en].status === 'mastered' && progress.words[en].wrong > progress.words[en].correct) {
      progress.words[en].status = 'learning';
    }
  }
  progress.recentWords = progress.recentWords.filter(w => w.en !== en);
  progress.recentWords.unshift({ en, zh: findWordZh(en), timestamp: Date.now() });
  if (progress.recentWords.length > 20) progress.recentWords = progress.recentWords.slice(0, 20);
  saveProgress(progress);
}

function addStars(count) {
  const progress = getProgress();
  progress.stars += count;
  saveProgress(progress);
}

function updateStreak() {
  const progress = getProgress();
  const today = new Date().toDateString();
  if (progress.lastDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (progress.lastDate === yesterday) {
      progress.streak++;
    } else {
      progress.streak = 1;
    }
    progress.lastDate = today;
    saveProgress(progress);
  }
}

// Cache for findWordZh to avoid repeated scans
let wordZhMap = null;
function findWordZh(en) {
  if (!wordZhMap) {
    wordZhMap = {};
    getAllWords().forEach(w => { wordZhMap[w.en.toLowerCase()] = w.zh; });
  }
  return wordZhMap[en.toLowerCase()] || '';
}

// ===== Speech (Smart Voice Selection + Double Read) =====
let preferredVoice = null;
let voicesLoaded = false;
let speechSessionId = 0; // Track speech sessions to prevent ghost utterances

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
  voicesLoaded = true;
}

if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

function speakWord(word) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const sessionId = ++speechSessionId;

    // First read: normal speed, clear
    const u1 = new SpeechSynthesisUtterance(word);
    u1.lang = 'en-US';
    u1.rate = 0.8;
    u1.pitch = 1.0;
    u1.volume = 1.0;
    if (preferredVoice) u1.voice = preferredVoice;

    // Second read: slower, after a pause
    const u2 = new SpeechSynthesisUtterance(word);
    u2.lang = 'en-US';
    u2.rate = 0.55;
    u2.pitch = 1.0;
    u2.volume = 1.0;
    if (preferredVoice) u2.voice = preferredVoice;

    u1.onend = () => {
      // Only queue second read if this is still the current session
      if (speechSessionId === sessionId) {
        setTimeout(() => {
          if (speechSessionId === sessionId) {
            window.speechSynthesis.speak(u2);
          }
        }, 500);
      }
    };
    u1.onerror = () => {}; // Silently handle speech errors

    window.speechSynthesis.speak(u1);
  } catch (e) { /* ignore speech errors */ }
}

// ===== Navigation =====
let currentPage = 'home';
let navHistory = ['home'];

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  currentPage = page;

  // Track navigation history
  if (navHistory[navHistory.length - 1] !== page) {
    navHistory.push(page);
  }

  // Update bottom nav - keep home highlighted for sub-pages like category
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  let navPage = page;
  if (page === 'category' || page === 'spelling') navPage = 'home'; // Sub-pages: highlight home
  const navItem = document.querySelector(`.nav-item[data-page="${navPage}"]`);
  if (navItem) navItem.classList.add('active');

  if (page === 'home') refreshHome();
  if (page === 'progress') refreshProgressPage();

  window.scrollTo(0, 0);
}

function goBack() {
  navHistory.pop(); // Remove current
  const prev = navHistory[navHistory.length - 1] || 'home';
  navigateTo(prev);
}

// ===== Sound Effects =====
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  try {
    const ctx = getAudioCtx();
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
  } catch (e) { /* ignore audio errors */ }
}

// ===== Confetti =====
const confettiCanvas = document.getElementById('confetti-canvas');
const confettiCtx = confettiCanvas.getContext('2d');
let confettiPieces = [];
let confettiAnimating = false;

function resizeConfetti() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeConfetti);
resizeConfetti();

function launchConfetti() {
  confettiPieces = [];
  const colors = ['#6C63FF', '#FF6584', '#43E97B', '#FFB347', '#A78BFA', '#F093FB', '#38F9D7'];
  for (let i = 0; i < 60; i++) {
    confettiPieces.push({
      x: Math.random() * confettiCanvas.width,
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
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiPieces = confettiPieces.filter(p => p.y < confettiCanvas.height + 20);
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
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

// ===== Star Rendering Helper =====
function renderStars(count, total) {
  let html = '';
  for (let i = 0; i < total; i++) {
    if (i < count) {
      html += `<svg width="32" height="32" viewBox="0 0 24 24" class="star-filled"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#FBBF24" stroke="#FBBF24" stroke-width="2"/></svg>`;
    } else {
      html += `<svg width="32" height="32" viewBox="0 0 24 24" class="star-empty"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="none" stroke="#D1D5DB" stroke-width="2"/></svg>`;
    }
  }
  return html;
}

// ===== Result Icon Helper =====
function resultIconClass(pct) {
  return pct >= 90 ? 'icon-success' : pct >= 70 ? 'icon-good' : 'icon-encourage';
}
function resultIconName(pct) {
  return pct >= 90 ? 'trophy' : pct >= 70 ? 'thumbs-up' : 'book-open';
}

// ===== Home Page =====
function refreshHome() {
  const progress = getProgress();
  updateStreak();

  const all = getAllWords();
  const learned = all.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new').length;
  const mastered = all.filter(w => progress.words[w.en] && progress.words[w.en].status === 'mastered').length;

  document.getElementById('progress-text').textContent = `${learned} / 850`;
  document.getElementById('progress-fill').style.width = `${(learned / 850) * 100}%`;
  document.getElementById('stat-stars').textContent = progress.stars;
  document.getElementById('stat-learned').textContent = learned;
  document.getElementById('stat-mastered').textContent = mastered;
  document.getElementById('streak-count').textContent = progress.streak;

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
      </div>
      <div class="cat-info">
        <div class="cat-name">${cat.nameZh} <span style="color:var(--text-lighter);font-weight:600;font-size:0.8rem;">· ${cat.name}</span></div>
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

// ===== Category Page =====
function openCategory(categoryId) {
  const cat = WORD_DATA.categories.find(c => c.id === categoryId);
  if (!cat) return;

  document.getElementById('category-title').textContent = cat.nameZh;
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
  const statusText = status === 'mastered' ? '已掌握' : status === 'learning' ? '学习中' : '未学习';

  const overlay = document.createElement('div');
  overlay.className = 'word-popup-overlay';
  overlay.innerHTML = `
    <div class="word-popup">
      <div class="wp-en">${word.en} <button class="wp-speak" title="朗读">${icon('volume-2', 18)}</button></div>
      <div class="wp-zh">${word.zh}</div>
      <div class="wp-status">${icon(statusIcon, 14)} ${word.categoryName} · ${statusText}</div>
      <button class="wp-close">关闭</button>
    </div>
  `;
  overlay.querySelector('.wp-speak').addEventListener('click', (e) => {
    e.stopPropagation();
    speakWord(word.en);
  });
  overlay.querySelector('.wp-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  refreshIcons();
  speakWord(word.en);
}

// ===== Flashcard Mode =====
let fcWords = [];
let fcIndex = 0;
let fcFlipped = false;
let fcLocked = false; // FIX #9: Prevent rapid button clicking

function getWordsForMode(category, count) {
  let words;
  if (category === 'all') {
    words = getAllWords();
  } else if (category === 'new') {
    const progress = getProgress();
    words = getAllWords().filter(w => !progress.words[w.en] || progress.words[w.en].status === 'new');
    if (words.length === 0) words = getAllWords();
  } else {
    words = getWordsByCategory(category);
  }
  return shuffle(words).slice(0, Math.min(count, words.length));
}

function initFlashcard() {
  const category = document.getElementById('fc-category').value;
  const count = parseInt(document.getElementById('fc-count').value);
  fcWords = getWordsForMode(category, count);
  // FIX #4: Guard against empty word list
  if (fcWords.length === 0) {
    alert('没有可用的单词！');
    navigateTo('home');
    return;
  }
  fcIndex = 0;
  fcFlipped = false;
  fcLocked = false;
  showFlashcard();
}

function showFlashcard() {
  if (fcIndex >= fcWords.length) {
    playSound('victory');
    launchConfetti();
    addStars(Math.ceil(fcWords.length / 2));
    alert(`卡片翻完啦！获得 ${Math.ceil(fcWords.length / 2)} 颗星星！`);
    navigateTo('home');
    return;
  }

  const word = fcWords[fcIndex];
  document.getElementById('flashcard-en').textContent = word.en;
  document.getElementById('flashcard-zh').textContent = word.zh;
  document.getElementById('flashcard-cat').textContent = word.categoryName;
  document.getElementById('flashcard-counter').textContent = `${fcIndex + 1}/${fcWords.length}`;

  fcFlipped = false;
  fcLocked = false; // Unlock for next card
  document.getElementById('flashcard').classList.remove('flipped');
  // FIX #27: Show/hide yes/no based on flip state
  document.querySelector('.flashcard-controls').style.opacity = '0.4';
  document.querySelector('.flashcard-controls').style.pointerEvents = 'none';
  speakWord(word.en);
}

document.getElementById('flashcard-container').addEventListener('click', () => {
  fcFlipped = !fcFlipped;
  document.getElementById('flashcard').classList.toggle('flipped');
  playSound('flip');
  // FIX #27: Enable yes/no buttons only after flipping
  if (fcFlipped) {
    document.querySelector('.flashcard-controls').style.opacity = '1';
    document.querySelector('.flashcard-controls').style.pointerEvents = 'auto';
  }
});

document.getElementById('fc-no').addEventListener('click', () => {
  // FIX #9: Lock to prevent rapid clicking
  if (fcLocked) return;
  fcLocked = true;
  if (fcIndex < fcWords.length) {
    // FIX #1: Use updateWordStatus for flashcard - "don't know" means keep/put as new
    recordAnswer(fcWords[fcIndex].en, false);
    updateWordStatus(fcWords[fcIndex].en, 'new');
    playSound('wrong');
  }
  fcIndex++;
  showFlashcard();
});

document.getElementById('fc-yes').addEventListener('click', () => {
  // FIX #9: Lock to prevent rapid clicking
  if (fcLocked) return;
  fcLocked = true;
  if (fcIndex < fcWords.length) {
    // FIX #1: Use updateWordStatus - "know" promotes to learning/mastered
    recordAnswer(fcWords[fcIndex].en, true);
    const progress = getProgress();
    const wordStatus = progress.words[fcWords[fcIndex].en];
    if (wordStatus && wordStatus.correct >= 4) {
      updateWordStatus(fcWords[fcIndex].en, 'mastered');
    } else {
      updateWordStatus(fcWords[fcIndex].en, 'learning');
    }
    playSound('correct');
  }
  fcIndex++;
  showFlashcard();
});

document.getElementById('fc-category').addEventListener('change', initFlashcard);
document.getElementById('fc-count').addEventListener('change', initFlashcard);

// ===== Quiz Mode =====
let quizWords = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;

function initQuiz() {
  const category = document.getElementById('quiz-category').value;
  const count = parseInt(document.getElementById('quiz-count').value);
  quizWords = getWordsForMode(category, count);
  // FIX #4: Guard against empty word list
  if (quizWords.length === 0) {
    alert('没有可用的单词！');
    navigateTo('home');
    return;
  }
  quizIndex = 0;
  quizScore = 0;
  document.getElementById('quiz-score').textContent = '0';
  document.getElementById('quiz-area').style.display = '';
  document.getElementById('quiz-result').style.display = 'none';
  showQuizQuestion();
}

// FIX #3: Helper to get unique Chinese options for quiz
function getUniqueZhOptions(correctWord, count) {
  const correctZh = correctWord.zh;
  const allWords = getAllWords().filter(w => w.en !== correctWord.en && w.zh !== correctZh);
  const shuffled = shuffle(allWords);
  return shuffled.slice(0, count).map(w => w.zh);
}

function showQuizQuestion() {
  if (quizIndex >= quizWords.length) {
    showQuizResult();
    return;
  }

  quizAnswered = false;
  const word = quizWords[quizIndex];
  const isEnToZh = Math.random() > 0.3;

  document.getElementById('quiz-progress-fill').style.width = `${(quizIndex / quizWords.length) * 100}%`;

  if (isEnToZh) {
    // FIX #2: No inline onclick - use a data attribute + event delegation
    document.getElementById('quiz-prompt').innerHTML = `<span class="quiz-speak-btn" data-word="${word.en}" style="font-size:2.2rem;cursor:pointer;display:inline-flex;align-items:center;gap:8px;">${word.en} ${icon('volume-2', 20)}</span><br><span style="font-size:0.9rem;color:#636E72;">这个单词的意思是？</span>`;
    speakWord(word.en);
    // FIX #3: Use deduplicated zh options
    const wrongOptions = getUniqueZhOptions(word, 3);
    const options = shuffle([word.zh, ...wrongOptions]);
    renderQuizOptions(options, word.zh, word.en);
  } else {
    document.getElementById('quiz-prompt').innerHTML = `<span style="font-size:2.2rem;">${word.zh}</span><br><span style="font-size:0.9rem;color:#636E72;">对应的英文是？</span>`;
    const wrongOptions = getRandomWords(3, [word.en]).map(w => w.en);
    const options = shuffle([word.en, ...wrongOptions]);
    renderQuizOptions(options, word.en, word.zh);
  }
  refreshIcons();
}

// FIX #2: Event delegation for quiz speak buttons
document.addEventListener('click', (e) => {
  const speakBtn = e.target.closest('.quiz-speak-btn');
  if (speakBtn) {
    speakWord(speakBtn.dataset.word);
  }
});

function renderQuizOptions(options, correctAnswer, wordEn) {
  const container = document.getElementById('quiz-options');
  container.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option';
    btn.textContent = opt;
    btn.addEventListener('click', () => {
      if (quizAnswered) return;
      quizAnswered = true;

      const isCorrect = opt === correctAnswer;
      if (isCorrect) {
        btn.classList.add('correct');
        quizScore++;
        document.getElementById('quiz-score').textContent = quizScore;
        playSound('correct');
        recordAnswer(wordEn, true);
      } else {
        btn.classList.add('wrong');
        container.querySelectorAll('.quiz-option').forEach(b => {
          if (b.textContent === correctAnswer) b.classList.add('correct');
        });
        playSound('wrong');
        recordAnswer(wordEn, false);
      }

      setTimeout(() => {
        quizIndex++;
        showQuizQuestion();
      }, 1000);
    });
    container.appendChild(btn);
  });
}

function showQuizResult() {
  document.getElementById('quiz-area').style.display = 'none';
  document.getElementById('quiz-result').style.display = '';
  document.getElementById('quiz-progress-fill').style.width = '100%';

  // FIX #4: Prevent division by zero
  const total = quizWords.length || 1;
  const pct = Math.round((quizScore / total) * 100);
  const stars = pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0;

  const resultIconEl = document.getElementById('result-icon');
  resultIconEl.className = `result-icon ${resultIconClass(pct)}`;
  resultIconEl.innerHTML = icon(resultIconName(pct), 40);

  document.getElementById('result-title').textContent = pct >= 90 ? '太棒了！' : pct >= 70 ? '不错哦！' : pct >= 50 ? '继续加油！' : '多练习一下吧！';
  document.getElementById('result-detail').textContent = `答对 ${quizScore}/${quizWords.length} 题（${pct}%）`;
  document.getElementById('result-stars').innerHTML = renderStars(stars, 3);

  addStars(stars);
  if (pct >= 70) launchConfetti();
  playSound(pct >= 70 ? 'victory' : 'wrong');
  refreshIcons();
}

document.getElementById('quiz-retry').addEventListener('click', initQuiz);
document.getElementById('quiz-category').addEventListener('change', initQuiz);
document.getElementById('quiz-count').addEventListener('change', initQuiz);

// ===== Spelling Mode =====
let spellingWords = [];
let spellingIndex = 0;
let spellingScore = 0;
let spellingAnswered = false;
let spellingHintUsed = false;
let spellingHintLevel = 0;

function initSpelling() {
  const category = document.getElementById('spelling-category').value;
  const count = parseInt(document.getElementById('spelling-count').value);
  spellingWords = getWordsForMode(category, count);
  // FIX #4: Guard against empty word list
  if (spellingWords.length === 0) {
    alert('没有可用的单词！');
    navigateTo('home');
    return;
  }
  spellingIndex = 0;
  spellingScore = 0;
  document.getElementById('spelling-score').textContent = '0';
  document.getElementById('spelling-area').style.display = '';
  document.getElementById('spelling-result').style.display = 'none';
  const feedback = document.getElementById('spelling-feedback');
  if (feedback) feedback.dataset.attempts = '0';
  showSpellingQuestion();
}

function showSpellingQuestion() {
  if (spellingIndex >= spellingWords.length) {
    showSpellingResult();
    return;
  }

  spellingAnswered = false;
  spellingHintUsed = false;
  spellingHintLevel = 0;

  const word = spellingWords[spellingIndex];
  document.getElementById('spelling-progress-fill').style.width = `${(spellingIndex / spellingWords.length) * 100}%`;
  document.getElementById('spelling-prompt').textContent = word.zh;
  document.getElementById('spelling-hint-text').textContent = '';
  document.getElementById('spelling-feedback').textContent = '';
  document.getElementById('spelling-feedback').className = 'spelling-feedback';
  // FIX #6: Re-enable input and submit
  const input = document.getElementById('spelling-input');
  input.value = '';
  input.disabled = false;
  document.getElementById('spelling-submit').disabled = false;
  input.focus();
  const feedback = document.getElementById('spelling-feedback');
  feedback.dataset.attempts = '0';
}

function checkSpelling() {
  if (spellingAnswered) return;

  const word = spellingWords[spellingIndex];
  const input = document.getElementById('spelling-input').value.trim().toLowerCase();
  const correct = word.en.toLowerCase();

  if (input === correct) {
    spellingAnswered = true;
    spellingScore++;
    document.getElementById('spelling-score').textContent = spellingScore;
    document.getElementById('spelling-feedback').innerHTML = `${icon('circle-check', 16)} 正确！`;
    document.getElementById('spelling-feedback').className = 'spelling-feedback correct';
    playSound('correct');
    recordAnswer(word.en, true);
    speakWord(word.en);
    // FIX #6: Disable input after correct answer
    document.getElementById('spelling-input').disabled = true;
    document.getElementById('spelling-submit').disabled = true;

    setTimeout(() => {
      spellingIndex++;
      showSpellingQuestion();
    }, 1200);
  } else {
    document.getElementById('spelling-feedback').innerHTML = `${icon('circle-x', 16)} 再试一次`;
    document.getElementById('spelling-feedback').className = 'spelling-feedback wrong';
    playSound('wrong');

    if (!spellingAnswered) {
      const feedback = document.getElementById('spelling-feedback');
      if (feedback.dataset.attempts === undefined) feedback.dataset.attempts = '0';
      feedback.dataset.attempts = String(parseInt(feedback.dataset.attempts) + 1);

      if (parseInt(feedback.dataset.attempts) >= 2) {
        spellingAnswered = true;
        recordAnswer(word.en, false);
        feedback.innerHTML = `正确答案：<strong>${word.en}</strong>`;
        // FIX #6: Disable input after max attempts
        document.getElementById('spelling-input').disabled = true;
        document.getElementById('spelling-submit').disabled = true;
        setTimeout(() => {
          feedback.dataset.attempts = '0';
          spellingIndex++;
          showSpellingQuestion();
        }, 2000);
      }
    }
  }
  refreshIcons();
}

document.getElementById('spelling-submit').addEventListener('click', checkSpelling);
document.getElementById('spelling-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') checkSpelling();
});

document.getElementById('spelling-hint-btn').addEventListener('click', () => {
  // FIX #5: Don't allow hints after question is answered
  if (spellingAnswered) return;
  const word = spellingWords[spellingIndex];
  if (!word) return;
  spellingHintUsed = true;
  spellingHintLevel++;

  const en = word.en;
  if (spellingHintLevel === 1) {
    document.getElementById('spelling-hint-text').textContent = `${en[0]}___ (${en.length}个字母)`;
  } else if (spellingHintLevel === 2) {
    const revealed = en.split('').map((c, i) => i < Math.ceil(en.length * 0.5) ? c : '_').join('');
    document.getElementById('spelling-hint-text').textContent = revealed;
  } else if (spellingHintLevel === 3) {
    const revealed = en.split('').map((c, i) => i < en.length - 1 ? c : '_').join('');
    document.getElementById('spelling-hint-text').textContent = revealed;
  }
  // FIX #36: After max hints, disable button visually
  if (spellingHintLevel >= 3) {
    document.getElementById('spelling-hint-btn').style.opacity = '0.5';
    document.getElementById('spelling-hint-btn').style.pointerEvents = 'none';
  }
});

function showSpellingResult() {
  document.getElementById('spelling-area').style.display = 'none';
  document.getElementById('spelling-result').style.display = '';

  // FIX #4: Prevent division by zero
  const total = spellingWords.length || 1;
  const pct = Math.round((spellingScore / total) * 100);
  const stars = pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0;

  const resultIconEl = document.getElementById('spelling-result-icon');
  resultIconEl.className = `result-icon ${resultIconClass(pct)}`;
  resultIconEl.innerHTML = icon(resultIconName(pct), 40);

  document.getElementById('spelling-result-title').textContent = pct >= 90 ? '拼写高手！' : pct >= 70 ? '不错哦！' : pct >= 50 ? '继续练习！' : '多写几遍吧！';
  document.getElementById('spelling-result-detail').textContent = `正确 ${spellingScore}/${spellingWords.length}（${pct}%）`;
  document.getElementById('spelling-result-stars').innerHTML = renderStars(stars, 3);

  addStars(stars);
  if (pct >= 70) launchConfetti();
  playSound(pct >= 70 ? 'victory' : 'wrong');
  refreshIcons();
}

document.getElementById('spelling-retry').addEventListener('click', initSpelling);
document.getElementById('spelling-category').addEventListener('change', initSpelling);
document.getElementById('spelling-count').addEventListener('change', initSpelling);

// ===== Memory Match Game =====
let memCards = [];
let memFlipped = [];
let memMatched = 0;
let memTotal = 0;
let memMoves = 0;
let memLocked = false;

function initMemory() {
  const pairsCount = parseInt(document.getElementById('memory-pairs-count').value);
  memTotal = pairsCount;
  memMatched = 0;
  memMoves = 0;
  memLocked = false;
  memFlipped = [];

  document.getElementById('memory-moves').textContent = '0';
  document.getElementById('memory-pairs').textContent = '0';
  document.getElementById('memory-total').textContent = pairsCount;
  document.getElementById('memory-result').style.display = 'none';

  const words = shuffle(getAllWords()).slice(0, pairsCount);

  memCards = [];
  words.forEach((w, i) => {
    memCards.push({ id: i, type: 'en', text: w.en, pairId: i, word: w });
    memCards.push({ id: i, type: 'zh', text: w.zh, pairId: i, word: w });
  });
  memCards = shuffle(memCards);

  const board = document.getElementById('memory-board');
  // FIX #17: Always use 4 columns for even grid
  board.className = 'memory-board cols-4';
  board.innerHTML = '';

  memCards.forEach((card, index) => {
    const el = document.createElement('div');
    el.className = 'memory-card';
    el.dataset.index = index;
    el.innerHTML = `
      <div class="memory-card-inner">
        <div class="memory-card-face memory-card-front">${icon('help-circle', 28)}</div>
        <div class="memory-card-face memory-card-back">
          <span class="mem-en">${card.type === 'en' ? card.text : ''}</span>
          <span class="mem-zh">${card.type === 'zh' ? card.text : ''}</span>
        </div>
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
        memMatched++;
        document.getElementById('memory-pairs').textContent = memMatched;
        recordAnswer(card1.word.en, true);
        memFlipped = [];
        memLocked = false;
        if (memMatched === memTotal) {
          setTimeout(showMemoryResult, 500);
        }
      }, 400);
    } else {
      // FIX #7: Record wrong answer for mismatched pairs
      setTimeout(() => {
        document.querySelector(`.memory-card[data-index="${i1}"]`).classList.remove('flipped');
        document.querySelector(`.memory-card[data-index="${i2}"]`).classList.remove('flipped');
        recordAnswer(card1.word.en, false);
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

  // FIX #28: Use result icon class based on performance
  const efficiency = memTotal / memMoves; // 1.0 = perfect, lower = worse
  const pct = Math.min(100, Math.round(efficiency * 100));
  const resultIconEl = document.getElementById('memory-result-icon');
  resultIconEl.className = `result-icon ${resultIconClass(pct)}`;
  resultIconEl.innerHTML = icon(resultIconName(pct), 40);

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

// ===== Progress Page =====
function refreshProgressPage() {
  const progress = getProgress();
  const all = getAllWords();
  const learned = all.filter(w => progress.words[w.en] && progress.words[w.en].status !== 'new').length;
  const mastered = all.filter(w => progress.words[w.en] && progress.words[w.en].status === 'mastered').length;

  document.getElementById('pg-total-learned').textContent = learned;
  document.getElementById('pg-total-mastered').textContent = mastered;
  document.getElementById('pg-total-stars').textContent = progress.stars;
  document.getElementById('pg-streak').textContent = progress.streak;

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
        <div class="cat-prog-name">${cat.nameZh}</div>
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
    recentEl.innerHTML = '<span style="color:var(--text-lighter);font-size:0.85rem;">还没有学过单词哦，开始学习吧！</span>';
  }
  refreshIcons();
}

// Reset progress
document.getElementById('reset-btn').addEventListener('click', () => {
  if (confirm('确定要重置所有学习进度吗？这将清除所有记录！')) {
    localStorage.removeItem(STORAGE_KEY);
    refreshProgressPage();
    refreshHome();
  }
});

// ===== Navigation Events =====
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    navigateTo(page);
    if (page === 'flashcard' && fcWords.length === 0) initFlashcard();
    if (page === 'quiz' && quizWords.length === 0) initQuiz();
    if (page === 'memory' && memCards.length === 0) initMemory();
    if (page === 'spelling' && spellingWords.length === 0) initSpelling();
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

// FIX #32: Use navigation history for back buttons
document.querySelectorAll('.back-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    goBack();
  });
});

// ===== Initialize =====
updateStreak();
refreshHome();
refreshIcons();

// Auto-save daily
setInterval(() => {
  updateStreak();
}, 60000);
