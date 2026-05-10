# guess1t — Product Requirements Document

**Product:** guess1t — Semantic Word Guessing Game  
**Version:** v1.2  
**Date:** May 2026  
**Status:** Approved for development  
**Audience:** Vocab learners, word game fans

---

## Changelog

| Version | Date | Summary |
|---|---|---|
| v1.0 | May 2026 | Initial MVP spec |
| v1.1 | May 2026 | Renamed to guess1t; locked feedback to score-only |
| **v1.2** | **May 2026** | **Upgraded embedding model; percentile-rank scoring; definition-hit star; OOV handling overhaul** |

---

## 01 — Overview

guess1t is a minimalist vocabulary game. Each session, the system silently picks one word from a pool of GRE-level vocabulary. The player has 10 guesses to identify it. After each guess, the game returns exactly one piece of feedback: a similarity score from **0 to 1000**, derived from the guess word's percentile rank against the entire reference vocabulary — not a raw cosine similarity value.

No letters revealed. No word length. No hot/cold labels. No color coding. Just the number.

### What changed in v1.2

Three specific problems observed in v1.1 playtesting are addressed:

1. **Raw cosine similarity is unintuitive.** A score like `0.50` reads as "half right" to players, but in GloVe embedding space it actually represents a very close semantic match. Players were quitting after seeing high-similarity guesses that displayed low-looking numbers.
2. **GloVe conflates relatedness with synonymy.** "doctor" and "hospital" score high under GloVe, but they are not synonyms. The new model (all-MiniLM-L6-v2) is trained specifically for semantic textual similarity and handles rare GRE vocabulary far better.
3. **OOV (out-of-vocabulary) guesses were silently rejected.** Players received no feedback and were confused about whether their guess was invalid or just scored zero.

---

## 02 — Goals & Success Metrics

| Metric | v1.1 Target | v1.2 Target | Notes |
|---|---|---|---|
| Completion rate | ≥55% | ≥65% | Percentile scoring makes progress feel real |
| Return rate (48h) | ≥35% | ≥40% | Star mechanic creates shareable moments |
| Score latency | <800ms | <100ms | Pre-computed vectors; no runtime API calls |
| Score clarity | Understood after onboarding | Understood immediately | 0–1000 scale is self-explanatory |
| OOV confusion rate | Not tracked | <5% of sessions | Explicit OOV feedback replaces silent rejection |

---

## 03 — Core Gameplay Loop

```
Session starts → Word chosen silently → Player types a guess
    → OOV check → if OOV: show message, do NOT consume guess
    → Definition-hit check → if hit: score = ★ (special display)
    → Percentile rank computed → Score (0–1000) displayed
    → Exact string match? → Win state
    → 10 guesses used? → Lose state · reveal word + definition
```

**Win condition:** The player's guess exactly matches the target word (lowercased, trimmed). Score alone never triggers a win — two different words can have identical percentile ranks.

**Lose condition:** 10 valid guesses used without an exact match. The target word and its definition are revealed.

> **Valid guess:** A guess only counts toward the 10-guess limit if it passes OOV validation. Invalid inputs are corrected and returned without consuming a turn.

---

## 04 — Scoring System (v1.2 Redesign)

### 4.1 Why raw cosine similarity was dropped

GloVe and raw cosine similarity have two compounding problems for this game:

**Problem 1 — Co-occurrence ≠ synonymy.** GloVe is trained on global word co-occurrence statistics. It captures whether two words appear in similar contexts (relatedness), not whether they mean the same thing (synonymy). "temerity" and "audacity" are near-perfect synonyms, but because "temerity" is rare in training corpora, their GloVe vectors diverge more than expected.

**Problem 2 — Numerical illusion.** In high-dimensional GloVe space, most random word pairs score between 0.00 and 0.15. A score of 0.50 is mathematically extraordinary — it means the guess is among the closest words in the entire vocabulary. But players read "0.50" as "50% correct," creating a constant sense of failure even when they are extremely close.

### 4.2 New model: all-MiniLM-L6-v2

Replace GloVe with **all-MiniLM-L6-v2**, a 22M-parameter sentence transformer fine-tuned for semantic textual similarity (STS). Key properties:

- Trained on NLI + STS datasets; directly optimized for synonymy, not co-occurrence
- Scores for near-synonyms cluster in the 0.80–0.99 range, giving far more room for meaningful discrimination
- Runs fully in-browser via Transformers.js (ONNX runtime); no server round-trip
- Model size: ~23MB (quantized); acceptable for a web game with async loading

Pre-compute vectors for the entire reference vocabulary (top 50,000 English words) at build time. Store as a compressed binary float32 array. Load asynchronously on page init.

### 4.3 Percentile rank scoring (0–1000 scale)

Instead of displaying a raw cosine similarity decimal, display the guess word's **percentile rank** across the pre-computed reference vocabulary, mapped to a 0–1000 integer scale.

**Algorithm:**

```
1. Compute cosine_sim(guess_vector, target_vector) for the guess word
2. Compare against pre-computed cosine_sim scores for all ~50,000 reference words vs. the same target
3. percentile = count(reference_words with score < guess_score) / total_reference_words
4. display_score = round(percentile × 1000)
```

**What this achieves:**

| Guess | Raw cosine sim | Percentile rank | Display score |
|---|---|---|---|
| completely unrelated word | 0.08 | 12th percentile | 120 |
| loosely related word | 0.35 | 55th percentile | 550 |
| near-synonym | 0.82 | 98th percentile | 980 |
| exact match | 1.00 | 100th percentile | **Win** |

A score of `980` is legible as "extremely close." A score of `120` is legible as "far away." Players no longer need to understand cosine similarity to read the feedback.

### 4.4 Definition-hit star (⭐)

If the player's guess word appears verbatim in the target word's definition string or in its WordNet synonym list, the normal score is suppressed and replaced with a special **⭐** display.

**Detection logic:**

```javascript
function isDefinitionHit(guess, targetWord) {
  const defTokens = tokenize(targetWord.definition);  // lowercase, strip punctuation
  const synonyms  = wordnet.getSynonyms(targetWord.word);  // WordNet lookup
  return defTokens.includes(guess.toLowerCase()) || synonyms.includes(guess.toLowerCase());
}
```

**Display behavior:**

- The score column shows `⭐` instead of a number
- A one-line tooltip appears: *"This word appears in the definition — you're very close."*
- The guess still counts as one of 10 attempts
- The star does **not** reveal how many words are in the definition or which position the guess matched

**Rationale:** A word appearing in the definition is semantically unambiguous. Showing a number in this case (even a high one like 980) undersells the closeness. The star is the only visual affordance added to the otherwise number-only UI.

---

## 05 — OOV (Out-of-Vocabulary) Handling

### 5.1 Problem statement

In v1.1, any word not found in the embedding vocabulary was silently rejected — no guess consumed, no message shown. Players experienced this as the input field clearing with no explanation, leading to repeated attempts with the same invalid word and significant frustration.

### 5.2 OOV categories

Not all OOV words are the same. v1.2 distinguishes three cases:

| Category | Example | Cause | Handling |
|---|---|---|---|
| **Misspelling** | "audacety" | Typo | Suggest closest valid word; do not consume guess |
| **Real word, not in model vocab** | "cwtch" | Valid but rare; not in top-50K | Accept with degraded scoring (see §5.4) |
| **Non-word / gibberish** | "asdfgh" | Keyboard mash | Reject with message; do not consume guess |
| **Proper noun** | "London" | Out of game scope | Reject with message; do not consume guess |

### 5.3 Validation pipeline

Each guess passes through the following checks in order before a score is computed:

```
Input received
  → 1. Sanitize (trim, lowercase, strip non-alpha)
  → 2. Reject if empty or single character
  → 3. Check against proper-noun blocklist → reject if match
  → 4. Check against reference English word list (words-alpha, ~370K words)
       → if NOT found: run spell-check (Levenshtein distance ≤ 2)
           → if close match found: show suggestion UI (see §5.5)
           → if no close match: reject as non-word
  → 5. Check against duplicate guess list → reject if already guessed
  → 6. Check against model vocabulary (top-50K)
       → if NOT in model vocab: flag as rare-word (see §5.4)
  → 7. Compute score → display
```

**Important:** Steps 1–6 never consume a guess. Only step 7 (score computation and display) marks a guess as used.

### 5.4 Rare-word degraded scoring

If a word passes English dictionary validation (step 4) but is absent from the model's top-50K vocabulary (step 6), it is a "rare but real" word. Two options:

**Option A — Subword embedding fallback (preferred):** all-MiniLM-L6-v2 operates at the subword (BPE) level, so it can produce a vector for any string, including rare words. Use the model's native subword inference to generate a vector and score normally. Display score with a subtle `~` prefix (e.g. `~340`) to indicate the score is approximate.

**Option B — Soft rejection:** Display the message: *"'cwtch' is a valid word but too rare to score. Try a more common synonym."* Do not consume the guess.

**Recommendation:** Implement Option A for the best player experience. The `~` prefix transparently signals imprecision without blocking the player.

### 5.5 Misspelling suggestion UI

When step 4 detects a near-match (Levenshtein distance ≤ 2):

```
┌─────────────────────────────────────────┐
│  Did you mean: "audacious"?             │
│  [Use "audacious"]   [Cancel]           │
└─────────────────────────────────────────┘
```

- Accepting the suggestion submits the corrected word as the guess (consumes one attempt)
- Cancelling returns focus to the input field; no guess consumed
- Only one suggestion is shown (the closest match by edit distance; ties broken by word frequency)

### 5.6 Duplicate guess handling

If the player submits a word they have already guessed:

- Do not consume a guess
- Briefly highlight the existing row in the guess list (e.g., a 300ms background flash)
- Show inline message: *"Already guessed."*

---

## 06 — UI Specification

### 6.1 Game screen

The UI remains deliberately minimal. The only elements on screen:

- Game name: **guess1t**
- Chronological guess history (word + score or ⭐)
- Text input field + submit button
- Remaining guesses counter

No bars. No color coding on scores. No letters. No word length. The score (and the star) are the entire interface.

**Guess list row anatomy:**

```
verbose          0.720     ← chronological, not sorted
loquacious       ⭐        ← definition hit
taciturn         0.210
```

### 6.2 Score display format

- Percentile rank scores displayed as integers: `720`, `210`, `980`
- Rare-word approximate scores prefixed with tilde: `~340`
- Definition hits displayed as: `⭐` (star character, centered in score column)
- Tooltip on ⭐ (hover/tap): *"This word appears in the definition — you're very close."*

### 6.3 Win state

Displays:
- "You got it!" message
- The target word in large type
- Its full definition
- Number of guesses used
- Option to share result (post-MVP)

### 6.4 Lose state

Displays:
- "The word was: **[word]**"
- Full definition
- The player's closest guess (highest score) highlighted in the history list

---

## 07 — Functional Requirements

### Must-have for v1.2

- Word pool (300–500 curated GRE words, pre-filtered for navigability)
- Daily word via date seed (same word for all players each day)
- 10-guess hard limit (only valid guesses count)
- all-MiniLM-L6-v2 embeddings (pre-computed, loaded async)
- Percentile rank scoring (0–1000 integer scale)
- Pre-computed reference similarity scores for all 50K reference words vs. each target word
- Definition-hit detection (definition tokenization + WordNet synonym lookup)
- Star display for definition hits with tooltip
- Full OOV validation pipeline (sanitize → dictionary → spell-suggest → model vocab)
- Misspelling suggestion UI
- Rare-word degraded scoring with `~` prefix
- Duplicate guess detection with row highlight
- Chronological guess history
- Exact-match win detection
- Win / lose reveal screen (with definition)
- One-screen onboarding (updated for 0–1000 scale)

### Post-MVP (unchanged from v1.1)

- Daily streak counter
- Shareable result card
- Archive of past words
- Practice mode (unlimited)
- Difficulty tiers

---

## 08 — Technical Specification

| Parameter | Detail |
|---|---|
| Embedding model | all-MiniLM-L6-v2 (ONNX quantized, ~23MB). Loaded via Transformers.js at page init. Inference runs fully client-side. |
| Pre-computation | At build time: compute cosine similarity of every target word vs. every reference word (top 50K). Store per-target as sorted float32 arrays. Total size: ~500 targets × 50K words × 4 bytes = ~100MB raw; gzip to ~30MB. Lazy-load per target word on game start. |
| Percentile scoring | `score = round((rank_in_reference / 50000) × 1000)`. Reference array pre-sorted ascending; binary search to find rank in O(log n). |
| Definition-hit | Tokenize definition string (lowercase, strip punctuation, split on whitespace). Check `guess ∈ tokens`. Also query WordNet synonyms API or bundled synonym JSON. If match: return `{ hit: true }` instead of a numeric score. |
| OOV pipeline | English word list: `words-alpha` (~370K words). Spell-check: Levenshtein distance ≤ 2 via BK-tree (O(log n)). Rare-word fallback: run subword inference through model, prefix display score with `~`. |
| Win detection | `guess.toLowerCase().trim() === targetWord.toLowerCase()`. Runs before score computation. |
| State | Client-side only: `localStorage` for today's guess history and daily word. No backend, no accounts. |
| Frontend | Single-page app. Responsive to 375px. React or vanilla JS. |
| Onboarding | One modal on first visit. Updated examples using 0–1000 scale. Explains star mechanic. Dismissible, never shown again. |

---

## 09 — Word Pool Curation Criteria

For a word to be included in the target pool it must satisfy all of the following:

1. **Navigability:** At least 8 words in the top-10K English vocabulary score ≥ 700 (70th percentile) against it under the new scoring system. This ensures players can always make meaningful progress.
2. **In-model vocabulary:** The word must be present in all-MiniLM-L6-v2's training data (not a subword-only inference case).
3. **Has a definition:** A clear, concise English definition is available for the lose/win reveal screen.
4. **Definition contains at least one scoreable synonym:** At least one word in the definition itself scores ≥ 800 against the target. This guarantees the star mechanic can fire.
5. **Not a proper noun or brand name.**

---

## 10 — Onboarding Screen (Updated)

The onboarding modal explains the scoring system using the new 0–1000 scale and introduces the star mechanic.

**Example table shown to new players:**

| Your guess | Score | What it means |
|---|---|---|
| "furniture" | 45 | Very far — unrelated concept |
| "confidence" | 610 | Getting somewhere — loosely related |
| "boldness" | 940 | Very close — near-synonym |
| "audacity" | ⭐ | Appears in the definition! |

One paragraph of plain-language explanation:

> *The score shows how semantically close your word is to the hidden word — ranked against 50,000 common English words. 1000 means your word is closer than almost every other word in the language. 0 means it's completely unrelated. A ⭐ means your word appears directly in the hidden word's definition.*

---

## 11 — Risks & Mitigations

| Severity | Risk | Mitigation |
|---|---|---|
| High | **Pre-computed reference files are large (~30MB gzipped).** Players on slow connections wait a long time before the game is playable. | Load today's target reference file only (not all 500). Show a loading state. Pre-fetch tomorrow's file in background after game completes. |
| High | **Transformers.js first-load latency.** The ONNX model (~23MB) must download and initialize before any guess can be scored. | Show a lightweight loading screen. Cache model in browser via `Cache API` so subsequent visits are instant. |
| Medium | **Star mechanic spoils the word.** If the definition contains the target word itself (self-referential definitions), the star fires on the target word before exact-match is checked. | Filter definitions during curation to remove self-references. Exact-match check always runs before definition-hit check. |
| Medium | **BK-tree spell-check latency.** Building a BK-tree over 370K words at runtime is slow. | Build BK-tree at compile time; serialize to JSON and ship as a static asset. |
| Low | **Percentile ties.** Many common words may share the exact same rounded percentile score. | Display ties as equal scores — no disambiguation needed. The game doesn't promise uniqueness. |
| Low | **WordNet synonym coverage.** Some GRE words have poor WordNet coverage. | Fall back to definition-only matching if WordNet returns no synonyms. Ship a curated synonym override JSON for the 500-word pool. |

---

## 12 — Out of Scope for v1.2

User accounts, authentication, leaderboards, multiplayer, native mobile app, server-side game state, analytics dashboards, and accessibility audits remain deferred. The game ships as a fully static single-page app — no backend required.
