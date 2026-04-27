# CodeGraph Claude Code hooks

Two sample hooks that keep the CodeGraph index up-to-date as you code with
Claude Code.

## post-tool-use.sh

Triggers an incremental reindex (in the background) after Claude has used an
edit tool 5+ times since the last reindex. Idempotent.

## pre-compact.sh

Triggers a synchronous incremental reindex right before Claude's context is
compacted, so the next session sees fresh state.

## Installation

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": ".claude-plugin/hooks/post-tool-use.sh",
    "PreCompact": ".claude-plugin/hooks/pre-compact.sh"
  }
}
```

Or copy the scripts to `~/.claude/hooks/` and reference them by absolute path.

The hooks call `pnpm --filter @codegraph/cli start reindex --mode=incremental`
— make sure pnpm is on PATH for the shell Claude Code uses.

## Customizing

Edit `EDIT_THRESHOLD` in `post-tool-use.sh` to control how many edits trigger a
reindex (default: 5).
