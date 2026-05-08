/**
 * guess1t — Semantic Word Guessing Game
 * Client-side game logic with pre-computed word embeddings.
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
  let wordSet = null;   // Set<string> valid words
  let wordIdx = null;   // Map<string, number> word→vector index

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
    const idx = hashDate(todayStr()) % wordPool.length;
    targetWord = wordPool[idx].word.toLowerCase();
    targetDef = wordPool[idx].definition;

    // Restore state
    loadState();

    // Render
    $loading.classList.add('hidden');
    $gameArea.classList.remove('hidden');
    renderGuesses();
    updateCounter();

    if (state.result) {
      disableInput();
      setTimeout(() => showResult(state.result), 300);
    } else {
      $guessInput.focus();
    }

    $guessForm.addEventListener('submit', handleGuess);
  });

  // ── Guess Handler ──
  function handleGuess(e) {
    e.preventDefault();
    clearError();
    const raw = $guessInput.value.trim().toLowerCase();
    if (!raw) return;

    if (!wordSet.has(raw)) return showError('Not a recognized word.');
    if (state.guesses.some(g => g.word === raw)) return showError('Already guessed.');

    const isWin = raw === targetWord;
    const score = cosineSim(raw, targetWord);

    state.guesses.push({ word: raw, score });
    $guessInput.value = '';
    renderGuesses();
    updateCounter();

    if (isWin) {
      state.result = 'win';
      saveState();
      disableInput();
      return setTimeout(() => showResult('win'), 400);
    }
    if (state.guesses.length >= MAX_GUESSES) {
      state.result = 'lose';
      saveState();
      disableInput();
      return setTimeout(() => showResult('lose'), 400);
    }

    saveState();
    $guessInput.focus();
  }

  // ── Cosine Similarity ──
  function cosineSim(a, b) {
    const iA = wordIdx.get(a), iB = wordIdx.get(b);
    if (iA === undefined || iB === undefined) return 0;
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
      row.className = 'guess-row';
      row.innerHTML = `<span class="guess-word">${esc(g.word)}</span><span class="guess-score">${g.score.toFixed(2)}</span>`;
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
      stats.textContent = `The word was:`;
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

  // ── Persistence ──
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
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
