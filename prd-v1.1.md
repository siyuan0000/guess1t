# guess1t — Supplementary PRD v1.1

**Scope:** Three feature additions to the existing MVP  
**Date:** May 2026  
**Status:** Draft

---

## Feature 1 — "I Give Up" Button

### Description

Add a clearly visible but non-intrusive button that lets the player voluntarily end the game early and reveal the target word. This acts as an explicit surrender — the game is marked as a loss.

### Behavior

- The button appears below the input field, labeled **"I give up"** (lowercase, matching the game's minimal tone).
- Clicking it triggers a **confirmation step** — the button text changes to **"Are you sure?"** for 3 seconds before reverting. A second click within that window confirms the surrender.
- On confirmation:
  - The game ends immediately.
  - The result modal is shown with outcome = **lose**, displaying the target word and its definition.
  - The guess counter freezes at its current value.
  - State is saved — refreshing the page does not allow replaying.
- The button is **hidden** once the game has ended (win or lose).

### Rationale

Players stuck on an obscure word currently have no escape besides exhausting all 10 guesses with throwaway words. A give-up option respects the player's time while still marking the session as a loss.

---

## Feature 2 — "Try Again" / Replay

### Description

After a game ends (win, lose, or give up), allow the player to start a new game with a **different random word** from the pool — independent of the daily word.

### Behavior

- A **"Try again"** button appears in the result modal after the game ends.
- Clicking it:
  - Picks a new target word at random from the pool (excluding the daily word and any previously played words in this session).
  - Resets the guess list, guess counter, and input field.
  - Closes the result modal.
  - The game is fully playable again with the new word.
- The **daily game** is always the first game of the day. "Try again" games are bonus rounds and are **not** saved to localStorage — they are ephemeral (lost on page refresh).
- The daily game result is still persisted as before.
- The result modal should distinguish between the daily game and bonus rounds:
  - Daily: shows **"Daily #N"** (where N = days since launch or a fixed epoch).
  - Bonus: shows **"Practice round"**.

### State Model

| Property | Daily game | Practice round |
|---|---|---|
| Persisted to localStorage | ✅ | ❌ |
| Counts toward streak (future) | ✅ | ❌ |
| Uses daily word | ✅ | ❌ (random from pool) |
| Replayable | ❌ (one per day) | ✅ (unlimited) |

---

## Feature 3 — Accept Out-of-Pool Guesses

### Description

Currently, guesses are validated against the 20k-word embedded vocabulary. Words outside this set are rejected with "Not a recognized word." This is too restrictive — players should be able to try any reasonable English word, even if it's not in the pre-computed embedding set.

### Behavior

- **If the guessed word exists in the embedding vocabulary:** compute and display cosine similarity as before.
- **If the guessed word is a valid English word but NOT in the embedding vocabulary:**
  - Accept the guess (consume one attempt).
  - Display the score as **"—"** (em-dash) instead of a number.
  - Show a subtle inline note below the guess: *"Word not in semantic database"*.
  - The guess is still recorded in history and still counts toward the 10-guess limit.
- **If the guessed word is not a valid English word at all** (gibberish, typos): reject as before without consuming a guess.
- **Exact-match win still works** regardless of whether the word is in the embedding set — win detection is a string comparison, not a score check.

### Validation Strategy

For determining whether a guess is "a valid English word" without the embedding set:

- Use a **lightweight client-side word list** — the existing 20k embedded vocabulary covers most cases.
- Additionally, accept any word that is **≥ 3 characters, alphabetic only** as a fallback — this avoids false rejections for uncommon but real words. The tradeoff (accepting some nonsense) is acceptable since it merely wastes the player's own guesses.

### UI Change

The guess row for an unscored word should look distinct but not alarming:

| Guess | Score |
|---|---|
| verbose | 0.72 |
| loquacious | 0.85 |
| defenestrate | — |

The em-dash score is styled in the same muted color as regular scores — no special color or icon.

---

## Implementation Priority

| Priority | Feature | Complexity |
|---|---|---|
| 1 | Accept out-of-pool guesses | Low — input validation change only |
| 2 | "I give up" button | Low — new button + confirmation UX |
| 3 | "Try again" / Replay | Medium — state reset logic, daily vs practice distinction |

---

## Out of Scope

- Sharing results or score cards
- Streak tracking (deferred to v1.2)
- Difficulty selection
- Hint system
