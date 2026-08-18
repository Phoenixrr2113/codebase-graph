# Contributing to CodeGraph

Thanks for helping improve CodeGraph. Bug reports, focused feature proposals, documentation fixes, and tested pull requests are welcome.

## Development setup

CodeGraph requires Node.js 22 and the pnpm version declared in the root `package.json` `packageManager` field. Corepack can install that exact pnpm release.

```bash
corepack enable
git clone https://github.com/Phoenixrr2113/codebase-graph.git
cd codebase-graph
pnpm install --frozen-lockfile
```

Fork the repository, create a short-lived branch from `main`, and keep each pull request focused on one outcome. Add or update tests before changing behavior.

## Required checks

Run these commands before opening a pull request:

```bash
pnpm audit:prod
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docker:db
pnpm test:integration
pnpm test:scripts
```

If a change affects the npm package, MCP server entry point, dependency graph, or release scripts, also run:

```bash
pnpm release:check
```

If a change affects the desktop extension, also run:

```bash
pnpm build:mcpb
```

Include the commands and results in the pull request. CI repeats the repository checks and tests the exact npm tarball on Linux, macOS, and Windows.

## Pull requests

- Link the issue or explain the problem the change solves.
- Keep public functions typed and validate data at system boundaries.
- Add tests for new behavior and regressions.
- Update user-facing documentation when commands, configuration, or behavior changes.
- Call out security, compatibility, migration, and release effects.
- Never commit generated `dist` directories, secrets, `.env` files, local `.codegraph` data, or benchmark output containing local paths.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues through the [private vulnerability reporting form](https://github.com/Phoenixrr2113/codebase-graph/security/advisories/new), not a public issue.
