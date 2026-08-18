# Launch Checklist

Use this checklist after the publication baseline pull request is green and merged.

## Repository baseline

- [ ] CI repository check passes on the reviewed commit.
- [ ] The exact npm tarball passes consumer smoke tests on Linux, macOS, and Windows.
- [ ] CodeQL analysis passes.
- [ ] Production audit has no high or critical findings.
- [ ] Community files, issue forms, security policy, license, and developer access links render on GitHub.
- [ ] Discussions, private vulnerability reporting, vulnerability alerts, automated security fixes, and supported secret protection are enabled.
- [ ] `main` requires the verified CI and CodeQL checks, pull requests, and resolved conversations.

## npm bootstrap

- [ ] `npm whoami` confirms the intended account without exposing credentials.
- [ ] `codegraph-mcp@0.1.0` is still unpublished.
- [ ] The full release gate passes from a clean checkout of the reviewed commit.
- [ ] `packages/npm-package/dist` is published with public access using the intended npm owner account.
- [ ] Registry metadata reports the expected name, version, MIT license, repository, and binary.
- [ ] A fresh registry install reports version `0.1.0` and completes the four-tool MCP handshake.
- [ ] npm trusted publishing is configured for `Phoenixrr2113/codebase-graph`, `release.yml`, and the `npm` environment.
- [ ] A later trusted release includes npm provenance.
- [ ] Token-based publication is disabled after a trusted release succeeds.

## Public documentation

- [ ] README links to the npm package.
- [ ] npm version and weekly-download badges both return HTTP 200.
- [ ] Source, live application, issues, Discussions, contribution, security, and license links work.
- [ ] A fresh user can follow the npm MCP client configuration without a source checkout.
- [ ] The release operator guide matches the actual tag workflow.

## Release evidence

- [ ] GitHub release `v0.1.0` exists with the npm tarball and SHA-256 checksum.
- [ ] The release verification document records the merged commit, UTC timestamps, gate results, package size, npm integrity, provenance, and GitHub settings.
- [ ] A fresh clone passes install, audit, lint, typecheck, tests, build, MCPB build, and release checks.

## Distribution follow-up

- [ ] Submit to relevant MCP directories only after the registry artifact is verified.
- [ ] Publish a short demo using the exact public install path.
- [ ] Respond to security reports privately and issues publicly.
- [ ] Review npm weekly downloads, GitHub clones, stars, issues, and contributors once a week for the first month.

Use npm weekly downloads as the primary install signal. Treat GitHub stars as interest, not usage. Do not add pricing, licensing, or a hosted tier until observed demand supports that decision.
