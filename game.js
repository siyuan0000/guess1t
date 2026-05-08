/**
 * guess1t — Semantic Word Guessing Game
 * Client-side game logic with pre-computed word embeddings.
 * v1.1: give-up, try-again, out-of-pool guesses
 */
(function () {
  const MAX_GUESSES = 10;
  const STORAGE_KEY = 'guess1t_state';
  const ONBOARDING_KEY = 'guess1t_onboarded';

  let state = { date: todayStr(), guesses: [], result: null };
  let embData = null;   // { words, dim, vectors }
  let wordPool = null;  // [{ word, definition }]
  let targetWord = null;
  let targetDef = null;
  let wordSet = null;   // Set<string> embedded vocabulary
  let wordIdx = null;   // Map<string, number> word→vector index
  let isPractice = false;
  let practiceUsed = []; // words already used in practice this session

  // DOM refs
  const $ = id => document.getElementById(id);
  const $loading    = $('loading');
  const $gameArea   = $('game-area');
  const $guessList  = $('guess-list');
  const $guessForm  = $('guess-form');
  const $guessInput = $('guess-input');
  const $submitBtn  = $('submit-btn');
  const $errorMsg   = $('error-msg');
  const $remaining  = $('guesses-remaining');
  const $giveupBtn  = $('giveup-btn');
  const $modeLabel  = $('mode-label');

  let giveupTimer = null; // confirmation timeout

  // ── Init ──
  document.addEventListener('DOMContentLoaded', async () => {
    // Onboarding
    if (!localStorage.getItem(ONBOARDING_KEY)) {
      $('onboarding-overlay').classList.remove('hidden');
    }
    $('onboarding-dismiss').addEventListener('click', () => {
      $('onboarding-overlay').classList.add('hidden');
      localStorage.setItem(ONBOARDING_KEY, '1');
      $guessInput.focus();
    });
    $('result-dismiss').addEventListener('click', () => {
      $('result-overlay').classList.add('hidden');
    });
    $('result-tryagain').addEventListener('click', startPractice);

    // Load data in parallel
    const [pool, emb] = await Promise.all([
      fetch('data/words.json').then(r => r.json()),
      fetch('data/embeddings_web.json').then(r => r.json()),
    ]);
    wordPool = pool;
    embData = emb;
    wordSet = new Set(emb.words);
    wordIdx = new Map(emb.words.map((w, i) => [w, i]));

    // Daily word
    pickDailyWord();

    // Restore state
    loadState();

    // Render
    $loading.classList.add('hidden');
    $gameArea.classList.remove('hidden');
    renderGuesses();
    updateCounter();
    updateGiveupVisibility();

    if (state.result) {
      disableInput();
      setTimeout(() => showResult(state.result), 300);
    } else {
      $guessInput.focus();
    }

    $guessForm.addEventListener('submit', handleGuess);
    $giveupBtn.addEventListener('click', handleGiveup);
  });

  function pickDailyWord() {
    const idx = hashDate(todayStr()) % wordPool.length;
    targetWord = wordPool[idx].word.toLowerCase();
    targetDef = wordPool[idx].definition;
  }

  // ── Guess Handler ──
  function handleGuess(e) {
    e.preventDefault();
    clearError();
    const raw = $guessInput.value.trim().toLowerCase();
    if (!raw) return;

    // Duplicate check
    if (state.guesses.some(g => g.word === raw)) return showError('Already guessed.');

    // Validation: accept embedded words OR any alphabetic ≥3 chars
    const inVocab = wordSet.has(raw);
    if (!inVocab && !isValidFallback(raw)) return showError('Not a recognized word.');

    // Check win (exact string match, before score)
    const isWin = raw === targetWord;

    // Compute similarity (null if not in embedding set)
    const score = inVocab ? cosineSim(raw, targetWord) : null;

    state.guesses.push({ word: raw, score });
    $guessInput.value = '';
    renderGuesses();
    updateCounter();

    if (isWin) {
      state.result = 'win';
      saveState();
      disableInput();
      updateGiveupVisibility();
      return setTimeout(() => showResult('win'), 400);
    }
    if (state.guesses.length >= MAX_GUESSES) {
      state.result = 'lose';
      saveState();
      disableInput();
      updateGiveupVisibility();
      return setTimeout(() => showResult('lose'), 400);
    }

    saveState();
    $guessInput.focus();
  }

  // ── Give Up ──
  function handleGiveup() {
    if (giveupTimer) {
      // Second click = confirmed
      clearTimeout(giveupTimer);
      giveupTimer = null;
      state.result = 'lose';
      saveState();
      disableInput();
      updateGiveupVisibility();
      showResult('lose');
    } else {
      // First click = ask confirmation
      $giveupBtn.textContent = 'Are you sure?';
      $giveupBtn.classList.add('confirming');
      giveupTimer = setTimeout(() => {
        $giveupBtn.textContent = 'I give up';
        $giveupBtn.classList.remove('confirming');
        giveupTimer = null;
      }, 3000);
    }
  }

  function updateGiveupVisibility() {
    $giveupBtn.classList.toggle('hidden', !!state.result);
    // Reset confirmation state
    $giveupBtn.textContent = 'I give up';
    $giveupBtn.classList.remove('confirming');
    if (giveupTimer) { clearTimeout(giveupTimer); giveupTimer = null; }
  }

  // ── Try Again (Practice Mode) ──
  function startPractice() {
    $('result-overlay').classList.add('hidden');
    isPractice = true;

    // Pick a random word, excluding daily + previously used
    const dailyIdx = hashDate(todayStr()) % wordPool.length;
    const excluded = new Set([wordPool[dailyIdx].word.toLowerCase(), ...practiceUsed]);
    const available = wordPool.filter(w => !excluded.has(w.word.toLowerCase()));

    if (available.length === 0) {
      showError('No more words available!');
      return;
    }

    const pick = available[Math.floor(Math.random() * available.length)];
    targetWord = pick.word.toLowerCase();
    targetDef = pick.definition;
    practiceUsed.push(targetWord);

    // Reset game state (not persisted)
    state = { date: todayStr(), guesses: [], result: null };

    // Update UI
    $modeLabel.classList.remove('hidden');
    $guessInput.disabled = false;
    $submitBtn.disabled = false;
    $guessList.innerHTML = '';
    renderGuesses();
    updateCounter();
    $remaining.style.color = '';
    updateGiveupVisibility();
    $guessInput.focus();
  }

  // ── Validation ──
  function isValidFallback(word) {
    return word.length >= 3 && /^[a-z]+$/.test(word);
  }

  // ── Cosine Similarity ──
  function cosineSim(a, b) {
    const iA = wordIdx.get(a), iB = wordIdx.get(b);
    if (iA === undefined || iB === undefined) return null;
    const vA = embData.vectors[iA], vB = embData.vectors[iB];
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < embData.dim; i++) {
      dot += vA[i] * vB[i];
      nA  += vA[i] * vA[i];
      nB  += vB[i] * vB[i];
    }
    const s = dot / (Math.sqrt(nA) * Math.sqrt(nB));
    return Math.round(Math.max(0, Math.min(1, s)) * 100) / 100;
  }

  // ── Rendering ──
  function renderGuesses() {
    $guessList.innerHTML = '';
    for (const g of state.guesses) {
      const row = document.createElement('div');
      const scored = g.score !== null;
      row.className = 'guess-row' + (scored ? '' : ' unscored');
      const scoreText = scored ? g.score.toFixed(2) : '—';
      let html = `<span class="guess-word">${esc(g.word)}</span><span class="guess-score">${scoreText}</span>`;
      if (!scored) html += `<span class="guess-note">not in semantic database</span>`;
      row.innerHTML = html;
      $guessList.appendChild(row);
    }
    $guessList.scrollTop = $guessList.scrollHeight;
  }

  function updateCounter() {
    const left = MAX_GUESSES - state.guesses.length;
    $remaining.textContent = left;
    $remaining.style.color = left <= 3 ? 'var(--error)' : '';
  }

  function showResult(type) {
    const icon = $('result-icon');
    const title = $('result-title');
    const word = $('result-word');
    const def = $('result-definition');
    const stats = $('result-stats');

    if (type === 'win') {
      icon.textContent = '✦';
      title.textContent = 'You got it!';
      stats.textContent = `Found in ${state.guesses.length} / ${MAX_GUESSES} guesses`;
    } else {
      icon.textContent = '—';
      title.textContent = 'Not this time';
      stats.textContent = isPractice ? 'Practice round' : `Daily — ${todayStr()}`;
    }
    word.textContent = targetWord;
    def.textContent = `"${targetDef}"`;
    $('result-overlay').classList.remove('hidden');
  }

  function disableInput() {
    $guessInput.disabled = true;
    $submitBtn.disabled = true;
  }

  function showError(msg) {
    $errorMsg.textContent = msg;
    $errorMsg.classList.remove('hidden');
  }
  function clearError() { $errorMsg.classList.add('hidden'); }

  // ── Persistence (daily only) ──
  function saveState() {
    if (!isPractice) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && s.date === todayStr()) state = s;
      else resetState();
    } catch { resetState(); }
  }
  function resetState() {
    state = { date: todayStr(), guesses: [], result: null };
    saveState();
  }

  // ── Utilities ──
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function hashDate(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
})();
