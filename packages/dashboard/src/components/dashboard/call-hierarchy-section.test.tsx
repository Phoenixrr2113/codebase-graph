import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  CallBranchContent,
  CallHierarchySection,
  fetchCallBranch,
} from './call-hierarchy-section'
import { ImpactContent } from './impact-section'
import type { BlastRadiusResult, CallHierarchyResult } from '@/lib/analysis'

const centerId = `sym:v1:${'a'.repeat(64)}`
const callerId = `sym:v1:${'b'.repeat(64)}`

const hierarchy: CallHierarchyResult = {
  status: 'ok',
  input: { id: centerId, direction: 'callers', limit: 100 },
  projectRoot: '/repo',
  center: { id: centerId, name: 'run', nodeType: 'Function', filePath: '/repo/run.ts', startLine: 2 },
  callers: [{
    id: callerId,
    name: 'main',
    nodeType: 'Variable',
    filePath: '/repo/main.ts',
    startLine: 6,
    callLine: 9,
    count: 2,
    via: 'closure',
  }],
  callees: [],
  callersTruncated: false,
  calleesTruncated: false,
  caveats: ['Calls are statically resolved.'],
}

describe('call hierarchy branches', () => {
  it('fetches a single direction by persisted id with an abort signal', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(hierarchy), { status: 200 }))
    const controller = new AbortController()

    const result = await fetchCallBranch(centerId, 'callers', controller.signal, fetcher)

    expect(result).toEqual(hierarchy)
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining(`/api/analysis/call-hierarchy?id=${encodeURIComponent(centerId)}&direction=callers`),
      { signal: controller.signal },
    )
  })

  it('renders disclosure aria, live states, closure metadata, caveats, and truncation', () => {
    const section = renderToStaticMarkup(
      <CallHierarchySection symbolId={centerId} onSelect={vi.fn()} />,
    )
    const loading = renderToStaticMarkup(
      <CallBranchContent direction="callers" state={{ status: 'loading' }} onSelect={vi.fn()} />,
    )
    const success = renderToStaticMarkup(
      <CallBranchContent
        direction="callers"
        state={{ status: 'success', data: { ...hierarchy, callersTruncated: true } }}
        onSelect={vi.fn()}
      />,
    )

    expect(section).toContain('aria-expanded="false"')
    expect(section).toContain('aria-controls=')
    expect(loading).toContain('role="status"')
    expect(loading).toContain('aria-live="polite"')
    expect(success).toContain('Variable')
    expect(success).toContain('closure')
    expect(success).toContain('Calls are statically resolved.')
    expect(success).toContain('Results truncated')
    expect(success).toContain('focus-visible:ring-2')
  })
})

describe('impact section states', () => {
  const impact: BlastRadiusResult = {
    status: 'ok',
    input: { id: centerId, depth: 3, limit: 100 },
    projectRoot: '/repo',
    target: { id: centerId, name: 'run', nodeType: 'Function', filePath: '/repo/run.ts' },
    items: [{ id: callerId, name: 'main', nodeType: 'Function', filePath: '/repo/main.ts', depth: 2 }],
    maxDepth: 3,
    countsByDepth: { 2: 1 },
    countsByNodeType: { Function: 1 },
    truncated: true,
    caveats: ['Dynamic dispatch is not included.'],
  }

  it('renders grouped impact with live, caveat, truncation, and focus states', () => {
    const loading = renderToStaticMarkup(<ImpactContent state={{ status: 'loading' }} onSelect={vi.fn()} />)
    const success = renderToStaticMarkup(<ImpactContent state={{ status: 'success', data: impact }} onSelect={vi.fn()} />)

    expect(loading).toContain('role="status"')
    expect(loading).toContain('aria-live="polite"')
    expect(success).toContain('Depth 2')
    expect(success).toContain('Dynamic dispatch is not included.')
    expect(success).toContain('Results truncated')
    expect(success).toContain(callerId)
    expect(success).toContain('focus-visible:ring-2')
  })
})
