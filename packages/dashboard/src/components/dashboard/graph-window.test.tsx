// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntityDetail } from './entity-detail'
import { GraphControls } from './graph-controls'
import { moveSelectionHistory, pushSelectionHistory, EMPTY_SELECTION_HISTORY } from './app-shell'
import {
  appendGraphExpansion,
  fetchGraphInducedEdges,
  fetchGraphWindow,
  fetchGraphNodeDetail,
  mergeGraphWindow,
  planInducedEdgeRequests,
  persistGraphViewState,
  readGraphViewState,
  resetGraphExpansions,
  resetGraphView,
  resetGraphWindow,
  restoreGraphWindow,
  type GraphCanvasViewState,
  type GraphWindow,
} from '@/lib/graph-window'
import type { GraphNode } from './graph-canvas'

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const fileNode: GraphNode = {
  id: 'File:/repo/src/main.ts',
  label: 'main.ts',
  type: 'File',
  properties: { filePath: '/repo/src/main.ts', symbolCount: 2 },
}

const baseWindow: GraphWindow = {
  nodes: [fileNode],
  edges: [],
  totalNodes: 9,
  totalEdges: 12,
  windowOrder: 'degree-desc,id-asc',
  truncation: { incoming: false, outgoing: false },
  offset: 0,
  limit: 300,
  returned: 1,
  hasMore: true,
  nextOffset: 1,
}

const baseView: GraphCanvasViewState = {
  mode: 'symbols',
  limit: 300,
  offset: 0,
  fileScope: null,
  expansions: [],
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('honest graph window', () => {
  it('renders exact page range math and accessible page actions', () => {
    const html = renderToStaticMarkup(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        onReset={vi.fn()}
        nodeCount={300}
        edgeCount={417}
        totalNodes={842}
        totalEdges={1_204}
        windowLimit={300}
        onWindowLimitChange={vi.fn()}
        mode="symbols"
        onModeChange={vi.fn()}
        layout="cose"
        canReset={false}
        pageOffset={300}
        pageReturned={300}
        hasMore
        onPreviousPage={vi.fn()}
        onNextPage={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    )

    expect(html).toContain('nodes 301 to 600 of 842')
    expect(html).toContain('417 of 1,204 edges')
    expect(html).toContain('Most connected first')
    expect(html).toContain('aria-label="Graph window size"')
    expect(html).toContain('aria-label="Graph level of detail"')
    expect(html).toContain('aria-label="Previous graph page"')
    expect(html).toContain('aria-label="Next graph page"')
    expect(html).toContain('Load next 300')
    expect(html).toContain('aria-live="polite"')
  })

  it('disables Previous and Next at their respective ends', () => {
    const firstPage = renderToStaticMarkup(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        nodeCount={300}
        totalNodes={600}
        pageOffset={0}
        pageReturned={300}
        hasMore
        layout="cose"
      />,
    )
    const lastPage = renderToStaticMarkup(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        nodeCount={300}
        totalNodes={600}
        pageOffset={300}
        pageReturned={300}
        hasMore={false}
        layout="cose"
      />,
    )

    expect(firstPage).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous graph page"/)
    expect(firstPage).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next graph page"/)
    expect(lastPage).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous graph page"/)
    expect(lastPage).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next graph page"/)
    expect(lastPage).toContain('All nodes loaded')
  })

  it('invokes labelled Previous, Next, and Load More controls from the keyboard-accessible chrome', async () => {
    const onPreviousPage = vi.fn()
    const onNextPage = vi.fn()
    const onLoadMore = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        nodeCount={300}
        totalNodes={900}
        pageOffset={300}
        pageReturned={300}
        hasMore
        onPreviousPage={onPreviousPage}
        onNextPage={onNextPage}
        onLoadMore={onLoadMore}
        layout="cose"
      />,
    ))

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Previous graph page"]')?.click()
      container.querySelector<HTMLButtonElement>('[aria-label="Next graph page"]')?.click()
      container.querySelector<HTMLButtonElement>('[aria-label^="Load next"]')?.click()
    })

    expect(onPreviousPage).toHaveBeenCalledOnce()
    expect(onNextPage).toHaveBeenCalledOnce()
    expect(onLoadMore).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })

  it('persists mode, window size, and offset to URL and storage, preferring valid URL values', () => {
    persistGraphViewState(
      { mode: 'files', limit: 500, offset: 1000 },
      window.location,
      window.history,
      window.localStorage,
    )

    expect(new URL(window.location.href).searchParams.get('graphMode')).toBe('files')
    expect(new URL(window.location.href).searchParams.get('graphLimit')).toBe('500')
    expect(new URL(window.location.href).searchParams.get('graphOffset')).toBe('1000')
    expect(window.localStorage.getItem('codegraph.graphMode')).toBe('files')
    expect(window.localStorage.getItem('codegraph.graphLimit')).toBe('500')
    expect(window.localStorage.getItem('codegraph.graphOffset')).toBe('1000')

    window.localStorage.setItem('codegraph.graphMode', 'symbols')
    window.localStorage.setItem('codegraph.graphLimit', '1000')
    window.localStorage.setItem('codegraph.graphOffset', '300')
    expect(readGraphViewState(window.location, window.localStorage)).toEqual({
      mode: 'files',
      limit: 500,
      offset: 1000,
    })
  })

  it('describes a file drill-down without claiming degree ordering', () => {
    const html = renderToStaticMarkup(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        nodeCount={2}
        edgeCount={1}
        totalNodes={2}
        totalEdges={1}
        layout="cose"
        windowOrder="file-contained"
      />,
    )

    expect(html).toContain('Selected file symbols')
    expect(html).not.toContain('Most connected first')
  })
})

describe('graph level of detail', () => {
  it('builds the canvas model from the reduced graph node shape', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({
      nodes: [{
        id: `sym:v1:${'d'.repeat(64)}`,
        label: 'Function',
        displayName: 'trimmedFunction',
        filePath: '/repo/src/trimmed.ts',
        startLine: 17,
        degree: 9,
        symbolCount: 0,
      }],
      edges: [],
      totalNodes: 1,
      totalEdges: 0,
      windowOrder: 'degree-desc,id-asc',
      truncated: false,
    }))

    const result = await fetchGraphWindow({
      apiUrl: 'http://dashboard.test',
      mode: 'symbols',
      limit: 300,
      fetchImpl: fetcher,
    })

    expect(result.nodes[0]).toEqual({
      id: `sym:v1:${'d'.repeat(64)}`,
      label: 'trimmedFunction',
      type: 'Function',
      properties: {
        filePath: '/repo/src/trimmed.ts',
        startLine: 17,
        degree: 9,
        symbolCount: 0,
      },
    })
  })

  it('loads full detail properties for a selected reduced window node', async () => {
    const reducedNode: GraphNode = {
      id: `sym:v1:${'f'.repeat(64)}`,
      label: 'trimmedFunction',
      type: 'Function',
      properties: { filePath: '/repo/src/trimmed.ts', startLine: 17, degree: 9 },
    }
    const fetcher = vi.fn<typeof fetch>(async () => response({
      centerId: 'File:/repo/src/trimmed.ts',
      nodes: [{
        id: reducedNode.id,
        label: 'Function',
        displayName: 'trimmedFunction',
        filePath: '/repo/src/trimmed.ts',
        data: {
          filePath: '/repo/src/trimmed.ts',
          startLine: 17,
          endLine: 23,
          returnType: 'Promise<void>',
          isAsync: true,
        },
      }],
      edges: [],
    }))

    const detailed = await fetchGraphNodeDetail(
      'http://dashboard.test',
      reducedNode,
      undefined,
      fetcher,
    )

    expect(detailed.properties).toMatchObject({
      degree: 9,
      endLine: 23,
      returnType: 'Promise<void>',
      isAsync: true,
    })
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://dashboard.test/api/graph/file?path=%2Frepo%2Fsrc%2Ftrimmed.ts',
    )
  })

  it('fetches the endpoint for the selected Files or Symbols mode', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({
      nodes: [],
      edges: [],
      totalNodes: 0,
      totalEdges: 0,
      windowOrder: 'degree-desc,id-asc',
      truncated: false,
    }))

    await fetchGraphWindow({
      apiUrl: 'http://dashboard.test',
      mode: 'files',
      limit: 500,
      projectId: 'project one',
      offset: 500,
      fetchImpl: fetcher,
    })
    await fetchGraphWindow({
      apiUrl: 'http://dashboard.test',
      mode: 'symbols',
      limit: 1000,
      projectId: 'project one',
      offset: 2000,
      fetchImpl: fetcher,
    })

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://dashboard.test/api/graph/files?projectId=project+one&limit=500&offset=500',
    )
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      'http://dashboard.test/api/graph/full?projectId=project+one&limit=1000&offset=2000',
    )
  })

  it('parses page metadata from the frozen graph response', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({
      nodes: [],
      edges: [],
      totalNodes: 842,
      totalEdges: 1_204,
      windowOrder: 'degree-desc,id-asc',
      offset: 300,
      limit: 300,
      returned: 0,
      hasMore: true,
      nextOffset: 600,
    }))

    const result = await fetchGraphWindow({
      apiUrl: 'http://dashboard.test',
      mode: 'symbols',
      limit: 300,
      offset: 300,
      fetchImpl: fetcher,
    })

    expect(result).toMatchObject({ offset: 300, limit: 300, returned: 0, hasMore: true, nextOffset: 600 })
  })

  it('scopes every chunked induced-edge request to the selected project', async () => {
    const existingIds = Array.from({ length: 2_500 }, (_, index) => `existing-${index}`)
    const newIds = Array.from({ length: 500 }, (_, index) => `new-${index}`)

    const chunks = planInducedEdgeRequests(existingIds, newIds)

    expect(chunks).toHaveLength(2)
    expect(chunks.every((ids) => ids.length <= 2_000)).toBe(true)
    expect(chunks.every((ids) => newIds.every((id) => ids.includes(id)))).toBe(true)
    expect(new Set(chunks.flat()).size).toBe(3_000)

    const fetcher = vi.fn<typeof fetch>(async () => response({
      edges: [{ source: 'existing-0', target: 'new-0', label: 'CALLS' }],
    }))
    const edges = await fetchGraphInducedEdges(
      'http://dashboard.test',
      chunks,
      undefined,
      fetcher,
      'project / one',
    )

    expect(edges).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mock.calls.forEach(([input, init], index) => {
      expect(String(input)).toBe(
        'http://dashboard.test/api/graph/induced-edges?projectId=project+%2F+one',
      )
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        ids: chunks[index],
        projectId: 'project / one',
      })
    })
  })

  it('omits project scope from an unscoped induced-edge request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ edges: [] }))

    await fetchGraphInducedEdges(
      'http://dashboard.test',
      [['node-1', 'node-2']],
      undefined,
      fetcher,
    )

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://dashboard.test/api/graph/induced-edges',
    )
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      ids: ['node-1', 'node-2'],
    })
  })

  it('opens a file as a symbol scope through file relationships and neighbors', async () => {
    const symbolA = `sym:v1:${'a'.repeat(64)}`
    const symbolB = `sym:v1:${'b'.repeat(64)}`
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/file-relationships')) {
        return response({
          filePath: '/repo/src/main.ts',
          containedSymbols: [
            { id: symbolA, label: 'Function', displayName: 'alpha', filePath: '/repo/src/main.ts', data: {} },
            { id: symbolB, label: 'Function', displayName: 'beta', filePath: '/repo/src/main.ts', data: {} },
          ],
          imports: [],
          importers: [],
          knowledgeEntities: [],
          totals: {
            containedSymbols: 600,
            imports: 0,
            importers: 0,
            knowledgeEntities: 0,
          },
          truncated: {
            containedSymbols: true,
            imports: false,
            importers: false,
            knowledgeEntities: false,
          },
          limit: 1000,
        })
      }
      return response({
        nodes: [
          { id: fileNode.id, label: 'File', displayName: 'main.ts', filePath: '/repo/src/main.ts', data: {} },
          { id: symbolA, label: 'Function', displayName: 'alpha', filePath: '/repo/src/main.ts', data: {} },
          { id: symbolB, label: 'Function', displayName: 'beta', filePath: '/repo/src/main.ts', data: {} },
        ],
        edges: [
          { id: 'contains-a', source: fileNode.id, target: symbolA, label: 'CONTAINS' },
          { id: 'calls', source: symbolA, target: symbolB, label: 'CALLS' },
        ],
        incomingTruncated: false,
        outgoingTruncated: false,
      })
    })

    const result = await fetchGraphWindow({
      apiUrl: 'http://dashboard.test',
      mode: 'symbols',
      limit: 1000,
      projectId: 'project-1',
      fileScope: fileNode,
      fetchImpl: fetcher,
    })

    expect(result.nodes.map((node) => node.id)).toEqual([symbolA, symbolB])
    expect(result.edges.map((edge) => edge.id)).toEqual(['calls'])
    expect(result.totalNodes).toBe(600)
    expect(result.truncation).toEqual({ incoming: false, outgoing: false, window: true })
    const controlsHtml = renderToStaticMarkup(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        nodeCount={result.nodes.length}
        edgeCount={result.edges.length}
        totalNodes={result.totalNodes}
        totalEdges={result.totalEdges}
        windowLimit={1000}
        onWindowLimitChange={vi.fn()}
        mode="symbols"
        layout="cose"
        truncation={result.truncation}
        windowOrder={result.windowOrder}
      />,
    )
    expect(controlsHtml).toContain('nodes 1 to 2 of 600')
    expect(controlsHtml).toContain('1 loaded edge')
    expect(controlsHtml).not.toContain('1 of 1 edges')
    expect(controlsHtml).toContain('Results truncated')
    expect(controlsHtml).toContain('Maximum window reached')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const requestedUrls = fetcher.mock.calls.map(([input]) => String(input))
    expect(requestedUrls).toContain(
      'http://dashboard.test/api/graph/file-relationships?path=%2Frepo%2Fsrc%2Fmain.ts&limit=1000',
    )
    expect(requestedUrls).toContain(
      `http://dashboard.test/api/graph/neighbors?id=${encodeURIComponent(fileNode.id)}&limit=1000`,
    )
  })

  it('offers Open symbols for a selected file', async () => {
    const onOpenSymbols = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(
      <EntityDetail
        node={fileNode}
        onOpenSymbols={onOpenSymbols}
      />,
    ))

    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Open symbols',
    )
    expect(button).toBeInstanceOf(HTMLButtonElement)
    await act(async () => button?.click())
    expect(onOpenSymbols).toHaveBeenCalledWith(fileNode)

    await act(async () => root.unmount())
  })
})

describe('expand on demand', () => {
  it('merges expanded nodes and edges without duplicate identities', () => {
    const neighbor: GraphNode = {
      id: `sym:v1:${'c'.repeat(64)}`,
      label: 'neighbor',
      type: 'Function',
      properties: {},
    }
    const expanded = mergeGraphWindow(baseWindow, {
      nodes: [fileNode, neighbor],
      edges: [
        { id: 'imports', source: fileNode.id, target: neighbor.id, label: 'IMPORTS' },
        { id: 'imports', source: fileNode.id, target: neighbor.id, label: 'IMPORTS' },
      ],
      incomingTruncated: true,
      outgoingTruncated: false,
    })

    expect(expanded.nodes.map((node) => node.id)).toEqual([fileNode.id, neighbor.id])
    expect(expanded.edges.map((edge) => edge.id)).toEqual(['imports'])
    expect(expanded.truncation).toEqual({ incoming: true, outgoing: false })
  })

  it('marks capped direction and resets to the untouched base window', () => {
    const expanded = mergeGraphWindow(baseWindow, {
      nodes: [],
      edges: [],
      incomingTruncated: false,
      outgoingTruncated: true,
    })
    const html = renderToStaticMarkup(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        onReset={vi.fn()}
        nodeCount={expanded.nodes.length}
        edgeCount={expanded.edges.length}
        totalNodes={expanded.totalNodes}
        totalEdges={expanded.totalEdges}
        windowLimit={300}
        onWindowLimitChange={vi.fn()}
        mode="symbols"
        onModeChange={vi.fn()}
        layout="cose"
        canReset
        truncation={expanded.truncation}
      />,
    )

    expect(html).toContain('Outgoing neighbors capped')
    expect(resetGraphWindow(baseWindow)).toEqual(baseWindow)
  })

  it('restores the base canvas on Back, reapplies expansion on Forward, and records Reset', async () => {
    const neighbor: GraphNode = {
      id: `sym:v1:${'e'.repeat(64)}`,
      label: 'neighbor',
      type: 'Function',
      properties: { filePath: '/repo/src/neighbor.ts', startLine: 3 },
    }
    const expandedView = appendGraphExpansion(baseView, fileNode)
    let history = pushSelectionHistory(EMPTY_SELECTION_HISTORY, fileNode, baseView)
    history = pushSelectionHistory(history, fileNode, expandedView, { force: true })

    history = moveSelectionHistory(history, -1)
    const backWindow = await restoreGraphWindow(
      baseWindow,
      history.entries[history.index]!.view.expansions,
      async () => ({
        nodes: [neighbor],
        edges: [{ id: 'imports', source: fileNode.id, target: neighbor.id, label: 'IMPORTS' }],
        incomingTruncated: false,
        outgoingTruncated: false,
      }),
    )
    expect(backWindow.nodes.map((node) => node.id)).toEqual([fileNode.id])

    history = moveSelectionHistory(history, 1)
    const forwardWindow = await restoreGraphWindow(
      baseWindow,
      history.entries[history.index]!.view.expansions,
      async () => ({
        nodes: [neighbor],
        edges: [{ id: 'imports', source: fileNode.id, target: neighbor.id, label: 'IMPORTS' }],
        incomingTruncated: false,
        outgoingTruncated: false,
      }),
    )
    expect(forwardWindow.nodes.map((node) => node.id)).toEqual([fileNode.id, neighbor.id])

    const resetView = resetGraphExpansions(expandedView)
    history = pushSelectionHistory(history, fileNode, resetView, { force: true })
    expect(history.entries[history.index]!.view).toEqual(baseView)
  })

  it('resets an appended later page to page one alone', () => {
    const laterPage = {
      ...appendGraphExpansion(baseView, fileNode),
      offset: 600,
    }

    expect(resetGraphView(laterPage)).toEqual(baseView)
  })
})
