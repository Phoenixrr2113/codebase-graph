// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type cytoscape from 'cytoscape'
import type { GraphWindow } from '@/lib/graph-window'

const graphWindowMocks = vi.hoisted(() => ({
  fetchGraphWindow: vi.fn(),
  fetchGraphInducedEdges: vi.fn(),
  readGraphExternalsState: vi.fn(),
  persistGraphExternalsState: vi.fn(),
}))

vi.mock('@/lib/graph-window', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/graph-window')>()
  return {
    ...actual,
    fetchGraphWindow: graphWindowMocks.fetchGraphWindow,
    fetchGraphInducedEdges: graphWindowMocks.fetchGraphInducedEdges,
    readGraphExternalsState: (
      ...args: Parameters<typeof actual.readGraphExternalsState>
    ): boolean => {
      graphWindowMocks.readGraphExternalsState(...args)
      return actual.readGraphExternalsState(...args)
    },
    persistGraphExternalsState: (
      ...args: Parameters<typeof actual.persistGraphExternalsState>
    ): void => {
      graphWindowMocks.persistGraphExternalsState(...args)
      actual.persistGraphExternalsState(...args)
    },
  }
})

vi.mock('cytoscape', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cytoscape')>()
  const defaultExport: unknown = Reflect.get(actual, 'default')
  const factory = typeof defaultExport === 'function'
    ? defaultExport as typeof actual
    : actual
  return {
    ...actual,
    default: (options: cytoscape.CytoscapeOptions): cytoscape.Core => factory({
      ...options,
      container: undefined,
      headless: true,
      style: [],
    }),
  }
})

import { AppShell } from './app-shell'
import { GraphCanvas } from './graph-canvas'
import { GraphControls } from './graph-controls'

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

interface GraphWindowRequest {
  offset?: number
  includeExternals?: boolean
}

function graphWindowAt(offset: number): GraphWindow {
  return {
    nodes: [],
    edges: [],
    totalNodes: 600,
    totalEdges: 0,
    windowOrder: 'degree-desc,id-asc',
    truncation: { incoming: false, outgoing: false },
    offset,
    limit: 300,
    returned: 0,
    hasMore: offset < 300,
    nextOffset: offset < 300 ? 300 : null,
  }
}

async function render(element: React.ReactNode): Promise<{
  container: HTMLDivElement
  root: Root
}> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return { container, root }
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  graphWindowMocks.fetchGraphWindow.mockReset()
  graphWindowMocks.fetchGraphWindow.mockImplementation(
    async (request: GraphWindowRequest) => graphWindowAt(request.offset ?? 0),
  )
  graphWindowMocks.fetchGraphInducedEdges.mockReset()
  graphWindowMocks.fetchGraphInducedEdges.mockResolvedValue([])
  graphWindowMocks.readGraphExternalsState.mockClear()
  graphWindowMocks.persistGraphExternalsState.mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Files externals control', () => {
  it('renders only for Files with its pressed state and inverts the value on activation', async () => {
    const onIncludeExternalsChange = vi.fn()
    const filesHtml = renderToStaticMarkup(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        nodeCount={0}
        mode="files"
        includeExternals={false}
        onIncludeExternalsChange={onIncludeExternalsChange}
        layout="cose"
      />,
    )
    const symbolsHtml = renderToStaticMarkup(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        nodeCount={0}
        mode="symbols"
        includeExternals
        onIncludeExternalsChange={onIncludeExternalsChange}
        layout="cose"
      />,
    )

    expect(filesHtml).toMatch(/<button[^>]*aria-pressed="false"[^>]*aria-label="Show unresolved external modules"/)
    expect(filesHtml).toContain('focus-visible:ring')
    expect(symbolsHtml).not.toContain('Show unresolved external modules')

    const view = await render(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        nodeCount={0}
        mode="files"
        includeExternals={false}
        onIncludeExternalsChange={onIncludeExternalsChange}
        layout="cose"
      />,
    )
    const button = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Show unresolved external modules"]',
    )
    expect(button).toBeInstanceOf(HTMLButtonElement)
    await act(async () => button?.click())
    expect(onIncludeExternalsChange).toHaveBeenCalledWith(true)
    await act(async () => view.root.unmount())
  })

  it('restores URL preference over storage, persists changes, and refetches from offset zero', async () => {
    window.localStorage.setItem('codegraph.graphIncludeExternals', 'true')
    window.history.replaceState(
      null,
      '',
      '/?graphMode=files&graphOffset=300&graphExternals=false',
    )

    const view = await render(<AppShell projectId="project-1" projectName="CodeGraph" />)
    await act(async () => {
      await vi.waitFor(() => expect(graphWindowMocks.fetchGraphWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'files',
          offset: 300,
          includeExternals: false,
        }),
      ))
    })
    expect(graphWindowMocks.readGraphExternalsState).toHaveBeenCalled()
    expect(view.container.querySelector(
      '[aria-label="Show unresolved external modules"]',
    )?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => {
      view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Show unresolved external modules"]',
      )?.click()
    })

    await act(async () => {
      await vi.waitFor(() => expect(graphWindowMocks.fetchGraphWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'files',
          offset: 0,
          includeExternals: true,
        }),
      ))
    })
    expect(graphWindowMocks.persistGraphExternalsState).toHaveBeenLastCalledWith(
      true,
      window.location,
      window.history,
      window.localStorage,
    )
    expect(new URL(window.location.href).searchParams.get('graphExternals')).toBe('true')
    expect(window.localStorage.getItem('codegraph.graphIncludeExternals')).toBe('true')
    await act(async () => view.root.unmount())
  })

  it('passes includeExternals on initial and Load More graph requests', async () => {
    const view = await render(
      <GraphCanvas
        apiUrl="http://dashboard.test"
        onNodeSelect={vi.fn()}
        highlightedNodeIds={new Set()}
        hiddenEdgeTypes={new Set()}
        hiddenNodeTypes={new Set()}
        mode="files"
        includeExternals={false}
      />,
    )

    await act(async () => {
      await vi.waitFor(() => expect(graphWindowMocks.fetchGraphWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'files',
          offset: 0,
          includeExternals: false,
        }),
      ))
    })
    const loadMore = view.container.querySelector<HTMLButtonElement>('[aria-label^="Load next"]')
    expect(loadMore?.disabled).toBe(false)
    await act(async () => loadMore?.click())
    await act(async () => {
      await vi.waitFor(() => expect(graphWindowMocks.fetchGraphWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'files',
          offset: 300,
          includeExternals: false,
        }),
      ))
    })
    await act(async () => view.root.unmount())
  })
})
