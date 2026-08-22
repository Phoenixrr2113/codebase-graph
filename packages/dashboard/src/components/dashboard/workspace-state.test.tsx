// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setupStatus() {
  return {
    storage: {
      driver: 'falkordblite',
      dataPath: '/tmp/codegraph-test',
      ownerState: 'owned',
      embeddedSupported: true,
      externalGuidance: null,
      error: null,
    },
    embedding: {
      profile: { provider: 'local', model: 'nomic-ai/nomic-embed-text-v1.5', dimension: 768 },
      keyPresent: false,
      localModelCached: true,
      modelLoad: { state: 'ready', model: 'nomic-ai/nomic-embed-text-v1.5', cached: true },
      migration: null,
    },
    projects: { configured: true, count: 1 },
    index: {
      state: 'idle',
      progress: null,
      embeddingPass: { running: false, scope: null, startedAt: null },
    },
  }
}

async function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function clickButton(scope: ParentNode, label: string): Promise<void> {
  const target = Array.from(scope.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label,
  )
  if (!target) throw new Error(`Button not found: ${label}`)
  await act(async () => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    target.click()
  })
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('dashboard workspace persistence', () => {
  it('retains isolated left-search and query-panel state across a top-level tab switch', async () => {
    const symbolId = `sym:v1:${'a'.repeat(64)}`
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost:3000')
      if (url.pathname === '/api/setup/status') return response(setupStatus())
      if (url.pathname === '/api/projects') {
        return response({ projects: [{ id: 'project-1', name: 'Project One', rootPath: '/work/one' }] })
      }
      if (url.pathname === '/api/embeddings/status') {
        return response({
          scope: { type: 'project', projectId: 'project-1', rootPath: '/work/one' },
          embeddingPass: { running: false, scope: null, startedAt: null },
          embedding: setupStatus().embedding,
          labels: [],
        })
      }
      if (url.pathname === '/api/graph/full') return response({ nodes: [], edges: [] })
      if (url.pathname === '/api/search') {
        return response({ results: [{ id: symbolId, name: 'left-result', nodeType: 'Function' }], total: 1 })
      }
      if (url.pathname === '/api/query/cypher' && init?.method === 'POST') {
        return response({ results: [{ value: 'query-result' }] })
      }
      if (url.pathname === '/api/stats') {
        return response({ totalNodes: 0, totalEdges: 0, nodesByType: {}, edgesByType: {}, largestFiles: [] })
      }
      if (url.pathname === '/api/knowledge/stats') {
        return response({ totalEntities: 0, avgRelevance: 0, lowRelevanceCount: 0, oldestAccess: null, newestAccess: null })
      }
      return response({ results: [], total: 0 })
    }))

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Search code"]')).toBeInstanceOf(HTMLInputElement))

    const leftSearch = container.querySelector('[aria-label="Search code"]') as HTMLInputElement
    await setInputValue(leftSearch, 'left workspace')
    await act(async () => leftSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await vi.waitFor(() => expect(container.textContent).toContain('left-result'))

    await clickButton(container, 'Query')
    const queryInput = container.querySelector('textarea[aria-label="Query"]') as HTMLTextAreaElement
    await setInputValue(queryInput, 'MATCH (n) RETURN n')
    await clickButton(container, 'Execute')
    await vi.waitFor(() => expect(container.textContent).toContain('query-result'))

    await clickButton(container, 'Operations')
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Search code"]')).toBeNull())
    await clickButton(container, 'Graph Explorer')
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Search code"]')).toBeInstanceOf(HTMLInputElement))

    expect((container.querySelector('[aria-label="Search code"]') as HTMLInputElement).value).toBe('left workspace')
    expect(container.textContent).toContain('left-result')
    await clickButton(container, 'Query')
    await vi.waitFor(() => expect(container.querySelector('textarea[aria-label="Query"]')).toBeInstanceOf(HTMLTextAreaElement))
    expect((container.querySelector('textarea[aria-label="Query"]') as HTMLTextAreaElement).value).toBe('MATCH (n) RETURN n')
    expect(container.textContent).toContain('query-result')
    const fetcher = vi.mocked(fetch)
    expect(fetcher.mock.calls.filter(([input]) => new URL(String(input), 'http://localhost:3000').pathname === '/api/search')).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([input]) => new URL(String(input), 'http://localhost:3000').pathname === '/api/query/cypher')).toHaveLength(1)

    await act(async () => root.unmount())
  })
})
