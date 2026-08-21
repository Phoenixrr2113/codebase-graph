import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as QueryPanelModule from './query-panel'

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
