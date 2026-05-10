# guess1t — Product Requirements Document

**Product:** guess1t — Semantic Word Guessing Game  
**Version:** MVP · Scope v1  
**Date:** May 2026  
**Audience:** Vocab learners, word game fans

---

## 01 — Overview

guess1t is a minimalist vocabulary game. Each game, the system silently picks one word from a pool of GRE-level vocabulary. The player has 10 guesses to identify it. After each guess, the game returns exactly one piece of information: a similarity score from 0.00 to 1.00, computed via cosine similarity of word embeddings.

No letters revealed. No word length. No hot/cold labels. No color coding. Just the number. The player must read the semantic space purely from scores — building a mental map of what the hidden word means before naming it.

---

## 02 — Goals & Success Metrics

| Metric | Target |
|---|---|
| Completion rate | ≥55% of players use all 10 guesses even when struggling |
| Return rate | ≥35% of players return for a second game within 48 hours |
| Score latency | Score returned in <800ms; <50ms with pre-computed vectors |
| Score clarity | Players understand what the number means after 1 onboarding screen |

---

## 03 — Core Gameplay Loop

```
Session starts → Word chosen silently → Player types a word → Score returned (0.00–1.00) → Win · or · next guess
```

**Win condition:** The player's guess exactly matches the target word (string match, case-insensitive). A score of 1.00 does not auto-win — two different words can share a very high cosine similarity. The player must type the exact word to win.

**Lose condition:** 10 guesses used without an exact match. The target word and its definition are revealed.

---

## 04 — UI Concept

The UI shows only:

- The game name
- A chronological list of previous guesses with their scores
- The input field
- A remaining-guesses counter

Nothing else. No bars, no colors, no emoji, no hints. The score is the entire UI.

**Example guess list:**

| Guess | Score |
|---|---|
| verbose | 0.72 |
| loquacious | 0.85 |
| taciturn | 0.31 |

Guesses are listed in chronological order so players can trace their reasoning. The list scrolls if it overflows on small screens.

---

## 05 — Explicitly Out of UI

The system **never** shows any of the following per guess:

- Word length or letter count
- Any revealed letters or blanks
- Hot / cold labels or color coding on scores
- Progress bars or visual score representations
- Part of speech, definition, or etymology
- Whether the guess is semantically above or below previous guesses
- Any ranking or sorting of guesses by score

> **Design principle:** The score is the only signal. The game's tension comes entirely from the player's ability to interpret a single decimal number and build a semantic map from it. Any additional affordance undermines this.

---

## 06 — Functional Requirements

### Must-have for MVP

- Word pool (300–500 GRE words)
- Daily word via date seed
- 10-guess hard limit
- Cosine similarity score
- Exact-match win detection
- Chronological guess history
- Input validation (real words only)
- Duplicate guess rejection
- Win / lose reveal screen
- One-screen onboarding

### Post-MVP

- Daily streak
- Shareable result card
- Archive of past words
- Practice mode (unlimited)
- Difficulty tiers

---

## 07 — Technical Specification

| Parameter | Detail |
|---|---|
| Embedding model | Pre-compute all word vectors using text-embedding-3-small (OpenAI) or all-MiniLM-L6-v2 (local). Ship as a static JSON file loaded at startup — no per-guess API calls needed. |
| Similarity function | Cosine similarity between the guess vector and the target vector. Score displayed to 2 decimal places (e.g. 0.72). No rounding to integers or bucketing. |
| Win condition | String equality check (lowercased, trimmed). Score alone does not trigger a win. |
| Word pool | JSON: `[{ word, definition }]`. Target selected as `pool[hash(today's date) % pool.length]` — same word for all players on a given day. |
| Input validation | Lowercase, trim whitespace. Reject if not found in a reference English word list (e.g. words-alpha). Reject if already guessed this session. Show an inline error message — do not consume a guess attempt. |
| State | Client-side only (memory + localStorage). No backend, no accounts for MVP. |
| Frontend | Single-page app. Responsive down to 375px width. React or vanilla JS. |
| Onboarding | One modal shown on first visit. Explains cosine similarity in plain language with a 2-example table. Dismissible; never shown again. |

---

## 08 — Onboarding Screen

Because the score is the only feedback, new players need a one-time explanation of what cosine similarity means in practice. The onboarding modal should include a plain-language definition and two concrete examples:

| Example | Score | What it means |
|---|---|---|
| "happy" vs "joyful" | ~0.87 | Near-synonyms, very similar meaning |
| "happy" vs "furniture" | ~0.12 | Unrelated concepts, very different meaning |

The onboarding should not hint at the target word's domain, difficulty, or length. It exists solely to calibrate the player's intuition for the scale.

---

## 09 — Risks & Mitigations

| Severity | Risk | Mitigation |
|---|---|---|
| High | **Score feels arbitrary** — Without visual encoding, a score of 0.72 vs 0.74 feels meaningless. Players may quit after 2 guesses. | Curate words that produce a wide, interpretable score spread across common guesses. Calibrate intuition via onboarding examples. |
| High | **Target word is too obscure** — GRE words like "tmesis" have almost no common near-synonyms. Players cannot navigate toward them. | Filter the word pool: only include words where at least 6 common English words score ≥0.60 against the target. |
| Medium | **Score ≠ 1.00 for exact match** — The win condition is string equality, not score threshold. These must be clearly separated in implementation to avoid bugs. | Implement win detection as a string comparison step that runs before (or independently of) the similarity calculation. |
| Low | **Pre-computed vector file size** — 500 words × 1536-dim float32 vectors ≈ 3MB. | Compress with gzip and load asynchronously so the UI renders immediately. |

---

## 10 — Out of Scope for MVP

User accounts, authentication, leaderboards, multiplayer, native mobile app, server-side game state, analytics dashboards, and accessibility audits are all deferred. The MVP ships as a static single-page app — no backend required.