# CodeGraph Competitive Benchmark Plan

## Goal
Run CodeGraph's search against industry-standard code retrieval benchmarks and compare against state-of-the-art models. Use results for landing page + credibility.

## Status: IN PROGRESS

---

## Step 1: CoIR Benchmark (Primary) — ACL 2025

**What:** 10 code retrieval datasets, 8 tasks, ~2M docs. Same framework as MTEB/BEIR.
**Why:** Most comprehensive, most recent, industry standard. Leaderboard on MTEB.
**Install:** `pip install coir-eval`

### Current leaderboard (nDCG@10 avg):
| Model | Avg | Type |
|-------|-----|------|
| Voyage-Code-002 | 56.26 | Proprietary API |
| E5-Mistral (7B) | 55.18 | Open source |
| BGE-M3 (567M) | ~50 | Open source |
| E5-Base (110M) | 50.90 | Open source |
| OpenAI-Ada-002 | ~48 | Proprietary API |

### What we need to build:
1. **Python wrapper** that implements CoIR's model API:
   ```python
   class CodeGraphRetriever:
       def encode_queries(self, queries, batch_size) -> np.ndarray
       def encode_corpus(self, corpus, batch_size) -> np.ndarray
   ```
2. Two modes:
   - **Embedding-only mode**: Just use Voyage code-3 embeddings (apples-to-apples comparison with other embedding models)
   - **Full pipeline mode**: Embedding + reranker (Jina v3) — this is what users actually get

### Tasks to run (start with most relevant):
| Task | Relevance | Description |
|------|-----------|-------------|
| `cosqa` | ⭐⭐⭐ | NL query → code search (exactly what we do) |
| `codesearchnet` | ⭐⭐⭐ | NL query → code search, 6 languages |
| `codesearchnet-ccr` | ⭐⭐⭐ | Cross-context code retrieval |
| `stackoverflow-qa` | ⭐⭐ | Q&A retrieval |
| `codetrans-dl` | ⭐⭐ | Code translation retrieval |
| `codefeedback-st` | ⭐ | Single-turn code feedback |
| `codefeedback-mt` | ⭐ | Multi-turn code feedback |
| `apps` | ⭐ | Programming problem retrieval |
| `codetrans-contest` | ⭐ | Contest code translation |
| `synthetic-text2sql` | ⭐ | Text to SQL |

### Implementation steps:
1. [ ] Install `coir-eval` in a Python virtualenv
2. [ ] Build `CodeGraphRetriever` wrapper class
   - `encode_queries`: calls Voyage code-3 API for query embeddings
   - `encode_corpus`: calls Voyage code-3 API for document embeddings
   - NOTE: CoIR only tests the embedding model, not the full pipeline
3. [ ] Run on `cosqa` first (smallest, most relevant) — verify scores match published Voyage numbers
4. [ ] Run on `codesearchnet` and `codesearchnet-ccr`
5. [ ] Run full 10-task suite
6. [ ] Compare against published leaderboard numbers

### Expected results:
- Voyage-Code-002 scored 56.26 avg on CoIR
- We use Voyage code-3 which is newer — should match or beat
- The reranker adds 10-15% on top (from our benchmarks), but CoIR doesn't test reranking

---

## Step 2: CodeSearchNet Benchmark (Secondary)

**What:** 99 NL queries with human-annotated relevance scores across 6 languages
**Why:** The OG code search benchmark. Widely recognized. Good for credibility.
**Dataset:** https://github.com/github/CodeSearchNet
**Metric:** NDCG (Normalized Discounted Cumulative Gain)

### Implementation steps:
1. [ ] Download CodeSearchNet evaluation dataset (99 queries + relevance annotations)
2. [ ] Index the CodeSearchNet corpus into FalkorDB
3. [ ] Run queries through enrichedSearchV2 (full pipeline)
4. [ ] Compute NDCG against human annotations
5. [ ] Compare against published baselines (NBoW, CNN, RNN, CodeBERT)

### Key difference from CoIR:
This tests our FULL pipeline (embedding + graph + reranker), not just embeddings.
We index the code into our graph, then search with enrichedSearchV2.

---

## Step 3: MCP Tool-to-Tool Comparison (Custom)

**What:** Head-to-head against actual MCP code search tools on real repos
**Why:** Landing page comparison. Users want to know "is CodeGraph better than X?"

### Competitors:
| Tool | Install | What it does |
|------|---------|-------------|
| Claude Context (Zilliz) | npm | BM25 + vector (Milvus) |
| Greptile MCP | npx | Cloud code search |
| Sourcegraph MCP | npx | Universal code search |
| Stellaris MCP | npm | AST + semantic |
| Repomix | npm | Context packing (baseline) |

### Test repos:
| Repo | Language | Size | Why |
|------|----------|------|-----|
| Cal.com | TypeScript | ~500 files | Greptile uses this |
| Sentry | Python | ~2000 files | Real-world scale |
| Our codebase | TypeScript | ~340 files | We know ground truth |

### Methodology:
1. [ ] Write 30 queries per repo (10 exact, 10 conceptual, 10 multi-hop)
2. [ ] Create ground truth (expected results per query, human-verified)
3. [ ] Build eval harness that:
   - Configures each MCP server
   - Indexes the repo (if needed)
   - Runs all queries
   - Collects results + latency
   - Computes MRR, S@1, S@5, nDCG@10
4. [ ] Run each tool on each repo
5. [ ] Publish results table

### Expected timeline:
- Step 1 (CoIR): ~2 hours (mostly waiting for API calls)
- Step 2 (CodeSearchNet): ~4 hours (need to index corpus)
- Step 3 (MCP comparison): ~8 hours (setup each tool, create ground truth)

---

## Step 4: Publish Results

### Landing page:
- Add benchmark comparison section with scores table
- Show CodeGraph vs industry baselines
- Link to open-source eval script + dataset

### Blog post:
- Methodology explanation
- Results analysis
- What we learned
- How to reproduce

### Open source:
- Publish eval harness on GitHub
- Publish our benchmark queries + ground truth
- Make it easy for others to add their tool

---

## Files created during this benchmark:

```
scripts/
  benchmark-coir/           # CoIR evaluation
    setup.sh                # virtualenv + pip install
    codegraph_retriever.py  # Our model wrapper
    run_coir.py             # Run full benchmark
    results/                # Output JSONs
  benchmark-codesearchnet/  # CodeSearchNet evaluation
    index_corpus.ts         # Index CSN into FalkorDB
    run_eval.ts             # Run queries, compute NDCG
    results/
  benchmark-mcp/            # MCP tool comparison
    queries/                # Per-repo query files
    ground-truth/           # Expected results
    eval_harness.ts         # Runs any MCP tool
    results/
```
