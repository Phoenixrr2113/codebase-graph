import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dashboardDirectory = dirname(fileURLToPath(import.meta.url))

const ownedSources = [
  resolve(dashboardDirectory, '../../lib/references.ts'),
  resolve(dashboardDirectory, 'app-shell.tsx'),
  resolve(dashboardDirectory, 'graph-canvas.tsx'),
  resolve(dashboardDirectory, 'entity-detail.tsx'),
]

describe('dashboard node identity source guard', () => {
  it('never constructs symbol ids from label, path, name, or line fields', () => {
    const source = ownedSources.map((path) => readFileSync(path, 'utf8')).join('\n')

    expect(source).not.toContain('canonicalSymbolNodeId')
    expect(source).not.toMatch(/\$\{label\}:\$\{filePath\}:\$\{name\}/)
    expect(source).not.toContain('graphNodeIdentityMatches')
    expect(source).not.toContain('referenceKey')
  })
})
