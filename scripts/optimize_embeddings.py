"""
Optimize embeddings for web delivery.
Reduce dimensionality via PCA and quantize to int8 for small file size.
"""
import json, gzip, os, sys
import numpy as np
import joblib  # 【新增】用于保存 PCA 模型
from pathlib import Path
from sklearn.decomposition import PCA

def main():
    root = Path(__file__).resolve().parent.parent
    emb_file = root / 'data' / 'embeddings.json'
    out_file = root / 'data' / 'embeddings_web.json'
    pca_model_file = root / 'data' / 'pca_model.joblib' # 【新增】定义 PCA 模型的保存路径

    print("Loading embeddings...")
    with open(emb_file) as f:
        data = json.load(f)

    words = sorted(data.keys())
    vectors = np.array([data[w] for w in words], dtype=np.float32)
    print(f"Original: {vectors.shape} ({vectors.nbytes / 1024 / 1024:.1f} MB)")

    # PCA to 48 dimensions (captures most variance for cosine similarity)
    n_components = 64
    print(f"Reducing to {n_components} dimensions via PCA...")
    pca = PCA(n_components=n_components)
    reduced = pca.fit_transform(vectors)
    print(f"Explained variance: {pca.explained_variance_ratio_.sum():.3f}")

    # 【新增】保存训练好的 PCA 模型，以便后端推理时对 OOV 新词使用相同的降维规则
    joblib.dump(pca, pca_model_file)
    print(f"Saved PCA model to {pca_model_file}")

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
    # 注意：顶部的 import gzip 已经移动到文件头部，这里不需要再次 import
    with open(out_file, 'rb') as f_in:
        with gzip.open(gz_file, 'wb') as f_out:
            f_out.write(f_in.read())
    gz_size = os.path.getsize(gz_file) / 1024 / 1024
    print(f"Gzipped: {gz_size:.1f} MB")

if __name__ == '__main__':
    main()