# Distribution and Release Setup

This is the operator guide for the public `@agntk/codegraph-mcp` npm package and the platform-local MCPB desktop extension. The canonical source is [Phoenixrr2113/codebase-graph](https://github.com/Phoenixrr2113/codebase-graph).

## Release model

- `main` is the source of truth.
- CI validates the repository and tests one exact npm tarball on Linux, macOS, and Windows. Linux x64 and Apple silicon macOS also exercise a database-backed MCP call through embedded FalkorDBLite; the macOS job installs the module's required Homebrew `libomp` and `openssl@3` libraries first.
- The manual authenticated `0.1.0` npm bootstrap is complete. A one-time Release workflow run still verifies the registry package and creates its annotated tag and GitHub release.
- Later annotated `vX.Y.Z` tags publish through npm trusted publishing with GitHub Actions OIDC.
- The release workflow publishes or finalizes only after the installed-package matrix passes on Linux x64, Apple silicon macOS, and Windows x64.
- The optional local-provider lane runs on Linux x64 with an empty model cache and proves download progress plus a usable 768-dimension vector index.
- MCPB artifacts are built for the current runner platform. They are not claimed to be portable across operating systems.

## Prerequisites

- Node.js 22
- The pnpm version declared in the root `package.json`
- npm account access for the one-time bootstrap
- Repository administration access for the `npm` environment and security settings

Do not create an npm automation token for this project. The steady-state workflow uses a short-lived OIDC identity.

## Completed manual `0.1.0` bootstrap

Version `0.1.0` is public in the npm registry. The commands below preserve the completed manual bootstrap procedure for reference. The annotated tag and GitHub release remain owned by the separate bootstrap workflow.

The procedure used a clean checkout of the reviewed commit and confirmed authentication without displaying configuration or token data:

```bash
git status --short
git rev-parse HEAD
npm whoami
npm view @agntk/codegraph-mcp version --json
```

The status output had to be empty. The full 40-character commit SHA was saved as `BOOTSTRAP_COMMIT`; it identifies the reviewed source used to build the registry package. An npm `E404` response was expected before the first publication. The full local gate was then run:

```bash
pnpm install --frozen-lockfile
pnpm audit:prod
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docker:db
pnpm test:integration
pnpm test:scripts
pnpm build:mcpb
pnpm release:check
```

Only the exact tarball created and verified by `pnpm release:check` was published:

```bash
npm publish tmp/release/agntk-codegraph-mcp-0.1.0.tgz --access public
```

The authenticated bootstrap could not use trusted-publishing provenance because the npm package did not exist yet. Later releases use the trusted publisher and receive automatic provenance from npm.

For future manual recovery, if `npm whoami` fails, run `npm login` in your terminal and repeat the identity check. Never paste an npm token into GitHub, a shell command, an issue, or a chat.

## Verify the bootstrap package

The sole canonical command for creating and validating the publishable artifact is:

```bash
pnpm pack:npm
```

`pnpm release:check` starts with that command, then boots the source API, audits the consumer dependency tree, and runs the basic smoke against the exact generated tarball.

Installed runtime defaults are part of the package contract. `API_PORT` defaults to `3001`. `CODEGRAPH_DATA_DIR` defaults to `~/.codegraph`, with MCP configuration at `~/.codegraph/mcp-context.json`; embedded database files separately default to `<current working directory>/.codegraph/falkordb`. Without an explicit embedding provider, CodeGraph selects Voyage when `VOYAGE_API_KEY` is set, then OpenRouter when `OPENROUTER_API_KEY` is set, then local when neither key is set. Without an explicit database driver, a configured external host selects FalkorDB; otherwise Linux x64 and Apple silicon macOS with the required native libraries default to embedded FalkorDBLite when its package loads, while other platforms and failed embedded loads default to external FalkorDB.

From the repository root:

```bash
npm view @agntk/codegraph-mcp@0.1.0 name version license repository bin dist --json
mkdir -p tmp/registry
npm pack @agntk/codegraph-mcp@0.1.0 --pack-destination tmp/registry
node scripts/release/smoke-package.mjs \
  --tarball tmp/registry/agntk-codegraph-mcp-0.1.0.tgz \
  --version 0.1.0
```

The basic smoke creates a temporary consumer and installs the exact tarball without lifecycle scripts. Its 25 runtime assertions cover the matching CLI version, dashboard health and built assets, empty projects and embedding coverage, setup status, Browse roots, MCP initialization, the exact five-tool surface (`analyze`, `codebase`, `knowledge`, `query`, and `search`), project configuration, indexing, graph queries, restart persistence, concurrent MCP and dashboard access through one embedded server, shutdown order, persisted data, and the tarball SHA-256.

Release CI runs this installed artifact with embedded FalkorDBLite on Linux x64 and Apple silicon macOS. The macOS job first runs `brew install libomp openssl@3`. The Windows x64 job verifies the exact external FalkorDB guidance without attempting embedded startup. A clean-consumer local tarball proof verifies the documented invocation shapes: bare `npx -y @agntk/codegraph-mcp` selects the MCP bin, while `npx -y -p @agntk/codegraph-mcp codegraph-dashboard` selects the dashboard bin. Both forms also resolve and boot from the public npm registry.

After the registry smoke passes, create the GitHub `npm` environment for later tag releases. In GitHub Actions, open the Release workflow, choose **Run workflow** from `main`, enter `0.1.0` as `bootstrap_version`, and enter the saved full SHA as `bootstrap_commit`. This one-time path accepts only the `0.1.0` package version, checks out that exact commit, requires it to be reachable from `main`, reruns the full release gate, confirms that the exact version already exists on npm, requires the registry tarball to be byte-for-byte identical to the artifact rebuilt from `bootstrap_commit`, creates the annotated `v0.1.0` tag on that commit, and publishes the tarball plus checksum as a GitHub release. It does not use the `npm` environment, request an OIDC token, or call `npm publish` again.

Do not push `v0.1.0` yourself after the manual npm publication. A normal tag-triggered release correctly requires its target version to be absent from the registry; the bootstrap workflow dispatch owns the initial tag and avoids a duplicate publication attempt.

## Configure trusted publishing

The package now exists on npm. Open its package settings and add a GitHub Actions trusted publisher with:

| Field | Value |
| --- | --- |
| Owner | `Phoenixrr2113` |
| Repository | `codebase-graph` |
| Workflow filename | `release.yml` |
| Environment | `npm` |

In GitHub, create the `npm` environment with no deployment branch pattern broader than version tags. The release workflow already grants only `contents: write` and `id-token: write`.

After a trusted release succeeds, configure npm publishing access to require two-factor authentication and disallow token-based publication. The trusted publisher remains able to publish with OIDC.

See the [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for the current registry requirements.

## Publish later versions

Start from a clean, current `main`. Choose `patch`, `minor`, or `major` based on the compatibility change. This example creates the next patch commit and annotated tag:

```bash
cd packages/npm-package
npm version patch
cd ../..
git push origin HEAD
git push origin vX.Y.Z
```

Replace `X.Y.Z` with the version printed by `npm version`. Do not hand-edit the tag. The release preflight rejects a tag that does not exactly match the source package version, a lightweight tag, a prerelease version, a commit outside `main`, or a version that already exists on npm.

The workflow runs the repository gate, package gate, publication, bounded registry polling, registry smoke test, checksum generation, and GitHub release creation in that order.

## Recovery

- If tag validation, audit, tests, build, package validation, or package smoke fails before publication, fix the branch and create a new version commit and tag.
- If npm publication succeeds but registry verification or GitHub release creation fails, do not try to publish the same version again. Verify the existing registry artifact, fix the automation, and create the missing GitHub release manually or ship a new patch version.
- If the manual `0.1.0` publication succeeds but bootstrap finalization fails before the tag is created, fix the workflow and rerun it with `bootstrap_version` set to `0.1.0`. If the tag exists, do not rerun the bootstrap path; verify the registry artifact and create only the missing GitHub release.
- Do not unpublish a valid public release to reuse its version. npm versions are immutable release identifiers.
- If trusted publishing fails, confirm the npm owner, repository, workflow filename, and `npm` environment match exactly. Do not fall back to a long-lived token.

## MCPB artifact

Build and validate the desktop extension on the platform where it will be installed:

```bash
pnpm build:mcpb
```

The packed artifact is written to `packages/mcpb/dist.mcpb`. It includes locked native parser dependencies for the build platform and expects an external FalkorDB service, so publish separate assets only after testing them on their matching platform.
