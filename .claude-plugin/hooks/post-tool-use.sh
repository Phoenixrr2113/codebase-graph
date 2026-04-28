#!/bin/sh
# Post-Tool-Use hook for Claude Code: trigger an incremental reindex
# after edit-heavy turns.
#
# Install: copy or symlink to ~/.claude/hooks/post-tool-use.sh, or
# reference from .claude/settings.json's hooks block.
#
# This hook is idempotent and safe to re-run. It exits 0 quickly when
# there's nothing to do (no edits since last index).

set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LAST_INDEX_MARKER="$PROJECT_ROOT/.codegraph/last-index"
EDIT_THRESHOLD=5  # only reindex after 5+ edited files since last reindex

# Read tool name from environment (Claude Code sets this)
if [ -z "$CLAUDE_HOOK_TOOL_NAME" ]; then
  exit 0
fi

# Only fire on edit tools
case "$CLAUDE_HOOK_TOOL_NAME" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

# Count edits since last reindex
if [ -f "$LAST_INDEX_MARKER" ]; then
  EDITED=$(find "$PROJECT_ROOT" -newer "$LAST_INDEX_MARKER" -type f \
    \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.md" \) \
    -not -path "*/node_modules/*" \
    -not -path "*/.git/*" \
    -not -path "*/dist/*" \
    -not -path "*/.codegraph/*" 2>/dev/null | wc -l | tr -d ' ')
else
  EDITED=$EDIT_THRESHOLD  # force reindex if no marker exists
fi

if [ "$EDITED" -lt "$EDIT_THRESHOLD" ]; then
  exit 0
fi

# Trigger incremental extract via the codegraph CLI in the background.
# Don't block the agent; the extract runs async. The extract command is
# inherently incremental — it skips files whose hashes haven't changed.
mkdir -p "$PROJECT_ROOT/.codegraph"
(
  cd "$PROJECT_ROOT" && \
  pnpm --filter @codegraph/cli start extract "$PROJECT_ROOT" >/dev/null 2>&1
  touch "$LAST_INDEX_MARKER"
) &
exit 0
