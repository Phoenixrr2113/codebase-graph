import { afterEach, describe, expect, it, vi } from 'vitest'
import * as embeddingModule from './embedding-badge'

interface StatusResponse {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
}

type StatusFetcher = (input: string, init?: RequestInit) => Promise<StatusResponse>

function pollingExport() {
  const start = Reflect.get(embeddingModule, 'startEmbeddingStatusPolling') as unknown
  expect(start).toBeTypeOf('function')
  return start as (options: {
    projectId: string | null
    fetcher: StatusFetcher
    onState: (state: unknown) => void
    pollIntervalMs?: number
  }) => { abort: () => void }
}

function response(running: boolean): StatusResponse {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      scope: { type: 'project', projectId: 'project one', rootPath: '/project-one' },
      embeddingPass: { running, scope: null, startedAt: null },
      labels: [{ label: 'Function', total: 10, withEmbedding: 4, coverage: 40 }],
    }),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('EmbeddingBadge selected-project lifecycle', () => {
  it('labels global coverage explicitly as all projects', () => {
    const html = renderToStaticMarkup(createElement(embeddingModule.EmbeddingBadgeContent, {
      state: {
        status: 'success',
        data: {
          total: 0,
          embedded: 0,
          pct: 0,
          running: false,
          scope: { kind: 'all' },
        },
      },
      generating: false,
      genResult: null,
      onGenerate: vi.fn(),
      onRetry: vi.fn(),
    }))

    expect(html).toContain('Embeddings (All projects): 0% (0/0)')
  })

  it('builds a selected-project generation request body', () => {
    const createBody = Reflect.get(embeddingModule, 'createEmbeddingGenerateBody') as unknown
    expect(createBody).toBeTypeOf('function')
    if (typeof createBody !== 'function') return

    expect(createBody('project one')).toEqual({ projectId: 'project one' })
    expect(createBody(null)).toEqual({})
  })

  it('scopes status requests to the selected project', async () => {
    const fetcher = vi.fn<StatusFetcher>().mockResolvedValue(response(false))
    const polling = pollingExport()

    polling({ projectId: 'project one', fetcher, onState: vi.fn() })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'http://localhost:3001/api/embeddings/status?projectId=project+one',
    )
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('polls while running and stops when the server reports idle', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<StatusFetcher>()
      .mockResolvedValueOnce(response(true))
      .mockResolvedValueOnce(response(false))
    const polling = pollingExport()

    polling({ projectId: 'alpha', fetcher, onState: vi.fn(), pollIntervalMs: 1_000 })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('aborts the active request and pending poll on unmount cleanup', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetcher = vi.fn<StatusFetcher>((_input, init) => {
      signal = init?.signal ?? undefined
      return Promise.resolve(response(true))
    })
    const polling = pollingExport()

    const lifecycle = polling({
      projectId: 'alpha',
      fetcher,
      onState: vi.fn(),
      pollIntervalMs: 1_000,
    })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    lifecycle.abort()

    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
