
/**
 * guess1t — Semantic Word Guessing Game
 * Client-side game logic with pre-computed word embeddings.
 * v1.1: give-up, try-again, out-of-pool guesses
 */
(function () {
  const MAX_GUESSES = 5;
  const STORAGE_KEY = 'guess1t_state';
  const ONBOARDING_KEY = 'guess1t_onboarded';

  let state = { date: todayStr(), guesses: [], result: null };
  let embData = null;   // { words, dim, vectors }
  let wordPool = null;  // [{ word, definition, pos }]
  let poolSet = null;   // Set<string> target word pool
  let poolInfo = null;  // Map<string, { definition: string, pos: string }>
  let targetWord = null;
  let targetDef = null;
  let targetPos = null;
  let wordSet = null;   // Set<string> embedded vocabulary
  let wordIdx = null;   // Map<string, number> word→vector index
  let isPractice = false;
  let practiceUsed = []; // words already used in practice this session
  let fallbackVec = null; // centroid vector for OOV word scoring

  // DOM refs
  const $ = id => document.getElementById(id);
  const $loading = $('loading');
  const $gameArea = $('game-area');
  const $guessList = $('guess-list');
  const $guessForm = $('guess-form');
  const $guessInput = $('guess-input');
  const $submitBtn = $('submit-btn');
  const $errorMsg = $('error-msg');
  const $remaining = $('guesses-remaining');
  const $giveupBtn = $('giveup-btn');
  const $tryAgainBtn = $('tryagain-btn');
  const $modeLabel = $('mode-label');
  let $guessTooltip = null;

  let giveupTimer = null; // confirmation timeout
  let poolCandidates = []; // 15 random same-POS words shown to the player

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
    $tryAgainBtn.addEventListener('click', startPractice);

    // Load data in parallel
    const [pool, emb] = await Promise.all([
      fetch('data/words.json').then(r => r.json()),
      fetch('data/embeddings_web.json').then(r => r.json()),
    ]);
    wordPool = pool;
    poolSet = new Set(pool.map(w => w.word.toLowerCase()));
    poolInfo = new Map(pool.map(w => [w.word.toLowerCase(), { definition: w.definition, pos: w.pos || '' }]));
    embData = emb;
    wordSet = new Set(emb.words);
    wordIdx = new Map(emb.words.map((w, i) => [w, i]));
    fallbackVec = computeCentroid();

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
    updateHintBar();

    if (state.result) {
      disableInput();
      setTimeout(() => showResult(state.result), 300);
    } else {
      $guessInput.focus();
    }

    $guessForm.addEventListener('submit', handleGuess);
    $giveupBtn.addEventListener('click', handleGiveup);
    $guessList.addEventListener('scroll', hideGuessTooltip);

    // Word pool modal
    $('pool-btn').addEventListener('click', openPoolModal);
    $('pool-close').addEventListener('click', () => $('pool-overlay').classList.add('hidden'));
    $('pool-overlay').addEventListener('click', e => {
      if (e.target === $('pool-overlay')) $('pool-overlay').classList.add('hidden');
    });

    $guessTooltip = document.createElement('div');
    $guessTooltip.id = 'guess-tooltip';
    $guessTooltip.className = 'hidden';
    document.body.appendChild($guessTooltip);
  });

  function pickDailyWord() {
    const idx = hashDate(todayStr()) % wordPool.length;
    targetWord = wordPool[idx].word.toLowerCase();
    targetDef = wordPool[idx].definition;
    targetPos = wordPool[idx].pos || 'unknown';
    poolCandidates = pickPoolCandidates();
    console.log(`[guess1t] TODAY'S WORD: "${targetWord}" (${targetPos}) — ${targetDef}`);
  }

  function pickPoolCandidates() {
    const guessed = new Set(state.guesses.map(g => g.word));
    // Get all same-POS words except target and already-guessed
    const samePos = wordPool.filter(w =>
      (w.pos || '') === targetPos &&
      w.word.toLowerCase() !== targetWord &&
      !guessed.has(w.word.toLowerCase())
    );
    // Shuffle and pick up to 14
    for (let i = samePos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [samePos[i], samePos[j]] = [samePos[j], samePos[i]];
    }
    const chosen = samePos.slice(0, 14);
    // Always include the target word
    chosen.push(wordPool.find(w => w.word.toLowerCase() === targetWord));
    // Shuffle again so target isn't always last
    for (let i = chosen.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
    }
    return chosen;
  }

  // ── Guess Handler ──
  function handleGuess(e) {
    e.preventDefault();
    clearError();
    const raw = $guessInput.value.trim().toLowerCase();
    if (!raw) return;

    // Duplicate check
    if (state.guesses.some(g => g.word === raw)) return showError('Already guessed.');

    // Check win (exact string match, before score)
    const isWin = raw === targetWord;

    let score = null;
    const inVocab = wordSet.has(raw);

    if (inVocab) {
      score = cosineSim(raw, targetWord);
    } else {
      if (!isValidFallback(raw)) return showError('Not a valid guess.');
      score = cosineSimWithVec(raw, targetWord);
    }

    state.guesses.push({ word: raw, score });
    $guessInput.value = '';
    renderGuesses();
    updateCounter();
    console.log(`[guess1t] guess="${raw}" target="${targetWord}" score=${score} inPool=${poolSet.has(raw)}`);

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
    $tryAgainBtn.classList.toggle('hidden', !state.result);
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
    targetPos = pick.pos || 'unknown';
    practiceUsed.push(targetWord);
    poolCandidates = pickPoolCandidates();
    console.log(`[guess1t] PRACTICE WORD: "${targetWord}" (${targetPos}) — ${targetDef}`);

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
    updateHintBar();
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
      nA += vA[i] * vA[i];
      nB += vB[i] * vB[i];
    }
    const s = dot / (Math.sqrt(nA) * Math.sqrt(nB));
    return Math.round(Math.max(0, Math.min(1, s)) * 100) / 100;
  }

  // ── Centroid (average of all vectors) for OOV fallback ──
  function computeCentroid() {
    const dim = embData.dim;
    const sum = new Float32Array(dim);
    for (let i = 0; i < embData.vectors.length; i++) {
      const v = embData.vectors[i];
      for (let j = 0; j < dim; j++) sum[j] += v[j];
    }
    const n = embData.vectors.length;
    for (let j = 0; j < dim; j++) sum[j] /= n;
    // Normalize
    let norm = 0;
    for (let j = 0; j < dim; j++) norm += sum[j] * sum[j];
    norm = Math.sqrt(norm);
    for (let j = 0; j < dim; j++) sum[j] /= norm;
    return sum;
  }

  // ── Cosine Similarity with fallback vector ──
  function cosineSimWithVec(guessWord, targetWord) {
    const iB = wordIdx.get(targetWord);
    if (iB === undefined || !fallbackVec) return null;
    const vB = embData.vectors[iB];
    let dot = 0, nB = 0;
    for (let i = 0; i < embData.dim; i++) {
      dot += fallbackVec[i] * vB[i];
      nB += vB[i] * vB[i];
    }
    // fallbackVec is already normalized, nA = 1
    const s = dot / Math.sqrt(nB);
    return Math.round(Math.max(0, Math.min(1, s)) * 100) / 100;
  }

  // ── Rendering ──
  function renderGuesses() {
    $guessList.innerHTML = '';
    for (const g of state.guesses) {
      const row = document.createElement('div');
      row.className = 'guess-row';
      const scoreText = g.score !== null ? g.score.toFixed(2) : '—';
      const inPool = poolSet.has(g.word);
      const info = poolInfo ? poolInfo.get(g.word) : null;

      const wordSpan = document.createElement('span');
      wordSpan.className = 'guess-word';
      wordSpan.textContent = g.word;

      if (info && info.definition) {
        wordSpan.classList.add('has-def');
        wordSpan.dataset.def = info.definition;
        wordSpan.tabIndex = 0;
        wordSpan.addEventListener('mouseenter', () => showGuessTooltip(wordSpan.dataset.def, wordSpan));
        wordSpan.addEventListener('mouseleave', hideGuessTooltip);
        wordSpan.addEventListener('focus', () => showGuessTooltip(wordSpan.dataset.def, wordSpan));
        wordSpan.addEventListener('blur', hideGuessTooltip);
      }

      const badge = document.createElement('span');
      badge.className = `pool-badge ${inPool ? 'in-pool' : 'not-pool'}`;
      badge.textContent = inPool ? 'pool' : 'free';

      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'guess-score';
      scoreSpan.textContent = scoreText;

      wordSpan.appendChild(badge);
      row.appendChild(wordSpan);
      row.appendChild(scoreSpan);
      $guessList.appendChild(row);
    }
    $guessList.scrollTop = $guessList.scrollHeight;
  }

  function showGuessTooltip(text, anchorEl) {
    if (!$guessTooltip || !text || !anchorEl) return;
    $guessTooltip.textContent = text;
    $guessTooltip.classList.remove('hidden');

    const rect = anchorEl.getBoundingClientRect();
    const margin = 10;
    const maxWidth = 340;

    const left = Math.max(
      margin,
      Math.min(rect.left, window.innerWidth - maxWidth - margin),
    );
    const top = Math.min(rect.bottom + 10, window.innerHeight - margin);

    $guessTooltip.style.left = `${left}px`;
    $guessTooltip.style.top = `${top}px`;
  }

  function hideGuessTooltip() {
    if (!$guessTooltip) return;
    $guessTooltip.classList.add('hidden');
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
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function hashDate(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ── Hint Bar ──
  function updateHintBar() {
    if (!targetPos) { $('hint-bar').classList.add('hidden'); return; }
    $('hint-pos').textContent = targetPos;
    $('hint-bar').classList.remove('hidden');
  }

  // ── Word Pool Modal ──
  function openPoolModal() {
    $('pool-overlay').classList.remove('hidden');
    renderPoolList();
  }

  function renderPoolList() {
    const list = $('pool-list');
    list.innerHTML = '';
    const guessed = new Set(state.guesses.map(g => g.word));
    for (const w of poolCandidates) {
      const alreadyGuessed = guessed.has(w.word.toLowerCase());
      const item = document.createElement('div');
      item.className = 'pool-item';
      if (alreadyGuessed) item.classList.add('pool-item-guessed');
      const posLabel = w.pos || '';
      item.innerHTML = `<span class="pool-item-word">${esc(w.word)}${alreadyGuessed ? ' ✗' : ''}</span><span class="pool-item-pos">${esc(posLabel)}</span><span class="pool-item-def">${esc(w.definition)}</span>`;
      list.appendChild(item);
    }
    $('pool-count').textContent = `${poolCandidates.length} words (${targetPos})`;
    $('pool-pos-label').textContent = targetPos;
  }
})();
