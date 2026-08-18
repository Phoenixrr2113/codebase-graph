# Publication Verification Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lint, type-check, tests, integration checks, and builds report the repository's real state without suppressions or missed tests.

**Architecture:** Fix the known application type boundaries, install a supported ESLint 9 flat configuration, remove invalid assets, give package tests a shared configuration, and repair the PDF loader against the installed typed API. Root commands then aggregate the same checks CI will run.

**Tech Stack:** TypeScript 5, Next.js 16, React 19, ESLint 9, Vitest 3, Cytoscape 3, pdf-parse 2

**Spec:** `docs/superpowers/specs/2026-08-18-publication-ready-baseline-design.md`

## Global Constraints

- No `any`, ignored TypeScript build errors, or swallowed exceptions.
- Node 22 is the local and CI verification runtime.
- Test commands must either discover owned tests or explicitly identify that a package owns none.
- The website must build without downloading fonts from the network.
- Existing user-facing behavior is preserved while boundary data is narrowed safely.

---

### Task 1: Type the dashboard data boundaries

**Files:**
- Modify: `apps/web/components/dashboard/entity-detail.tsx`
- Modify: `apps/web/components/dashboard/query-panel.tsx`

**Interfaces:**
- Consumes: `Record<string, unknown>` API and graph properties
- Produces: render-safe scalar guards with no `unknown` React children

- [ ] **Step 1: Verify the current type failures**

Run: `pnpm --filter codegraph-landing exec tsc --noEmit -p tsconfig.json`

Expected: failures in `entity-detail.tsx` and `query-panel.tsx` where unknown
properties are used as JSX conditions or children.

- [ ] **Step 2: Add render-safe scalar helpers to QueryPanel**

Add these non-exported helpers above the component:

```ts
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
    ? value
    : []
}
```

Normalize `routedTo`, `iterations`, `queries`, and `total` before JSX. Render
only the normalized values. Normalize each result's `nodeType` with
`asString(r.nodeType) ?? r.type`.

- [ ] **Step 3: Narrow entity class properties explicitly**

In `EntityDetail`, derive:

```ts
const isAbstract = props.isAbstract === true
const extendsName = typeof props.extends === 'string' ? props.extends : undefined
```

Use these variables in JSX instead of using unknown property values as
conditions.

- [ ] **Step 4: Verify this boundary is clean**

Run: `pnpm --filter codegraph-landing exec tsc --noEmit -p tsconfig.json`

Expected: no errors from `entity-detail.tsx` or `query-panel.tsx`; Cytoscape
errors remain until Task 2.

### Task 2: Type Cytoscape configuration once

**Files:**
- Modify: `apps/web/lib/cytoscape-config.ts`
- Modify: `apps/web/components/dashboard/graph-canvas.tsx`
- Modify: `apps/web/components/landing/hero-graph-demo.tsx`

**Interfaces:**
- Consumes: Cytoscape's installed `StylesheetJson` and `LayoutOptions` types
- Produces: `cytoscapeStylesheet: cytoscape.StylesheetJson` and `LAYOUT_OPTIONS: Record<LayoutName, cytoscape.LayoutOptions>`

- [ ] **Step 1: Type the shared exports at their source**

Add `import type cytoscape from 'cytoscape'` to the config module. Give
`nodeStyle` and `edgeStyle` explicit `cytoscape.StylesheetJsonBlock` return
types, type `cytoscapeStylesheet` as `cytoscape.StylesheetJson`, and define:

```ts
export const LAYOUT_OPTIONS: Record<LayoutName, cytoscape.LayoutOptions> = {
  cose: { name: 'cose', /* retain existing options */ },
  concentric: { name: 'concentric', /* retain existing options */ },
  breadthfirst: { name: 'breadthfirst', /* retain existing options */ },
}
```

Replace the generic `extra` style argument with a Cytoscape edge-style type
accepted by `StylesheetJsonBlock`; do not cast through `unknown`.

- [ ] **Step 2: Remove consumer casts**

Pass `cytoscapeStylesheet` and `LAYOUT_OPTIONS[...]` directly to Cytoscape in
both components. The preset hero layout is already a valid literal and should
use `satisfies cytoscape.PresetLayoutOptions` if inference needs help.

- [ ] **Step 3: Verify all landing types**

Run: `pnpm --filter codegraph-landing exec tsc --noEmit -p tsconfig.json`

Expected: exit 0 with no TypeScript errors.

### Task 3: Restore real Next.js lint and build gates

**Files:**
- Create: `apps/web/eslint.config.mjs`
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.mjs`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Next.js 16 flat-config exports
- Produces: `pnpm --filter codegraph-landing lint`, real Next type validation

- [ ] **Step 1: Install the matching lint toolchain**

Run:

```bash
pnpm --filter codegraph-landing add -D eslint@^9 eslint-config-next@16.3.1
```

- [ ] **Step 2: Add the flat configuration**

Create `apps/web/eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
])
```

- [ ] **Step 3: Remove the TypeScript suppression**

Delete the `typescript.ignoreBuildErrors` block from `next.config.mjs`. Retain
the existing image behavior.

- [ ] **Step 4: Run lint and fix every reported source violation**

Run: `pnpm --filter codegraph-landing lint`

Expected before fixes: non-zero with concrete source locations. Fix the source
violations without blanket rule disables. Run the command again and expect exit
0.

- [ ] **Step 5: Verify the production build performs type validation**

Run: `pnpm --filter codegraph-landing build`

Expected: exit 0 and no `Skipping validation of types` message.

### Task 4: Remove invalid font assets without network coupling

**Files:**
- Modify: `apps/web/app/globals.css`
- Delete: `apps/web/public/fonts/GeistVF.woff2`
- Delete: `apps/web/public/fonts/GeistMonoVF.woff2`
- Delete: `apps/web/public/fonts/JetBrainsMonoVF.woff2`

**Interfaces:**
- Consumes: browser system font stacks
- Produces: valid offline CSS with no corrupted asset requests

- [ ] **Step 1: Prove the current assets are not fonts**

Run: `file apps/web/public/fonts/*.woff2`

Expected: each file is reported as HTML, not Web Open Font Format data.

- [ ] **Step 2: Remove the three `@font-face` blocks and tracked files**

Change the theme font variables to:

```css
--font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
```

Delete the three invalid files. Do not fetch replacements during the build.

- [ ] **Step 3: Verify there are no dead font references**

Run:

```bash
rg -n 'Geist|JetBrainsMono|/fonts/' apps/web
pnpm --filter codegraph-landing build
```

Expected: the search has no active source references and the build exits 0.

### Task 5: Make every package test discover its owned files

**Files:**
- Create: `vitest.package.config.ts`
- Modify: `packages/logger/package.json`
- Modify: `packages/plugin-common/package.json`
- Modify: `packages/plugin-go/package.json`
- Modify: `packages/plugin-languages/package.json`
- Modify: `packages/plugin-python/package.json`
- Modify: `packages/plugin-rust/package.json`
- Modify: `packages/plugin-typescript/package.json`

**Interfaces:**
- Consumes: package-local `--root .`
- Produces: shared package test discovery config

- [ ] **Step 1: Add a package-scoped Vitest config**

Create `vitest.package.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts', '__tests__/**/*.test.ts'],
    passWithNoTests: false,
  },
})
```

- [ ] **Step 2: Point packages without local configs at the shared contract**

Set each listed package's test script to:

```json
"test": "vitest run --root . --config ../../vitest.package.config.ts"
```

- [ ] **Step 3: Verify each suite reports a non-zero test count**

Run each package with `pnpm --filter <package-name> test`. Expected counts are
at least: logger 10, plugin-common 3 files, Go 1 file, languages 3 files, Python
1 file, Rust 1 file, and TypeScript 2 files. A zero-file suite is a failure.

- [ ] **Step 4: Fix discovered test failures at the behavior boundary**

If logger output tests fail, preserve the MCP rule that all logger output uses
stderr and update assertions to spy on `console.error` or `process.stderr.write`
according to the branch under test. Do not change production logging to stdout.

### Task 6: Repair real PDF extraction

**Files:**
- Modify: `packages/plugin-nlp/src/loaders/pdf.ts`
- Modify: `packages/plugin-nlp/src/__tests__/loaders.test.ts`

**Interfaces:**
- Consumes: `PDFParse` from `pdf-parse` 2.4.5
- Produces: `PDFLoader.extract(input): Promise<LoaderResult>` with typed text, title, and page count

- [ ] **Step 1: Replace the skipped test with a real PDF fixture**

Store a minimal one-page PDF fixture as a base64 string in the test, decode it
with `Buffer.from(fixture, 'base64')`, and assert:

```ts
const result = await PDFLoader.extract(pdfBuffer)
expect(result.text).toContain('CodeGraph PDF fixture')
expect(result.metadata.format).toBe('pdf')
expect(result.metadata.pageCount).toBe(1)
```

- [ ] **Step 2: Run the test and verify the old callable API fails**

Run:

```bash
pnpm --filter @codegraph/plugin-nlp exec vitest run src/__tests__/loaders.test.ts
```

Expected: failure showing the imported module is not callable.

- [ ] **Step 3: Implement the typed pdf-parse 2 API**

Use the installed API and always release parser resources:

```ts
const { PDFParse } = await import('pdf-parse')
const parser = new PDFParse({ data: buffer })

try {
  const [textResult, infoResult] = await Promise.all([
    parser.getText(),
    parser.getInfo(),
  ])
  const title = typeof infoResult.info?.Title === 'string'
    ? infoResult.info.Title
    : undefined

  return {
    text: textResult.text,
    metadata: {
      format: 'pdf',
      pageCount: textResult.total,
      ...(title ? { title } : {}),
    },
  }
} finally {
  await parser.destroy()
}
```

- [ ] **Step 4: Verify PDF and URL ingestion suites**

Run:

```bash
pnpm --filter @codegraph/plugin-nlp exec vitest run src/__tests__/loaders.test.ts
pnpm --filter @codegraph/core exec vitest run src/__tests__/url-ingestion.test.ts src/__tests__/document-ingestion.test.ts
```

Expected: all tests pass and no `pdfParse is not a function` warning appears.

### Task 7: Define and run the truthful root contracts

**Files:**
- Modify: `package.json`
- Modify: `turbo.json`
- Modify: `apps/web/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/graph/package.json`
- Modify: `packages/logger/package.json`
- Modify: `packages/plugin-nlp/package.json`
- Modify: `packages/types/package.json`

**Interfaces:**
- Consumes: package scripts repaired in Tasks 1 through 6
- Produces: root `typecheck` and deterministic lint/test/build contracts

- [ ] **Step 1: Replace the narrow typecheck script**

Set root scripts to:

```json
"typecheck": "turbo run typecheck",
"lint": "turbo run lint",
"test": "turbo run test",
"build": "turbo run build"
```

Add `"typecheck": "tsc --noEmit"` to the landing, core, graph, logger,
plugin-nlp, and types manifests. All other TypeScript workspaces already expose
that script. The npm distribution workspace contains JavaScript build tooling
and is verified by its Vitest and release checks instead.

- [ ] **Step 2: Add Turbo's typecheck task**

Add:

```json
"typecheck": {
  "dependsOn": ["^typecheck"],
  "outputs": []
}
```

Keep lint dependent on upstream builds only where generated declarations are
required.

- [ ] **Step 3: Run the repository gate uncached**

Run:

```bash
pnpm turbo run lint --force
pnpm turbo run typecheck --force
pnpm turbo run test --force
pnpm turbo run build --force
```

Expected: all commands exit 0, every owned test suite reports tests, and the
landing build does not skip type validation.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml turbo.json vitest.package.config.ts apps/web packages/core/package.json packages/graph/package.json packages/logger/package.json packages/plugin-common/package.json packages/plugin-go/package.json packages/plugin-languages/package.json packages/plugin-nlp packages/plugin-python/package.json packages/plugin-rust/package.json packages/plugin-typescript/package.json packages/types/package.json
git commit -m "fix: make repository verification truthful"
```
