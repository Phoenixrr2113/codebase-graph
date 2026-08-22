import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_SELECTION_HISTORY,
  ExplorerNavigation,
  deriveBreadcrumbs,
  moveSelectionHistory,
  pushSelectionHistory,
  searchResultToGraphNode,
} from './app-shell'
import { analysisSymbolToGraphNode } from '@/lib/analysis'
import { symbolReferenceToGraphNode } from './entity-detail'
import type { GraphNode } from './graph-canvas'
import type { SymbolReference } from '@/lib/references'
import type { GraphCanvasViewState } from '@/lib/graph-window'

const fileNode: GraphNode = {
  id: 'File:/repo/src/main.ts',
  label: 'main.ts',
  type: 'File',
  properties: { filePath: '/repo/src/main.ts', name: 'main.ts' },
}

const symbolNode: GraphNode = {
  id: 'sym:v1:1111111111111111111111111111111111111111111111111111111111111111',
  label: 'run',
  type: 'Function',
  properties: { filePath: '/repo/src/main.ts', name: 'run', startLine: 5 },
}

const canvasView: GraphCanvasViewState = {
  mode: 'symbols',
  limit: 300,
  fileScope: null,
  expansions: [],
}

describe('explorer selection history', () => {
  it('uses canonical graph identity for real search and reference payloads', () => {
    const canonicalNode: GraphNode = {
      id: 'sym:v1:1111111111111111111111111111111111111111111111111111111111111111',
      label: 'run',
      type: 'Function',
      properties: {
        name: 'run',
        filePath: '/repo/src/main.ts',
        startLine: 5,
      },
    }
    const searchResult = {
      id: canonicalNode.id,
      name: 'run',
      nodeType: 'Function',
      filePath: '/repo/src/main.ts',
      startLine: 5,
      endLine: 8,
      isExported: true,
    }
    const referenceRow: SymbolReference = {
      id: canonicalNode.id,
      name: 'run',
      nodeType: 'Function',
      filePath: '/repo/src/main.ts',
      startLine: 5,
      edgeType: 'CALLS',
      sameFile: false,
    }

    expect(searchResultToGraphNode(searchResult).id).toBe(canonicalNode.id)
    expect(symbolReferenceToGraphNode(referenceRow).id).toBe(canonicalNode.id)
    expect(analysisSymbolToGraphNode({
      id: canonicalNode.id,
      name: 'run',
      nodeType: 'Function',
      filePath: '/repo/src/main.ts',
      startLine: 5,
    }).id).toBe(canonicalNode.id)

    expect(searchResultToGraphNode({
      id: 'File:/repo/src/needle-file.ts',
      name: 'needle-file.ts',
      nodeType: 'File',
      filePath: '/repo/src/needle-file.ts',
      startLine: null,
      endLine: null,
      isExported: null,
    })).toEqual({
      id: 'File:/repo/src/needle-file.ts',
      label: 'needle-file.ts',
      type: 'File',
      properties: {
        id: 'File:/repo/src/needle-file.ts',
        name: 'needle-file.ts',
        nodeType: 'File',
        filePath: '/repo/src/needle-file.ts',
        startLine: null,
        endLine: null,
        isExported: null,
      },
    })

    expect(() => searchResultToGraphNode({
      name: 'run',
      nodeType: 'Function',
      filePath: '/repo/src/main.ts',
      startLine: null,
      endLine: null,
      isExported: null,
    })).toThrow('Search result is missing a persisted id')
  })

  it('deduplicates consecutive selections and truncates Forward after a new branch', () => {
    let history = pushSelectionHistory(EMPTY_SELECTION_HISTORY, fileNode, canvasView)
    history = pushSelectionHistory(history, fileNode, canvasView)
    history = pushSelectionHistory(history, symbolNode, canvasView)

    expect(history.entries.map((entry) => entry.node?.id ?? null)).toEqual([
      'File:/repo/src/main.ts',
      symbolNode.id,
    ])
    expect(history.index).toBe(1)

    history = moveSelectionHistory(history, -1)
    history = pushSelectionHistory(history, null, canvasView)

    expect(history.entries.map((entry) => entry.node?.id ?? null)).toEqual([
      'File:/repo/src/main.ts',
      null,
    ])
    expect(history.index).toBe(1)
  })

  it('moves backward and forward without pushing duplicate entries', () => {
    let history = pushSelectionHistory(EMPTY_SELECTION_HISTORY, fileNode, canvasView)
    history = pushSelectionHistory(history, symbolNode, canvasView)

    history = moveSelectionHistory(history, -1)
    expect(history.entries[history.index]?.node?.id).toBe(fileNode.id)

    history = moveSelectionHistory(history, 1)
    expect(history.entries[history.index]?.node?.id).toBe(symbolNode.id)
  })
})

describe('explorer breadcrumbs', () => {
  it('derives project, file, and symbol levels from the current selection', () => {
    const crumbs = deriveBreadcrumbs('CodeGraph', symbolNode)

    expect(crumbs.map((crumb) => [crumb.level, crumb.label, crumb.node?.id ?? null])).toEqual([
      ['project', 'CodeGraph', null],
      ['file', 'main.ts', null],
      ['symbol', 'run', symbolNode.id],
    ])
  })

  it('renders Back and Forward disabled states and clickable breadcrumb levels', () => {
    const html = renderToStaticMarkup(
      <ExplorerNavigation
        projectName="CodeGraph"
        selectedNode={symbolNode}
        canGoBack={false}
        canGoForward={true}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="Explorer navigation"')
    expect(html).toContain('aria-label="Back"')
    expect(html).toContain('aria-label="Forward"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('CodeGraph')
    expect(html).toContain('main.ts')
    expect(html).toContain('run')
  })
})
