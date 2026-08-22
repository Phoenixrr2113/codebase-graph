import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AnalysisPanelContent,
  AnalysisTab,
  createAnalysisRequests,
  startAnalysisCardRequest,
} from './analysis-tab'
import {
  analysisFileToGraphNode,
  analysisSymbolToGraphNode,
  type AnalysisResponses,
  type ImportCyclesResult,
} from '@/lib/analysis'

const symbolId = `sym:v1:${'a'.repeat(64)}`

const responses: AnalysisResponses = {
  cycles: {
    input: { rootPath: '/repo', maxDepth: 8, limit: 50 },
    projectRoot: '/repo',
    cycles: [{ filePaths: ['/repo/a.ts', '/repo/b.ts'], length: 2 }],
    candidateLimit: 100,
    candidateLimitReached: true,
    truncated: true,
    caveats: ['Only resolved imports are included.'],
  },
  unreferenced: {
    input: { rootPath: '/repo', limit: 100 },
    projectRoot: '/repo',
    items: [{
      id: symbolId,
      name: 'unused',
      nodeType: 'Function',
      filePath: '/repo/unused.ts',
      startLine: 4,
      fileImporterCount: 1,
      confidence: 'lower',
    }],
    truncated: false,
    caveats: ['Framework entry points may appear here.'],
  },
  hotspots: {
    input: { rootPath: '/repo', since: null, scoreBy: 'complexity', limit: 100 },
    projectRoot: '/repo',
    items: [{
      filePath: '/repo/hot.ts',
      changeCount: 8,
      churn: 144,
      complexity: 12,
      importDegree: 3,
      complexityScore: 104,
      degreeScore: 32,
    }],
    historyCoverage: {
      commitCount: 20,
      earliestCommitDate: '2026-01-01T00:00:00.000Z',
      latestCommitDate: '2026-08-01T00:00:00.000Z',
      historyComplete: false,
    },
    truncated: false,
    caveats: ['Complexity is current, not historical.'],
  },
  coupling: {
    input: { rootPath: '/repo', since: null, minSupport: 2, limit: 100 },
    projectRoot: '/repo',
    items: [{
      leftFile: '/repo/a.ts',
      rightFile: '/repo/b.ts',
      coChanges: 4,
      aChanges: 5,
      bChanges: 7,
      jaccard: 0.5,
    }],
    historyCoverage: null,
    truncated: false,
    caveats: ['Co-change is correlation, not dependency.'],
  },
}

describe('analysis request lifecycle', () => {
  it('requests every frozen project route and forwards abort signals', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const body = url.includes('import-cycles')
        ? responses.cycles
        : url.includes('dead-code')
          ? responses.unreferenced
          : url.includes('hotspots')
            ? responses.hotspots
            : responses.coupling
      return new Response(JSON.stringify(body), { status: 200 })
    })
    const controller = new AbortController()

    const result = await createAnalysisRequests('project one', controller.signal, fetcher)

    expect(result).toEqual(responses)
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/api/analysis/import-cycles?projectId=project+one'),
      { signal: controller.signal },
    )
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/api/analysis/dead-code?projectId=project+one'),
      { signal: controller.signal },
    )
  })

  it('aborts the prior card request when its project changes', () => {
    let observedSignal: AbortSignal | undefined
    const request = startAnalysisCardRequest(
      'project-one',
      (_projectId, signal) => {
        observedSignal = signal
        return new Promise<ImportCyclesResult>(() => undefined)
      },
      vi.fn(),
      vi.fn(),
    )

    expect(observedSignal?.aborted).toBe(false)
    request.abort()
    expect(observedSignal?.aborted).toBe(true)
  })
})

describe('analysis cards', () => {
  it('renders loading, error, empty, truncated, caveat, and live-region states', () => {
    const loading = renderToStaticMarkup(
      <AnalysisPanelContent kind="cycles" state={{ status: 'loading' }} onSelect={vi.fn()} />,
    )
    const error = renderToStaticMarkup(
      <AnalysisPanelContent kind="cycles" state={{ status: 'error', message: 'Unavailable' }} onSelect={vi.fn()} />,
    )
    const empty = renderToStaticMarkup(
      <AnalysisPanelContent
        kind="cycles"
        state={{ status: 'success', data: { ...responses.cycles, cycles: [], truncated: false, candidateLimitReached: false } }}
        onSelect={vi.fn()}
      />,
    )
    const populated = renderToStaticMarkup(
      <AnalysisPanelContent kind="cycles" state={{ status: 'success', data: responses.cycles }} onSelect={vi.fn()} />,
    )

    expect(loading).toContain('role="status"')
    expect(loading).toContain('aria-live="polite"')
    expect(error).toContain('role="alert"')
    expect(empty).toContain('No import cycles found')
    expect(populated).toContain('Results truncated')
    expect(populated).toContain('Candidate scan limit reached')
    expect(populated).toContain('Only resolved imports are included.')
  })

  it('renders confidence, history coverage, caveats, and focus-visible result controls', () => {
    const unreferenced = renderToStaticMarkup(
      <AnalysisPanelContent kind="unreferenced" state={{ status: 'success', data: responses.unreferenced }} onSelect={vi.fn()} />,
    )
    const hotspots = renderToStaticMarkup(
      <AnalysisPanelContent kind="hotspots" state={{ status: 'success', data: responses.hotspots }} onSelect={vi.fn()} />,
    )
    const coupling = renderToStaticMarkup(
      <AnalysisPanelContent kind="coupling" state={{ status: 'success', data: responses.coupling }} onSelect={vi.fn()} />,
    )

    expect(unreferenced).toContain('Lower confidence')
    expect(unreferenced).toContain('Framework entry points may appear here.')
    expect(hotspots).toContain('20 indexed commits')
    expect(hotspots).toContain('Complexity is current, not historical.')
    expect(coupling).toContain('History coverage unavailable')
    expect(coupling).toContain('Co-change is correlation, not dependency.')
    expect(`${unreferenced}${hotspots}${coupling}`).toContain('focus-visible:ring-2')
  })

  it('exposes labelled repository panels and no-result guidance when no project is selected', () => {
    const html = renderToStaticMarkup(<AnalysisTab projectId={null} onSelect={vi.fn()} />)

    expect(html).toContain('aria-labelledby="analysis-heading"')
    expect(html).toContain('Select a project to run repository analysis')
    expect(html.match(/aria-labelledby="analysis-card-/g)).toHaveLength(4)
  })
})

describe('analysis selection identity', () => {
  it('keeps persisted symbol ids and canonical File ids', () => {
    expect(analysisSymbolToGraphNode(responses.unreferenced.items[0]!).id).toBe(symbolId)
    expect(analysisFileToGraphNode('/repo/a.ts')).toEqual({
      id: 'File:/repo/a.ts',
      label: 'a.ts',
      type: 'File',
      properties: { filePath: '/repo/a.ts', name: 'a.ts' },
    })
  })
})
