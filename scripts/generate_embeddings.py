"""
Generate word embeddings for guess1t using all-MiniLM-L6-v2.

Embeds all GRE target words + a common English vocabulary (~10k words)
so that any reasonable player guess can be scored via cosine similarity.

Output: data/embeddings.json — a dict mapping word → float32[] vector.
"""

import json, sys, os, gzip
import numpy as np
from pathlib import Path

def load_common_words():
    """Load a set of common English words for guess validation + embedding."""
    try:
        from nltk.corpus import words as nltk_words
        import nltk
        nltk.download('words', quiet=True)
        word_list = set(w.lower() for w in nltk_words.words() if w.isalpha() and len(w) > 1)
    except ImportError:
        # Fallback: use system word list
        word_path = '/usr/share/dict/words'
        if os.path.exists(word_path):
            with open(word_path) as f:
                word_list = set(w.strip().lower() for w in f if w.strip().isalpha() and len(w.strip()) > 1)
        else:
            word_list = set()
    return word_list

def main():
    root = Path(__file__).resolve().parent.parent
    words_file = root / 'data' / 'words.json'
    out_file = root / 'data' / 'embeddings.json.gz'
    wordlist_file = root / 'data' / 'wordlist.json'

    with open(words_file) as f:
        pool = json.load(f)
    target_words = {entry['word'].lower() for entry in pool}

    # Gather common words
    common = load_common_words()
    print(f"Loaded {len(common)} common English words")

    # Combine: target words must be included
    all_words = sorted(target_words | common)
    # Cap at ~20k for reasonable file size
    if len(all_words) > 20000:
        # Keep all targets, sample from common
        extras = sorted(common - target_words)
        import random; random.seed(42)
        extras = random.sample(extras, 20000 - len(target_words))
        all_words = sorted(target_words | set(extras))

    print(f"Embedding {len(all_words)} words...")

    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer('all-MiniLM-L6-v2')
    vectors = model.encode(all_words, show_progress_bar=True, batch_size=256)

    # Normalize vectors for fast cosine similarity (just dot product after norm)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    vectors = vectors / norms

    # Build output: word → list of floats (rounded to 4 decimal places)
    embeddings = {}
    for word, vec in zip(all_words, vectors):
        embeddings[word] = [round(float(v), 4) for v in vec]

    # Save compressed
    data = json.dumps(embeddings, separators=(',', ':'))
    with gzip.open(out_file, 'wt', encoding='utf-8') as f:
        f.write(data)
    print(f"Saved {len(embeddings)} embeddings to {out_file} ({os.path.getsize(out_file) / 1024 / 1024:.1f} MB)")

    # Also save the word list (for input validation)
    with open(wordlist_file, 'w') as f:
        json.dump(sorted(all_words), f)
    print(f"Saved word list ({len(all_words)} words) to {wordlist_file}")

    # Also save an uncompressed version for the browser
    out_uncompressed = root / 'data' / 'embeddings.json'
    with open(out_uncompressed, 'w') as f:
        f.write(data)
    print(f"Saved uncompressed embeddings to {out_uncompressed} ({os.path.getsize(out_uncompressed) / 1024 / 1024:.1f} MB)")

if __name__ == '__main__':
    main()
