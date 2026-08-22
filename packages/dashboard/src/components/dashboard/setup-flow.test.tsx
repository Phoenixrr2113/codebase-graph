// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { SetupFlow } from './setup-flow'
import type { SetupStatus } from '@/lib/setup-status'

interface MountedView {
  container: HTMLDivElement
  root: Root
}

const mounted: MountedView[] = [];

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const baseStatus = {
  storage: {
    driver: 'falkordblite',
    dataPath: '/Users/test/.codegraph/falkordb',
    ownerState: 'owned',
    embeddedSupported: true,
    externalGuidance: null,
    error: null,
  },
  embedding: {
    profile: {
      provider: 'local',
      model: 'nomic-ai/nomic-embed-text-v1.5',
      dimension: 768,
    },
    keyPresent: false,
    localModelCached: false,
    modelLoad: null,
    migration: null,
  },
  projects: { configured: false, count: 0 },
  index: {
    state: 'not-configured',
    progress: null,
    embeddingPass: { running: false, scope: null, startedAt: null },
  },
} satisfies SetupStatus

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function renderApp(status: unknown): Promise<HTMLDivElement> {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://dashboard.test')
    if (url.pathname === '/api/setup/status') return response(status)
    if (url.pathname === '/api/projects') return response({ projects: [] })
    return response({ nodes: [], edges: [], results: [], total: 0 })
  }))

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  await act(async () => root.render(<App />))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return container
}

async function clickButton(scope: ParentNode, label: string): Promise<void> {
  const button = Array.from(scope.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => button.click())
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  while (mounted.length > 0) {
    const view = mounted.pop()
    if (!view) continue
    await act(async () => view.root.unmount())
    view.container.remove()
  }
  document.body.innerHTML = ''
})

describe('dashboard setup flow', () => {
  it('opens first run on storage, local embedding, Browse, and Index controls', async () => {
    const container = await renderApp(baseStatus)

    expect(container.textContent).toContain('Set up CodeGraph')
    expect(container.textContent).toContain('Embedded FalkorDBLite')
    expect(container.textContent).toContain('/Users/test/.codegraph/falkordb')
    expect(container.textContent).toContain('Local, free, runs on this computer')
    expect(container.textContent).toContain('Browse')
    expect(container.textContent).toContain('Index project')
    expect(container.querySelector('[data-testid="graph-canvas"]')).toBeNull()
  })

  it('shows the exact provider migration remedy and an explicit action', async () => {
    const remedy = 'Run an explicit re-embed migration or a full reindex before using the requested embedding profile.'
    const container = await renderApp({
      ...baseStatus,
      projects: { configured: true, count: 1 },
      embedding: {
        ...baseStatus.embedding,
        migration: {
          required: true,
          code: 'EMBEDDING_PROFILE_MISMATCH',
          storedProfile: { provider: 'voyage', model: 'voyage-code-3', dimension: 1024 },
          requestedProfile: baseStatus.embedding.profile,
          remedy,
          allowedActions: ['re-embed', 'full-reindex'],
        },
      },
      index: { ...baseStatus.index, state: 'migration-required' },
    })

    expect(container.textContent).toContain(remedy)
    expect(Array.from(container.querySelectorAll('button')).some((button) => (
      button.textContent?.includes('Run re-embed migration')
    ))).toBe(true)
    await clickButton(container, 'Run re-embed migration')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/embeddings/migrate'),
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('renders measured model and indexing progress in a polite live region', async () => {
    const container = await renderApp({
      ...baseStatus,
      embedding: {
        ...baseStatus.embedding,
        modelLoad: {
          state: 'downloading',
          model: 'nomic-ai/nomic-embed-text-v1.5',
          cached: false,
          loadedBytes: 69005708,
          totalBytes: 138011417,
          percent: 50,
        },
      },
      index: {
        ...baseStatus.index,
        state: 'indexing',
        progress: {
          id: 'job-1',
          phase: 'parsing',
          processed: 12,
          total: 24,
          message: 'Parsing source files.',
          startedAt: '2026-08-22T12:00:00.000Z',
        },
      },
    })

    const liveRegion = container.querySelector('[aria-live="polite"]')
    expect(liveRegion).toBeInstanceOf(HTMLElement)
    expect(container.textContent).toContain('50%')
    expect(container.textContent).toContain('12 of 24')
    expect(container.querySelector('[role="progressbar"]')).toBeInstanceOf(HTMLElement)
  })

  it('loads the final embedding count before presenting completion metrics', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://dashboard.test')
      if (url.pathname === '/api/parse/project' && init?.method === 'POST') {
        return response({
          success: true,
          projectId: 'project-1',
          projectName: 'Project One',
          stats: { files: 4, entities: 12, edges: 18, errors: 0, durationMs: 120 },
        })
      }
      if (url.pathname === '/api/embeddings/status') {
        return response({ labels: [
          { label: 'Function', total: 8, withEmbedding: 6, coverage: 75 },
          { label: 'Class', total: 2, withEmbedding: 1, coverage: 50 },
        ] })
      }
      return response({})
    }))

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ container, root })
    await act(async () => root.render(
      <SetupFlow
        apiUrl="http://dashboard.test"
        status={{ ...baseStatus, projects: { configured: true, count: 1 }, index: { ...baseStatus.index, state: 'idle' } }}
        onStatusRefresh={async () => undefined}
        onProjectParsed={() => undefined}
        onExplore={() => undefined}
      />,
    ))
    const pathInput = container.querySelector('#setup-project-path')
    expect(pathInput).toBeInstanceOf(HTMLInputElement)
    await setInputValue(pathInput as HTMLInputElement, '/work/project')
    await clickButton(container, 'Index project')

    await vi.waitFor(() => expect(container.textContent).toContain('Index complete'))
    await vi.waitFor(() => expect(container.textContent).toContain('Embeddings7'))
  })
})
