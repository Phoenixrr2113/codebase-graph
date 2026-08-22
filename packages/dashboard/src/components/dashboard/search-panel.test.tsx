import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as SearchPanelModule from './search-panel'

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

function getSearchManagerFactory() {
  return (SearchPanelModule as unknown as {
    createSearchRequestManager?: typeof import('./search-panel')['createSearchRequestManager']
  }).createSearchRequestManager
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SearchPanel latest request behavior', () => {
  it('keeps the newer response when an aborted older response resolves last', async () => {
    vi.useFakeTimers()
    const older = deferred<Response>()
    const newer = deferred<Response>()
    const visibleNames: string[][] = []
    const visibleTotals: number[] = []
    const highlightedNodeIds: string[][] = []
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      return signals.length === 1 ? older.promise : newer.promise
    })
    const factory = getSearchManagerFactory()

    expect(factory, 'SearchPanel must expose the request manager it uses').toBeTypeOf('function')
    if (!factory) return

    const manager = factory({
      apiUrl: 'http://dashboard.test',
      fetchImpl: fetchMock,
      onResults: (results) => visibleNames.push(results.map((result) => result.name)),
      onTotal: (total) => visibleTotals.push(total),
      onHighlight: (nodeIds) => highlightedNodeIds.push(nodeIds),
      onSearching: vi.fn(),
      onError: vi.fn(),
    })

    manager.searchAfterDelay('older')
    await vi.advanceTimersByTimeAsync(250)
    manager.searchAfterDelay('newer')
    expect(signals[0]?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(250)

    const newerId = `sym:v1:${'a'.repeat(64)}`
    const olderId = `sym:v1:${'b'.repeat(64)}`
    newer.resolve(jsonResponse({ results: [{ id: newerId, name: 'sharedName', nodeType: 'Function' }], total: 1 }))
    await vi.waitFor(() => expect(visibleNames.at(-1)).toEqual(['sharedName']))
    older.resolve(jsonResponse({ results: [{ id: olderId, name: 'sharedName', nodeType: 'Class' }], total: 99 }))
    await Promise.resolve()
    await Promise.resolve()

    expect(visibleNames.at(-1)).toEqual(['sharedName'])
    expect(visibleTotals.at(-1)).toBe(1)
    expect(highlightedNodeIds.at(-1)).toEqual([newerId])
  })

  it('does not report an aborted request as an error', async () => {
    vi.useFakeTimers()
    const errors: string[] = []
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    ))
    const factory = getSearchManagerFactory()

    expect(factory, 'SearchPanel must expose the request manager it uses').toBeTypeOf('function')
    if (!factory) return

    const manager = factory({
      apiUrl: 'http://dashboard.test',
      fetchImpl: fetchMock,
      onResults: vi.fn(),
      onTotal: vi.fn(),
      onHighlight: vi.fn(),
      onSearching: vi.fn(),
      onError: (error) => {
        if (error) errors.push(error)
      },
    })

    manager.searchAfterDelay('first')
    await vi.advanceTimersByTimeAsync(250)
    manager.searchAfterDelay('second')
    await Promise.resolve()

    expect(errors).toEqual([])
  })

  it('reports a genuine failure without clearing the visible results', async () => {
    vi.useFakeTimers()
    const errors: Array<string | null> = []
    const onResults = vi.fn()
    const factory = getSearchManagerFactory()

    expect(factory, 'SearchPanel must expose the request manager it uses').toBeTypeOf('function')
    if (!factory) return

    const manager = factory({
      apiUrl: 'http://dashboard.test',
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
      onResults,
      onTotal: vi.fn(),
      onHighlight: vi.fn(),
      onSearching: vi.fn(),
      onError: (error) => errors.push(error),
    })

    manager.searchAfterDelay('failure')
    await vi.advanceTimersByTimeAsync(250)
    await vi.waitFor(() => expect(errors.at(-1)).toBe('Search failed. Please try again.'))

    expect(onResults).not.toHaveBeenCalled()
  })
})

describe('SearchPanel accessibility', () => {
  it('renders a labeled search input and a polite status live region', () => {
    const html = renderToStaticMarkup(
      <SearchPanelModule.SearchPanel
        apiUrl="http://dashboard.test"
        onHighlight={() => undefined}
        onSelectResult={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="Search code"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('role="alert"')
  })
})
