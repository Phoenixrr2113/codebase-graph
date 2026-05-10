#!/bin/bash
# Run cgbench across all 4 OSS corpora pinned in corpora/code/manifest.json.
# Each run uses a fresh FalkorDB state, blocks on code embeddings (Phase 3),
# blocks on knowledge entity embeddings (synchronous extractAndStore), and
# only starts queries after both ingestion phases return.
set -e

cd /Users/randywilson/Desktop/codebase-graph/benchmarks/cgbench-v1

# Load env (.env contains OLLAMA_BASE_URL, OLLAMA_API_KEY, VOYAGE keys, etc.)
set -a
source ../../.env
set +a

OUT=/tmp/cgbench-v0.1.2-real
mkdir -p $OUT

run_corpus() {
  local CORPUS=$1
  local LANG=$2
  echo ""
  echo "================================================================"
  echo "=== $LANG ($CORPUS) — start: $(date '+%H:%M:%S')"
  echo "================================================================"

  # Clean slate per run — prevents any cross-run graph pollution.
  redis-cli -p 6380 FLUSHALL >/dev/null

  CGBENCH_FALKORDB_HOST=localhost CGBENCH_FALKORDB_PORT=6380 \
    npx tsx src/cli.ts run-all \
      --systems codegraph \
      --code-corpus corpora/code/$CORPUS \
      --knowledge-corpus corpora/knowledge \
      --questions-dir questions \
      --language $LANG \
      --results-dir $OUT/$LANG

  echo "=== $LANG done: $(date '+%H:%M:%S') ==="
}

run_corpus colinhacks-zod typescript
run_corpus psf-requests python
run_corpus go-chi-chi go
run_corpus clap-rs-clap rust

echo ""
echo "================================================================"
echo "ALL 4 CORPORA COMPLETE: $(date '+%H:%M:%S')"
echo "================================================================"
ls -la $OUT
