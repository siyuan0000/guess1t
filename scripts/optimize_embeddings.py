"""
Optimize embeddings for web delivery.
Reduce dimensionality via PCA and quantize to int8 for small file size.
"""
import json, gzip, os, sys
import numpy as np
from pathlib import Path
from sklearn.decomposition import PCA

def main():
    root = Path(__file__).resolve().parent.parent
    emb_file = root / 'data' / 'embeddings.json'
    out_file = root / 'data' / 'embeddings_web.json'

    print("Loading embeddings...")
    with open(emb_file) as f:
        data = json.load(f)

    words = sorted(data.keys())
    vectors = np.array([data[w] for w in words], dtype=np.float32)
    print(f"Original: {vectors.shape} ({vectors.nbytes / 1024 / 1024:.1f} MB)")

    # PCA to 64 dimensions (captures most variance for cosine similarity)
    n_components = 128
    print(f"Reducing to {n_components} dimensions via PCA...")
    pca = PCA(n_components=n_components)
    reduced = pca.fit_transform(vectors)
    print(f"Explained variance: {pca.explained_variance_ratio_.sum():.3f}")

    # Re-normalize
    norms = np.linalg.norm(reduced, axis=1, keepdims=True)
    reduced = reduced / norms

    # Quantize to int8 (-127 to 127) to save space
    # Scale: multiply by 127
    quantized = np.clip(np.round(reduced * 127), -127, 127).astype(np.int8)

    # Build compact output
    output = {
        "words": words,
        "dim": n_components,
        "vectors": quantized.tolist()
    }

    with open(out_file, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    size_mb = os.path.getsize(out_file) / 1024 / 1024
    print(f"Saved {len(words)} words, {n_components}d int8 vectors to {out_file} ({size_mb:.1f} MB)")

    # Also create gzipped version
    gz_file = root / 'data' / 'embeddings_web.json.gz'
    import gzip
    with open(out_file, 'rb') as f_in:
        with gzip.open(gz_file, 'wb') as f_out:
            f_out.write(f_in.read())
    gz_size = os.path.getsize(gz_file) / 1024 / 1024
    print(f"Gzipped: {gz_size:.1f} MB")

if __name__ == '__main__':
    main()
