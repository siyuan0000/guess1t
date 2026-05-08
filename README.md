# guess1t

A minimalist semantic word guessing game. Each day, a hidden GRE vocabulary word is chosen. You have 10 guesses to find it — your only clue is a cosine similarity score (0.00–1.00) after each guess.

No letters revealed. No hints. Just the number.

## How It Works

- Word embeddings are pre-computed using [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) and compressed via PCA (128d) + int8 quantization
- Cosine similarity is computed client-side — no API calls, no backend
- Daily word is deterministic via date-seeded hash — same word for everyone
- State persisted in localStorage

## Setup

```bash
# Serve locally (any static server works)
python3 -m http.server 8000
# Open http://localhost:8000
```

## Regenerating Embeddings

Requires Python 3.8+ with `sentence-transformers` and `scikit-learn`:

```bash
pip install sentence-transformers scikit-learn
python3 scripts/generate_embeddings.py
python3 scripts/optimize_embeddings.py
```

## Tech Stack

- Vanilla HTML/CSS/JS — no build step, no framework
- Pre-computed word vectors (all-MiniLM-L6-v2 → PCA 128d → int8)
- ~300 curated GRE vocabulary words
- ~20k word vocabulary for guess validation

## License

MIT
