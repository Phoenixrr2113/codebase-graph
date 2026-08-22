import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { EMBEDDABLE_LABELS } from '@codegraph/types'
import { AppShell } from './app-shell'
import {
  GraphCanvas,
  planCanvasSelection,
  type GraphNode,
} from './graph-canvas'
import { GraphControls } from './graph-controls'
import { GraphLegend, buildNodeLegend } from './graph-legend'

const selectedNode: GraphNode = {
  id: 'sym:v1:4444444444444444444444444444444444444444444444444444444444444444',
  label: 'run',
  type: 'Function',
  properties: { name: 'run', filePath: '/repo/main.ts', startLine: 4 },
}

describe('graph legend derivation', () => {
  it('derives every node label from EMBEDDABLE_LABELS with an explicit style', () => {
    const legend = buildNodeLegend(EMBEDDABLE_LABELS)

    expect(legend.map((item) => item.label)).toEqual([...EMBEDDABLE_LABELS])
    expect(legend.every((item) => item.color.length > 0 && item.shape.length > 0)).toBe(true)
  })

  it('fails loudly when a shared label has no dashboard legend style', () => {
    expect(() => buildNodeLegend([...EMBEDDABLE_LABELS, 'FutureLabel'])).toThrow(
      'Missing graph legend style for FutureLabel',
    )
  })
})

describe('externally selected canvas nodes', () => {
  it('adds an unloaded node without inventing edges outside the full-graph window', () => {
    const loaded: GraphNode[] = [{
      id: 'File:/repo/main.ts',
      label: 'main.ts',
      type: 'File',
      properties: { filePath: '/repo/main.ts' },
    }]
    const plan = planCanvasSelection(loaded, selectedNode)

    expect(plan).toEqual({
      nodeId: selectedNode.id,
      nodeToAdd: {
        data: {
          id: selectedNode.id,
          label: selectedNode.label,
          type: selectedNode.type,
          ...selectedNode.properties,
        },
      },
    })
  })
})

describe('graph explorer accessibility', () => {
  it('names the Cytoscape region and exposes a keyboard node-selection list', () => {
    const html = renderToStaticMarkup(
      <GraphCanvas
        apiUrl="http://dashboard.test"
        onNodeSelect={vi.fn()}
        selectedNode={null}
        highlightedNodeIds={new Set()}
        hiddenEdgeTypes={new Set()}
        hiddenNodeTypes={new Set()}
      />,
    )

    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Code graph visualization"')
    expect(html).toContain('aria-label="Graph nodes"')
  })

  it('exposes disclosure and pressed states on legend filters and layout choices', () => {
    const legendHtml = renderToStaticMarkup(
      <GraphLegend
        hiddenEdgeTypes={new Set(['CALLS'])}
        onToggleEdgeType={vi.fn()}
        hiddenNodeTypes={new Set(['File'])}
        onToggleNodeType={vi.fn()}
      />,
    )
    const controlsHtml = renderToStaticMarkup(
      <GraphControls
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFit={vi.fn()}
        onRelayout={vi.fn()}
        nodeCount={3}
        layout="cose"
      />,
    )

    expect(legendHtml).toContain('aria-expanded="true"')
    expect(legendHtml).toContain('aria-controls="graph-legend-content"')
    expect(legendHtml).toContain('aria-pressed="false"')
    expect(legendHtml).toContain('aria-pressed="true"')
    expect(controlsHtml).toContain('aria-pressed="true"')
    expect(controlsHtml).toContain('aria-pressed="false"')
  })

  it('exposes Query as a controlled disclosure', () => {
    const html = renderToStaticMarkup(<AppShell projectId="project-1" projectName="CodeGraph" />)

    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="query-panel"')
  })
})
