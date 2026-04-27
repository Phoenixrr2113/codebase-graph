#!/bin/sh
# Pre-Compact hook for Claude Code: ensure a final reindex before the
# context is compacted, so the next session sees fresh state.

set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LAST_INDEX_MARKER="$PROJECT_ROOT/.codegraph/last-index"

# Run synchronously this time — pre-compact is the right moment to wait.
mkdir -p "$PROJECT_ROOT/.codegraph"
(
  cd "$PROJECT_ROOT" && \
  pnpm --filter @codegraph/cli start reindex --mode=incremental >/dev/null 2>&1 || true
)
touch "$LAST_INDEX_MARKER"
exit 0
