import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as operationsModule from './operations-tab'
import { StatCard } from './stat-card'

interface TestResponse {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
}

type TestFetch = (input: string) => Promise<TestResponse>
type OperationsStates = {
  graph: { status: string; data?: unknown; message?: string }
  knowledge: { status: string; data?: unknown; message?: string }
  embeddings: { status: string; data?: unknown; message?: string }
}

function response(body: unknown, status = 200, statusText = 'OK'): TestResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  }
}

function operationsExports(): {
  loadOperationsData: (fetcher: TestFetch) => Promise<OperationsStates>
  OperationsContent: ComponentType<Record<string, unknown>>
} {
  const loadOperationsData = Reflect.get(operationsModule, 'loadOperationsData') as unknown
  const OperationsContent = Reflect.get(operationsModule, 'OperationsContent') as unknown
  expect(typeof loadOperationsData).toBe('function')
  expect(typeof OperationsContent).toBe('function')
  return {
    loadOperationsData: loadOperationsData as (fetcher: TestFetch) => Promise<OperationsStates>,
    OperationsContent: OperationsContent as ComponentType<Record<string, unknown>>,
  }
}

describe('OperationsTab failure states', () => {
  it('renders rejected fetches as error cards and never as zero values', async () => {
    const { loadOperationsData, OperationsContent } = operationsExports()
    const fetcher = vi.fn<TestFetch>().mockRejectedValue(new Error('API offline'))

    const states = await loadOperationsData(fetcher)
    const html = renderToStaticMarkup(createElement(OperationsContent, {
      states,
      retry: {
        graph: vi.fn(),
        knowledge: vi.fn(),
        embeddings: vi.fn(),
      },
    }))

    expect(states.graph).toMatchObject({ status: 'error', message: 'API offline' })
    expect(states.knowledge).toMatchObject({ status: 'error', message: 'API offline' })
    expect(states.embeddings).toMatchObject({ status: 'error', message: 'API offline' })
    expect(html).toContain('Unable to load operations data')
    expect(html).toContain('API offline')
    expect(html).toContain('Retry')
    expect(html).not.toContain('>0<')
    expect(html).not.toContain('N/A')
  })

  it('keeps healthy cards rendered when one request fails', async () => {
    const { loadOperationsData, OperationsContent } = operationsExports()
    const fetcher: TestFetch = vi.fn(async (input: string) => {
      if (input.endsWith('/api/stats')) {
        return response({
          totalNodes: 42,
          totalEdges: 84,
          nodesByType: { File: 4 },
          edgesByType: {},
          largestFiles: [],
        })
      }
      if (input.endsWith('/api/knowledge/stats')) {
        return response({ error: 'Unavailable' }, 503, 'Service Unavailable')
      }
      return response({
        labels: [{ label: 'Function', total: 10, withEmbedding: 8, coverage: 80 }],
      })
    })

    const states = await loadOperationsData(fetcher)
    const html = renderToStaticMarkup(createElement(OperationsContent, {
      states,
      retry: {
        graph: vi.fn(),
        knowledge: vi.fn(),
        embeddings: vi.fn(),
      },
    }))

    expect(states.graph.status).toBe('success')
    expect(states.knowledge).toMatchObject({
      status: 'error',
      message: 'HTTP 503 Service Unavailable',
    })
    expect(html).toContain('42')
    expect(html).toContain('84')
    expect(html).toContain('HTTP 503 Service Unavailable')
    expect(html).toContain('Embedding Coverage')
    expect(html).not.toContain('Unable to load operations data')
  })

  it('gives an errored stat card an alert and retry instead of its stale value', () => {
    const html = renderToStaticMarkup(createElement(
      StatCard as unknown as ComponentType<Record<string, unknown>>,
      {
        title: 'Total Nodes',
        value: '0',
        error: 'Graph stats unavailable',
        onRetry: vi.fn(),
      },
    ))

    expect(html).toContain('role="alert"')
    expect(html).toContain('Graph stats unavailable')
    expect(html).toContain('Retry')
    expect(html).not.toContain('>0<')
  })
})
