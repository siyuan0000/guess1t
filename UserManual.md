# guess1t — 用户手册

## 快速启动

**无需安装任何依赖**，这是一个纯前端的单页应用。

```bash
# 1. 克隆项目
git clone <repo-url>
cd guess1t

# 2. 启动一个静态文件服务器（任选其一）

# 用 Python
python3 -m http.server 8080

# 或用 Node.js (npx)
npx serve .

# 或用 VS Code Live Server 插件
```

> 注意：直接用浏览器打开 `index.html`（`file://` 协议）可能因 CORS 限制无法加载 `data/` 目录下的 JSON 文件，**必须通过 HTTP 服务器访问**。

然后在浏览器打开 `http://localhost:8080` 即可。

## 项目结构

```
guess1t/
├── index.html                # 入口页面 + 模态框
├── style.css                 # 暗色极简风格样式
├── game.js                   # 全部游戏逻辑
├── data/
│   ├── words.json            # 词库（~500 GRE 词 + 释义）
│   └── embeddings_web.json   # 预计算词向量（~2 万词）
├── scripts/
│   ├── generate_embeddings.py   # 生成原始词向量
│   └── optimize_embeddings.py   # PCA 降维 + 量化
├── prd.md                    # 产品需求文档 v1
├── prd-v1.1.md               # 需求补充 v1.1
└── UserManual.md             # 本文件
```

## 玩法说明

| 规则 | 说明 |
|---|---|
| **目标** | 猜测系统选中的隐藏 GRE 词汇 |
| **次数** | 每局 10 次尝试 |
| **反馈** | 每次猜词后返回 `0.00 ~ 1.00` 的语义相似度 |
| **获胜** | 猜中目标词（完全匹配，大小写不敏感） |
| **失败** | 10 次用完未猜中，显示答案 |

### 相似度分数的含义

| 分数范围 | 含义 |
|---|---|
| 0.80 - 1.00 | 近义词，语义非常接近 |
| 0.50 - 0.79 | 相关语义，方向大致正确 |
| 0.20 - 0.49 | 弱相关，可能领域偏了 |
| 0.00 - 0.19 | 几乎无关 |

### 不在数据库中的词

输入不在预载词库（~2 万常见词）中、但 ≥3 个字母的纯英文单词时：

- 系统**接受**该词（消耗 1 次机会）
- 分数列显示 **`—`**（无法计算相似度）
- 下方显示小字提示 `Word not in semantic database`

无效输入（少于 3 字母、含数字/符号）会被拒绝，不消耗机会。猜中目标词（完全匹配）始终有效，不受数据库限制。

### 特殊操作

| 操作 | 说明 |
|---|---|
| **I give up** | 投降，直接结束并显示答案（需点击确认） |
| **Try again** | 结课后可开始新一局练习（随机选词，刷新后丢失） |

## 重新生成词向量

如果需要重新生成嵌入向量：

```bash
cd scripts
pip install sentence-transformers scikit-learn numpy
python generate_embeddings.py    # 生成原始向量 → data/embeddings.json
python optimize_embeddings.py     # PCA 降维 → data/embeddings_web.json
```
