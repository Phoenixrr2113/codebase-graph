import cytoscape from 'cytoscape'
import { describe, expect, it } from 'vitest'
import { applyCanvasExpansion } from './graph-canvas'
import {
  planGraphPageAppend,
  planGraphExpansion,
  type GraphNodeData,
  type GraphWindow,
  type NeighborWindow,
} from '@/lib/graph-window'

const sourceNode: GraphNodeData = {
  id: 'source',
  label: 'source',
  type: 'Function',
  properties: {},
}

const existingNode: GraphNodeData = {
  id: 'existing',
  label: 'existing',
  type: 'Function',
  properties: {},
}

const baseWindow: GraphWindow = {
  nodes: [sourceNode, existingNode],
  edges: [],
  totalNodes: 2,
  totalEdges: 0,
  windowOrder: 'degree-desc,id-asc',
  truncation: { incoming: false, outgoing: false },
  offset: 0,
  limit: 300,
  returned: 2,
  hasMore: true,
  nextOffset: 300,
}

const incoming: NeighborWindow = {
  nodes: [
    sourceNode,
    {
      id: 'neighbor-a',
      label: 'neighbor a',
      type: 'Function',
      properties: {},
    },
    {
      id: 'neighbor-b',
      label: 'neighbor b',
      type: 'Function',
      properties: {},
    },
  ],
  edges: [
    { id: 'edge-a', source: 'source', target: 'neighbor-a', label: 'CALLS' },
    { id: 'edge-b', source: 'source', target: 'neighbor-b', label: 'CALLS' },
  ],
  incomingTruncated: false,
  outgoingTruncated: false,
}

describe('incremental graph expansion', () => {
  it('seeds only new nodes around the source without requesting fit or a global layout', () => {
    const sourcePosition = { x: 240, y: 180 }

    const plan = planGraphExpansion(baseWindow, incoming, 'source', sourcePosition)

    expect(plan.preserveViewport).toBe(true)
    expect(plan.fit).toBe(false)
    expect(plan.runLayout).toBe(false)
    expect(plan.newNodes.map(({ node }) => node.id)).toEqual(['neighbor-a', 'neighbor-b'])
    expect(plan.newNodes.every(({ position }) => (
      Math.hypot(position.x - sourcePosition.x, position.y - sourcePosition.y) >= 96
    ))).toBe(true)
    expect(new Set(plan.newNodes.map(({ position }) => `${position.x},${position.y}`)).size).toBe(2)
  })

  it('appends a page without duplicates in a deterministic band beside existing content', () => {
    const incomingPage: GraphWindow = {
      ...baseWindow,
      nodes: [existingNode, ...incoming.nodes.slice(1)],
      edges: incoming.edges,
      offset: 300,
      returned: 3,
      hasMore: false,
      nextOffset: null,
    }
    const plan = planGraphPageAppend(
      baseWindow,
      incomingPage,
      [{ id: 'cross', source: 'existing', target: 'neighbor-a', label: 'CALLS' }],
      { x1: 100, y1: 150, x2: 500, y2: 450 },
    )

    expect(plan.preserveViewport).toBe(true)
    expect(plan.fit).toBe(false)
    expect(plan.runLayout).toBe(false)
    expect(plan.newNodes.map(({ node }) => node.id)).toEqual(['neighbor-a', 'neighbor-b'])
    expect(plan.newNodes.every(({ position }) => position.x > 500)).toBe(true)
    expect(plan.newEdges.map((edge) => edge.id)).toEqual(['edge-a', 'edge-b', 'cross'])
    expect(plan.window.nodes.map((node) => node.id)).toEqual([
      'source',
      'existing',
      'neighbor-a',
      'neighbor-b',
    ])
    expect(plan.window.hasMore).toBe(false)
  })

  it('keeps existing positions and the viewport unchanged while adding an expansion', () => {
    const cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'source' }, position: { x: 100, y: 200 } },
        { data: { id: 'existing' }, position: { x: 450, y: 325 }, locked: true },
      ],
    })
    cy.pan({ x: 17, y: -23 })
    cy.zoom(1.6)
    const sourcePosition = cy.getElementById('source').position()
    const existingPosition = cy.getElementById('existing').position()
    const viewport = { pan: cy.pan(), zoom: cy.zoom() }
    const plan = planGraphExpansion(baseWindow, incoming, 'source', sourcePosition)

    applyCanvasExpansion(cy, plan)

    expect(cy.getElementById('source').position()).toEqual(sourcePosition)
    expect(cy.getElementById('existing').position()).toEqual(existingPosition)
    expect(cy.getElementById('source').locked()).toBe(false)
    expect(cy.getElementById('existing').locked()).toBe(true)
    expect(cy.pan()).toEqual(viewport.pan)
    expect(cy.zoom()).toBe(viewport.zoom)
    expect(cy.getElementById('neighbor-a').position()).toEqual(plan.newNodes[0]?.position)
    expect(cy.getElementById('neighbor-b').position()).toEqual(plan.newNodes[1]?.position)
    cy.destroy()
  })
})
