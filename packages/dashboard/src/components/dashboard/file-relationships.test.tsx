import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  EntityDetail,
  FileRelationshipsContent,
  relationshipNodeToGraphNode,
} from './entity-detail'
import {
  fetchFileRelationships,
  type FileRelationships,
} from '@/lib/references'

const relationships: FileRelationships = {
  filePath: '/repo/main.ts',
  containedSymbols: [{
    id: 'Function:/repo/main.ts:run:4',
    label: 'Function',
    displayName: 'run',
    filePath: '/repo/main.ts',
    data: { name: 'run', filePath: '/repo/main.ts', startLine: 4 },
  }],
  imports: [{
    id: 'File:/repo/dep.ts',
    label: 'File',
    displayName: 'dep.ts',
    filePath: '/repo/dep.ts',
    data: { name: 'dep.ts', filePath: '/repo/dep.ts' },
  }],
  importers: [],
  knowledgeEntities: [{
    id: 'Entity:Decision:Main entry point',
    label: 'Entity',
    displayName: 'Main entry point',
    data: { text: 'Main entry point', type: 'Decision' },
  }],
}

describe('file relationship loading', () => {
  it('requests the frozen endpoint with an encoded path and validates the response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(relationships), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await fetchFileRelationships('/repo/a file.ts', undefined, fetcher)

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/api/graph/file-relationships?path=%2Frepo%2Fa+file.ts'),
      { signal: undefined },
    )
    expect(result).toEqual(relationships)
  })

  it('rejects malformed payloads instead of rendering untrusted response shapes', async () => {
    const malformedPayloads = [
      {
        filePath: '/repo/main.ts',
        containedSymbols: 'not-an-array',
        imports: [],
        importers: [],
        knowledgeEntities: [],
      },
      {
        filePath: '/repo/main.ts',
        containedSymbols: [{
          id: 42,
          label: 'Function',
          displayName: 'run',
          filePath: '/repo/main.ts',
          data: { name: 'run', startLine: 4 },
        }],
        imports: [],
        importers: [],
        knowledgeEntities: [],
      },
    ]

    for (const payload of malformedPayloads) {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200 }),
      )

      await expect(fetchFileRelationships('/repo/main.ts', undefined, fetcher)).rejects.toThrow(
        'Invalid file relationships response',
      )
    }
  })
})

describe('file relationship panel', () => {
  it('renders explicit loading and error states', () => {
    const loadingHtml = renderToStaticMarkup(<FileRelationshipsContent state={{ status: 'loading' }} />)
    const errorHtml = renderToStaticMarkup(
      <FileRelationshipsContent state={{ status: 'error', message: 'API unavailable' }} />,
    )

    expect(loadingHtml).toContain('role="status"')
    expect(loadingHtml).toContain('Loading file relationships')
    expect(errorHtml).toContain('role="alert"')
    expect(errorHtml).toContain('API unavailable')
  })

  it('renders all four sections and focusable selection buttons', () => {
    const html = renderToStaticMarkup(
      <FileRelationshipsContent state={{ status: 'success', data: relationships }} onSelect={vi.fn()} />,
    )

    expect(html).toContain('Contained symbols')
    expect(html).toContain('Imports')
    expect(html).toContain('Importers')
    expect(html).toContain('Knowledge entities')
    expect(html).toContain('Nothing found')
    expect(html.match(/<button/g)).toHaveLength(3)
    expect(html).toContain('focus-visible:ring-2')
  })

  it('converts frozen wire nodes into dashboard selections without losing identity', () => {
    expect(relationshipNodeToGraphNode(relationships.knowledgeEntities[0]!)).toEqual({
      id: 'Entity:Decision:Main entry point',
      label: 'Main entry point',
      type: 'Entity',
      properties: { text: 'Main entry point', type: 'Decision' },
    })
  })

  it('shows the relationship state only for File details', () => {
    const html = renderToStaticMarkup(
      <EntityDetail
        node={{
          id: 'File:/repo/main.ts',
          label: 'main.ts',
          type: 'File',
          properties: { filePath: '/repo/main.ts' },
        }}
        fileRelationshipsState={{ status: 'loading' }}
      />,
    )

    expect(html).toContain('File relationships')
    expect(html).toContain('Loading file relationships')
  })
})
