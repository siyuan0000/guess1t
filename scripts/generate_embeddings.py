"""
Generate word embeddings for guess1t using GloVe (Word2Vec-style) vectors.

Uses pre-trained GloVe vectors (glove-wiki-gigaword-50, 400k words, 50-dim)
from https://nlp.stanford.edu/projects/glove/
Output: data/embeddings.json — a dict mapping word → float32[] vector,
then optimize_embeddings.py reduces + quantizes for web delivery.
"""

import json, sys, os, gzip
import numpy as np
from pathlib import Path

def load_glove(glove_path):
    """Load GloVe vectors manually. Returns dict {word: np.array}."""
    vectors = {}
    with open(glove_path, 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 51:
                continue
            word = parts[0]
            vec = np.array([float(x) for x in parts[1:]], dtype=np.float32)
            vectors[word] = vec
    return vectors

def main():
    root = Path(__file__).resolve().parent.parent
    words_file = root / 'data' / 'words.json'
    out_file = root / 'data' / 'embeddings.json.gz'
    uncompressed_file = root / 'data' / 'embeddings.json'
    wordlist_file = root / 'data' / 'wordlist.json'
    # Load target words
    with open(words_file) as f:
        pool = json.load(f)
    target_words = {entry['word'].lower() for entry in pool}
    print(f"Loaded {len(target_words)} target words")

    # GloVe file location
    glove_path = os.path.expanduser('~/gensim-data/glove-wiki-gigaword-50/glove-wiki-gigaword-50')

    # Load GloVe
    print("Loading GloVe vectors (glove-wiki-gigaword-50)...")
    glove = load_glove(glove_path)
    print(f"Loaded {len(glove)} vectors, dim={next(iter(glove.values())).shape[0]}")

    # Collect words: all target words + all GloVe words (3-15 chars)
    all_words = []
    missed_targets = []
    for w in sorted(target_words):
        if w in glove:
            all_words.append(w)
        else:
            missed_targets.append(w)

    # Include all reasonable GloVe words
    for w in glove:
        if len(w) < 3 or len(w) > 15:
            continue
        if w in target_words:
            continue
        all_words.append(w)

    print(f"Total words to embed: {len(all_words)}")
    if missed_targets:
        print(f"WARNING: {len(missed_targets)} target words not in GloVe: {missed_targets}")

    # Extract vectors and normalize
    vectors = np.array([glove[w] for w in all_words], dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1
    vectors = vectors / norms

    # Build output dict (rounded to 4 decimal places)
    embeddings = {}
    for word, vec in zip(all_words, vectors):
        embeddings[word] = [round(float(v), 4) for v in vec]

    # Save compressed
    data = json.dumps(embeddings, separators=(',', ':'))
    with gzip.open(out_file, 'wt', encoding='utf-8') as f:
        f.write(data)
    print(f"Saved {len(embeddings)} embeddings to {out_file} ({os.path.getsize(out_file) / 1024 / 1024:.1f} MB)")

    # Save word list
    with open(wordlist_file, 'w') as f:
        json.dump(sorted(all_words), f)
    print(f"Saved word list ({len(all_words)} words) to {wordlist_file}")

    # Save uncompressed
    with open(uncompressed_file, 'w') as f:
        f.write(data)
    print(f"Saved uncompressed to {uncompressed_file} ({os.path.getsize(uncompressed_file) / 1024 / 1024:.1f} MB)")

if __name__ == '__main__':
    main()

