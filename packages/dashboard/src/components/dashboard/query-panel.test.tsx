// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as QueryPanelModule from './query-panel'

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  if (!resolve) throw new Error('Deferred promise was not initialized')
  return { promise, resolve }
}

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getQueryManagerFactory() {
  return (QueryPanelModule as unknown as {
    createQueryRequestManager?: typeof import('./query-panel')['createQueryRequestManager']
  }).createQueryRequestManager
}

describe('QueryPanel latest execution behavior', () => {
  it('keeps the newer execution visible when the older response resolves last', async () => {
    const older = deferred<Response>()
    const newer = deferred<Response>()
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      return signals.length === 1 ? older.promise : newer.promise
    })
    const visibleResults: unknown[][] = []
    const factory = getQueryManagerFactory()

    expect(factory, 'QueryPanel must expose the request manager it uses').toBeTypeOf('function')
    if (!factory) return

    const manager = factory({
      apiUrl: 'http://dashboard.test',
      fetchImpl: fetchMock,
      onLoading: vi.fn(),
      onError: vi.fn(),
      onResults: (results) => {
        if (results !== null) visibleResults.push(results)
      },
      onMeta: vi.fn(),
      onDuration: vi.fn(),
    })

    const firstRun = manager.execute('search', 'older')
    const secondRun = manager.execute('search', 'newer')
    expect(signals[0]?.aborted).toBe(true)
    newer.resolve(jsonResponse({ results: [{ name: 'newerResult' }], total: 1, durationMs: 2 }))
    await secondRun
    older.resolve(jsonResponse({ results: [{ name: 'olderResult' }], total: 1, durationMs: 10 }))
    await firstRun

    expect(visibleResults.at(-1)).toEqual([{ name: 'newerResult' }])
  })
})

describe('QueryPanel accessibility', () => {
  it('renders a labeled query textarea', () => {
    const html = renderToStaticMarkup(<QueryPanelModule.QueryPanel apiUrl="http://dashboard.test" />)

    expect(html).toContain('aria-label="Query"')
    expect(html).toContain('role="alert"')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function setTextareaValue(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function clickButton(container: ParentNode, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => button.click())
}

describe('QueryPanel mode workspaces', () => {
  it('retains each mode input and result while keeping the inputs isolated', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      return url.includes('/api/search')
        ? jsonResponse({ results: [{ name: 'search-result', type: 'Function' }], total: 1 })
        : jsonResponse({ results: [{ value: 'cypher-result' }] })
    })
    vi.stubGlobal('fetch', fetcher)

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<QueryPanelModule.QueryPanel apiUrl="http://dashboard.test" />))

    const textarea = container.querySelector('textarea')
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    await setTextareaValue(textarea as HTMLTextAreaElement, 'MATCH (n) RETURN n')
    await clickButton(container, 'Execute')
    await vi.waitFor(() => expect(container.textContent).toContain('cypher-result'))

    await clickButton(container, 'Search')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
    await setTextareaValue(container.querySelector('textarea') as HTMLTextAreaElement, 'authentication')
    await clickButton(container, 'Execute')
    await vi.waitFor(() => expect(container.textContent).toContain('search-result'))

    await clickButton(container, 'Cypher')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('MATCH (n) RETURN n')
    expect(container.textContent).toContain('cypher-result')

    await clickButton(container, 'Search')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('authentication')
    expect(container.textContent).toContain('search-result')

    await act(async () => root.unmount())
  })
})
