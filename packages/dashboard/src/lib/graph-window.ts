export type GraphViewMode = 'files' | 'symbols'
export type GraphWindowLimit = 300 | 500 | 1000

export interface GraphNodeData {
  id: string
  label: string
  type: string
  properties: Record<string, unknown>
}

export interface GraphEdgeData {
  id: string
  source: string
  target: string
  label: string
}

export interface GraphTruncation {
  incoming: boolean
  outgoing: boolean
  window?: boolean
}

export interface GraphWindow {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
  totalNodes: number
  totalEdges: number
  windowOrder: string
  truncation: GraphTruncation
  offset: number
  limit: number
  returned: number
  hasMore: boolean
  nextOffset: number | null
}

export interface NeighborWindow {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
  incomingTruncated: boolean
  outgoingTruncated: boolean
}

export interface GraphPosition {
  x: number
  y: number
}

export interface SeededGraphNode {
  node: GraphNodeData
  position: GraphPosition
}

export interface GraphExpansionPlan {
  window: GraphWindow
  newNodes: SeededGraphNode[]
  newEdges: GraphEdgeData[]
  preserveViewport: true
  runLayout: false
  fit: false
}

export interface GraphViewState {
  mode: GraphViewMode
  limit: GraphWindowLimit
  offset: number
}

export interface GraphCanvasViewState extends GraphViewState {
  fileScope: GraphNodeData | null
  expansions: GraphNodeData[]
}

interface GraphWindowRequest {
  apiUrl: string
  mode: GraphViewMode
  limit: GraphWindowLimit
  offset?: number
  includeExternals?: boolean
  projectId?: string | null
  fileScope?: GraphNodeData | null
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

const MODE_STORAGE_KEY = 'codegraph.graphMode'
const LIMIT_STORAGE_KEY = 'codegraph.graphLimit'
const OFFSET_STORAGE_KEY = 'codegraph.graphOffset'
const EXTERNALS_STORAGE_KEY = 'codegraph.graphIncludeExternals'
export const DEFAULT_GRAPH_VIEW: GraphViewState = { mode: 'symbols', limit: 300, offset: 0 }
const VALID_LIMITS = new Set<GraphWindowLimit>([300, 500, 1000])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMode(value: string | null): GraphViewMode | null {
  return value === 'files' || value === 'symbols' ? value : null
}

function parseLimit(value: string | null): GraphWindowLimit | null {
  if (value === null) return null
  const numeric = Number(value)
  return VALID_LIMITS.has(numeric as GraphWindowLimit) ? numeric as GraphWindowLimit : null
}

function parseOffset(value: string | null): number | null {
  if (value === null) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null
}

function parseBooleanLiteral(value: string | null): boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

export function readGraphViewState(
  location: Pick<Location, 'href'>,
  storage: Pick<Storage, 'getItem'>,
): GraphViewState {
  const url = new URL(location.href)
  return {
    mode: parseMode(url.searchParams.get('graphMode'))
      ?? parseMode(storage.getItem(MODE_STORAGE_KEY))
      ?? DEFAULT_GRAPH_VIEW.mode,
    limit: parseLimit(url.searchParams.get('graphLimit'))
      ?? parseLimit(storage.getItem(LIMIT_STORAGE_KEY))
      ?? DEFAULT_GRAPH_VIEW.limit,
    offset: parseOffset(url.searchParams.get('graphOffset'))
      ?? parseOffset(storage.getItem(OFFSET_STORAGE_KEY))
      ?? DEFAULT_GRAPH_VIEW.offset,
  }
}

export function persistGraphViewState(
  state: GraphViewState,
  location: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState'>,
  storage: Pick<Storage, 'setItem'>,
): void {
  const url = new URL(location.href)
  url.searchParams.set('graphMode', state.mode)
  url.searchParams.set('graphLimit', String(state.limit))
  url.searchParams.set('graphOffset', String(state.offset))
  history.replaceState(null, '', url.href)
  storage.setItem(MODE_STORAGE_KEY, state.mode)
  storage.setItem(LIMIT_STORAGE_KEY, String(state.limit))
  storage.setItem(OFFSET_STORAGE_KEY, String(state.offset))
}

export function readGraphExternalsState(
  location: Pick<Location, 'href'>,
  storage: Pick<Storage, 'getItem'>,
): boolean {
  const url = new URL(location.href)
  return parseBooleanLiteral(url.searchParams.get('graphExternals'))
    ?? parseBooleanLiteral(storage.getItem(EXTERNALS_STORAGE_KEY))
    ?? true
}

export function persistGraphExternalsState(
  value: boolean,
  location: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState'>,
  storage: Pick<Storage, 'setItem'>,
): void {
  const serialized = String(value)
  const url = new URL(location.href)
  url.searchParams.set('graphExternals', serialized)
  history.replaceState(null, '', url.href)
  storage.setItem(EXTERNALS_STORAGE_KEY, serialized)
}

function parseGraphNode(value: unknown): GraphNodeData {
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new Error('Invalid graph node response')
  }
  const data = isRecord(value.data) ? value.data : {}
  const label = typeof value.displayName === 'string'
    ? value.displayName
    : typeof data.name === 'string'
      ? data.name
      : value.id
  const type = typeof value.label === 'string'
    ? value.label
    : typeof data.type === 'string'
      ? data.type
      : 'File'
  const filePath = typeof value.filePath === 'string'
    ? value.filePath
    : typeof data.filePath === 'string'
      ? data.filePath
      : undefined
  const symbolCount = typeof value.symbolCount === 'number' ? value.symbolCount : undefined
  const startLine = typeof value.startLine === 'number' ? value.startLine : undefined
  const degree = typeof value.degree === 'number' ? value.degree : undefined

  return {
    id: value.id,
    label,
    type,
    properties: {
      ...data,
      ...(filePath !== undefined ? { filePath } : {}),
      ...(startLine !== undefined ? { startLine } : {}),
      ...(degree !== undefined ? { degree } : {}),
      ...(symbolCount !== undefined ? { symbolCount } : {}),
    },
  }
}

function parseGraphEdge(value: unknown): GraphEdgeData {
  if (
    !isRecord(value)
    || typeof value.source !== 'string'
    || typeof value.target !== 'string'
    || typeof value.label !== 'string'
  ) {
    throw new Error('Invalid graph edge response')
  }
  return {
    id: typeof value.id === 'string'
      ? value.id
      : deriveGraphEdgeId(value.label, value.source, value.target),
    source: value.source,
    target: value.target,
    label: value.label,
  }
}

function deriveGraphEdgeId(label: string, source: string, target: string): string {
  return `${label}:${source}:${target}`
}

function parseCompactGraphEdges(
  value: Record<string, unknown>,
  rawNodeIds: readonly unknown[],
): GraphEdgeData[] {
  if (
    value.edgeFormat !== 'indexed-v1'
    || !Array.isArray(value.edgeTypes)
    || !Array.isArray(value.edges)
  ) {
    throw new Error('Invalid compact graph edges response')
  }

  const nodeIds: string[] = []
  const seenNodeIds = new Set<string>()
  for (const rawNodeId of rawNodeIds) {
    if (
      typeof rawNodeId !== 'string'
      || rawNodeId.trim().length === 0
      || seenNodeIds.has(rawNodeId)
    ) {
      throw new Error('Invalid compact graph edges response')
    }
    seenNodeIds.add(rawNodeId)
    nodeIds.push(rawNodeId)
  }

  const edgeTypes: string[] = []
  const seenEdgeTypes = new Set<string>()
  for (const rawEdgeType of value.edgeTypes) {
    if (
      typeof rawEdgeType !== 'string'
      || rawEdgeType.trim().length === 0
      || seenEdgeTypes.has(rawEdgeType)
    ) {
      throw new Error('Invalid compact graph edges response')
    }
    seenEdgeTypes.add(rawEdgeType)
    edgeTypes.push(rawEdgeType)
  }

  return value.edges.map((rawTuple): GraphEdgeData => {
    if (
      !Array.isArray(rawTuple)
      || rawTuple.length !== 3
      || !rawTuple.every(
        (index) => Number.isSafeInteger(index) && index >= 0 && !Object.is(index, -0),
      )
    ) {
      throw new Error('Invalid compact graph edges response')
    }
    const [sourceIndex, targetIndex, edgeTypeIndex] = rawTuple as [number, number, number]
    const source = nodeIds[sourceIndex]
    const target = nodeIds[targetIndex]
    const label = edgeTypes[edgeTypeIndex]
    if (source === undefined || target === undefined || label === undefined) {
      throw new Error('Invalid compact graph edges response')
    }
    return {
      id: deriveGraphEdgeId(label, source, target),
      source,
      target,
      label,
    }
  })
}

function parseGraphEdges(
  value: Record<string, unknown>,
  rawNodeIds: readonly unknown[],
  compactRequested: boolean,
): GraphEdgeData[] {
  if (compactRequested) return parseCompactGraphEdges(value, rawNodeIds)
  if (!Array.isArray(value.edges)) throw new Error('Invalid graph edge response')
  return value.edges.map(parseGraphEdge)
}

function parseTruncation(value: Record<string, unknown>): GraphTruncation {
  const nested = isRecord(value.truncation) ? value.truncation : null
  return {
    incoming: value.incomingTruncated === true || nested?.incoming === true,
    outgoing: value.outgoingTruncated === true || nested?.outgoing === true,
    ...(value.truncated === true || nested?.window === true ? { window: true } : {}),
  }
}

function parseGraphWindow(
  value: unknown,
  fallback: { offset: number; limit: number } = { offset: 0, limit: 100 },
): GraphWindow {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('Invalid graph window response')
  }
  const edges = parseGraphEdges(
    value,
    value.nodes.map((node) => isRecord(node) ? node.id : undefined),
    true,
  )
  const nodes = value.nodes.map(parseGraphNode)
  if (
    value.totalNodes !== undefined && typeof value.totalNodes !== 'number'
    || value.totalEdges !== undefined && typeof value.totalEdges !== 'number'
    || value.windowOrder !== undefined && typeof value.windowOrder !== 'string'
    || value.offset !== undefined && typeof value.offset !== 'number'
    || value.limit !== undefined && typeof value.limit !== 'number'
    || value.returned !== undefined && typeof value.returned !== 'number'
    || value.hasMore !== undefined && typeof value.hasMore !== 'boolean'
    || value.nextOffset !== undefined && value.nextOffset !== null && typeof value.nextOffset !== 'number'
  ) {
    throw new Error('Invalid graph window totals')
  }
  return {
    nodes,
    edges,
    totalNodes: value.totalNodes ?? nodes.length,
    totalEdges: value.totalEdges ?? edges.length,
    windowOrder: value.windowOrder ?? 'degree-descending',
    truncation: parseTruncation(value),
    offset: value.offset ?? fallback.offset,
    limit: value.limit ?? fallback.limit,
    returned: value.returned ?? nodes.length,
    hasMore: value.hasMore ?? (fallback.offset + nodes.length < (value.totalNodes ?? nodes.length)),
    nextOffset: value.nextOffset === null
      ? null
      : value.nextOffset ?? (
        fallback.offset + nodes.length < (value.totalNodes ?? nodes.length)
          ? fallback.offset + nodes.length
          : null
      ),
  }
}

function parseNeighborWindow(value: unknown): NeighborWindow {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('Invalid graph neighbors response')
  }
  const edges = parseGraphEdges(
    value,
    value.nodes.map((node) => isRecord(node) ? node.id : undefined),
    true,
  )
  const truncation = parseTruncation(value)
  return {
    nodes: value.nodes.map(parseGraphNode),
    edges,
    incomingTruncated: truncation.incoming,
    outgoingTruncated: truncation.outgoing,
  }
}

async function fetchJson(
  url: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, { signal })
  if (!response.ok) throw new Error(`Graph request failed with ${response.status}`)
  return response.json()
}

export async function fetchNeighbors(
  apiUrl: string,
  nodeId: string,
  limit: GraphWindowLimit,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<NeighborWindow> {
  const params = new URLSearchParams({
    id: nodeId,
    limit: String(limit),
    edgeFormat: 'indexed-v1',
  })
  return parseNeighborWindow(await fetchJson(
    `${apiUrl}/api/graph/neighbors?${params.toString()}`,
    signal,
    fetchImpl,
  ))
}

export async function fetchGraphNodeDetail(
  apiUrl: string,
  node: GraphNodeData,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<GraphNodeData> {
  const filePath = node.properties.filePath
  if (typeof filePath !== 'string') return node

  const params = new URLSearchParams({ path: filePath })
  const value = await fetchJson(
    `${apiUrl}/api/graph/file?${params.toString()}`,
    signal,
    fetchImpl,
  )
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    throw new Error('Invalid graph detail response')
  }
  const detail = value.nodes.map(parseGraphNode).find((entry) => entry.id === node.id)
  if (!detail) return node
  return {
    ...detail,
    properties: { ...node.properties, ...detail.properties },
  }
}

async function fetchFileSymbolWindow(request: GraphWindowRequest): Promise<GraphWindow> {
  const fileScope = request.fileScope
  if (!fileScope || typeof fileScope.properties.filePath !== 'string') {
    throw new Error('File symbol scope requires a file path')
  }
  const fetchImpl = request.fetchImpl ?? fetch
  const relationshipParams = new URLSearchParams({
    path: fileScope.properties.filePath,
    limit: String(request.limit),
  })
  const [relationshipsValue, neighbors] = await Promise.all([
    fetchJson(
      `${request.apiUrl}/api/graph/file-relationships?${relationshipParams.toString()}`,
      request.signal,
      fetchImpl,
    ),
    fetchNeighbors(request.apiUrl, fileScope.id, request.limit, request.signal, fetchImpl),
  ])
  if (!isRecord(relationshipsValue) || !Array.isArray(relationshipsValue.containedSymbols)) {
    throw new Error('Invalid file relationships response')
  }
  const relationshipTotals = isRecord(relationshipsValue.totals)
    ? relationshipsValue.totals
    : null
  const containedSymbolTotal = relationshipTotals?.containedSymbols
  if (containedSymbolTotal !== undefined && typeof containedSymbolTotal !== 'number') {
    throw new Error('Invalid file relationship totals')
  }
  const relationshipTruncation = isRecord(relationshipsValue.truncated)
    ? relationshipsValue.truncated
    : null
  const containedSymbolsTruncated = relationshipTruncation?.containedSymbols
  if (
    containedSymbolsTruncated !== undefined
    && typeof containedSymbolsTruncated !== 'boolean'
  ) {
    throw new Error('Invalid file relationship truncation')
  }
  const relationshipsTruncated = relationshipsValue.truncated === true
    || containedSymbolsTruncated === true
  const relationshipNodes = relationshipsValue.containedSymbols.map(parseGraphNode)
  const symbolIds = new Set(relationshipNodes.map((node) => node.id))
  const neighborNodes = new Map(neighbors.nodes.map((node) => [node.id, node]))
  const nodes = relationshipNodes.map((node) => neighborNodes.get(node.id) ?? node)
  const edges = neighbors.edges.filter(
    (edge) => symbolIds.has(edge.source) && symbolIds.has(edge.target),
  )
  return {
    nodes,
    edges,
    totalNodes: containedSymbolTotal ?? nodes.length,
    totalEdges: edges.length,
    windowOrder: 'file-contained',
    truncation: {
      incoming: neighbors.incomingTruncated,
      outgoing: neighbors.outgoingTruncated,
      ...(relationshipsTruncated ? { window: true } : {}),
    },
    offset: 0,
    limit: request.limit,
    returned: nodes.length,
    hasMore: relationshipsTruncated,
    nextOffset: null,
  }
}

export async function fetchGraphWindow(request: GraphWindowRequest): Promise<GraphWindow> {
  if (request.mode === 'symbols' && request.fileScope) {
    return fetchFileSymbolWindow(request)
  }
  const fetchImpl = request.fetchImpl ?? fetch
  const params = new URLSearchParams()
  if (request.projectId) params.set('projectId', request.projectId)
  params.set('limit', String(request.limit))
  params.set('offset', String(request.offset ?? 0))
  params.set('edgeFormat', 'indexed-v1')
  if (request.mode === 'files') {
    params.set('includeExternals', String(request.includeExternals ?? true))
  }
  const endpoint = request.mode === 'files' ? 'files' : 'full'
  return parseGraphWindow(await fetchJson(
    `${request.apiUrl}/api/graph/${endpoint}?${params.toString()}`,
    request.signal,
    fetchImpl,
  ), { offset: request.offset ?? 0, limit: request.limit })
}

export function planInducedEdgeRequests(
  existingIds: readonly string[],
  newIds: readonly string[],
  cap = 2_000,
): string[][] {
  const uniqueNewIds = [...new Set(newIds)]
  if (uniqueNewIds.length === 0) return []
  if (uniqueNewIds.length > cap) throw new Error(`New graph page exceeds induced-edge cap of ${cap}`)
  const newIdSet = new Set(uniqueNewIds)
  const uniqueExistingIds = [...new Set(existingIds)].filter((id) => !newIdSet.has(id))
  const existingChunkSize = cap - uniqueNewIds.length
  if (existingChunkSize === 0) return [uniqueNewIds]
  if (uniqueExistingIds.length === 0) return [uniqueNewIds]

  const requests: string[][] = []
  for (let index = 0; index < uniqueExistingIds.length; index += existingChunkSize) {
    requests.push([...uniqueNewIds, ...uniqueExistingIds.slice(index, index + existingChunkSize)])
  }
  return requests
}

export async function fetchGraphInducedEdges(
  apiUrl: string,
  idChunks: readonly (readonly string[])[],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  projectId?: string | null,
): Promise<GraphEdgeData[]> {
  const params = new URLSearchParams()
  if (projectId) params.set('projectId', projectId)
  const query = params.size > 0 ? `?${params.toString()}` : ''
  const responses = await Promise.all(idChunks.map(async (ids) => {
    const response = await fetchImpl(`${apiUrl}/api/graph/induced-edges${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids,
        ...(projectId ? { projectId } : {}),
        edgeFormat: 'indexed-v1',
      }),
      signal,
    })
    if (!response.ok) throw new Error(`Graph request failed with ${response.status}`)
    const value: unknown = await response.json()
    if (!isRecord(value) || !Array.isArray(value.nodeIds)) {
      throw new Error('Invalid induced graph edges response')
    }
    return parseGraphEdges(value, value.nodeIds, true)
  }))
  const edges = new Map<string, GraphEdgeData>()
  responses.flat().forEach((edge) => edges.set(edge.id, edges.get(edge.id) ?? edge))
  return [...edges.values()]
}

export function mergeGraphWindow(base: GraphWindow, incoming: NeighborWindow): GraphWindow {
  const nodes = new Map(base.nodes.map((node) => [node.id, node]))
  incoming.nodes.forEach((node) => nodes.set(node.id, nodes.get(node.id) ?? node))
  const edges = new Map(base.edges.map((edge) => [edge.id, edge]))
  incoming.edges.forEach((edge) => edges.set(edge.id, edges.get(edge.id) ?? edge))
  return {
    ...base,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    truncation: {
      incoming: base.truncation.incoming || incoming.incomingTruncated,
      outgoing: base.truncation.outgoing || incoming.outgoingTruncated,
      ...(base.truncation.window ? { window: true } : {}),
    },
  }
}

export interface GraphBounds {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function planGraphPageAppend(
  base: GraphWindow,
  incoming: GraphWindow,
  inducedEdges: readonly GraphEdgeData[],
  bounds: GraphBounds,
): GraphExpansionPlan {
  const existingNodeIds = new Set(base.nodes.map((node) => node.id))
  const newNodes = incoming.nodes.filter((node) => !existingNodeIds.has(node.id))
  const columns = Math.max(1, Math.ceil(Math.sqrt(newNodes.length)))
  const seededNodes = newNodes.map((node, index): SeededGraphNode => ({
    node,
    position: {
      x: bounds.x2 + 120 + ((index % columns) * 84),
      y: bounds.y1 + (Math.floor(index / columns) * 84),
    },
  }))
  const nodes = new Map(base.nodes.map((node) => [node.id, node]))
  incoming.nodes.forEach((node) => nodes.set(node.id, nodes.get(node.id) ?? node))
  const nodeIds = new Set(nodes.keys())
  const edges = new Map(base.edges.map((edge) => [edge.id, edge]))
  const incomingEdges = [...incoming.edges, ...inducedEdges]
  incomingEdges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .forEach((edge) => edges.set(edge.id, edges.get(edge.id) ?? edge))
  const existingEdgeIds = new Set(base.edges.map((edge) => edge.id))
  const window: GraphWindow = {
    ...base,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    totalNodes: incoming.totalNodes,
    totalEdges: incoming.totalEdges,
    returned: Math.min(incoming.totalNodes, base.returned + incoming.returned),
    hasMore: incoming.hasMore,
    nextOffset: incoming.nextOffset,
    truncation: {
      incoming: base.truncation.incoming || incoming.truncation.incoming,
      outgoing: base.truncation.outgoing || incoming.truncation.outgoing,
      ...(incoming.hasMore ? { window: true } : {}),
    },
  }
  return {
    window,
    newNodes: seededNodes,
    newEdges: [...edges.values()].filter((edge) => !existingEdgeIds.has(edge.id)),
    preserveViewport: true,
    runLayout: false,
    fit: false,
  }
}

function stableFraction(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) / 4_294_967_295
}

export function planGraphExpansion(
  base: GraphWindow,
  incoming: NeighborWindow,
  sourceNodeId: string,
  sourcePosition: GraphPosition,
): GraphExpansionPlan {
  const window = mergeGraphWindow(base, incoming)
  const existingNodeIds = new Set(base.nodes.map((node) => node.id))
  const existingEdgeIds = new Set(base.edges.map((edge) => edge.id))
  const mergedNodeIds = new Set(window.nodes.map((node) => node.id))
  const newNodes = incoming.nodes.filter((node) => !existingNodeIds.has(node.id))
  const count = newNodes.length
  const angleStep = count > 0 ? (Math.PI * 2) / count : 0
  const radius = Math.max(96, (count * 72) / (Math.PI * 2))
  const seededNodes = newNodes.map((node, index): SeededGraphNode => {
    const jitter = (stableFraction(`${sourceNodeId}:${node.id}`) - 0.5)
      * Math.min(angleStep * 0.2, 0.18)
    const angle = (-Math.PI / 2) + (index * angleStep) + jitter
    return {
      node,
      position: {
        x: sourcePosition.x + (Math.cos(angle) * radius),
        y: sourcePosition.y + (Math.sin(angle) * radius),
      },
    }
  })

  return {
    window,
    newNodes: seededNodes,
    newEdges: incoming.edges
      .filter((edge) => !existingEdgeIds.has(edge.id))
      .filter((edge) => mergedNodeIds.has(edge.source) && mergedNodeIds.has(edge.target)),
    preserveViewport: true,
    runLayout: false,
    fit: false,
  }
}

export function resetGraphWindow(base: GraphWindow): GraphWindow {
  return base
}

export function appendGraphExpansion(
  view: GraphCanvasViewState,
  node: GraphNodeData,
): GraphCanvasViewState {
  if (view.expansions.some((entry) => entry.id === node.id)) return view
  return { ...view, expansions: [...view.expansions, node] }
}

export function resetGraphExpansions(view: GraphCanvasViewState): GraphCanvasViewState {
  if (view.expansions.length === 0) return view
  return { ...view, expansions: [] }
}

export function resetGraphView(view: GraphCanvasViewState): GraphCanvasViewState {
  if (view.offset === 0 && view.expansions.length === 0) return view
  return { ...view, offset: 0, expansions: [] }
}

export async function restoreGraphWindow(
  base: GraphWindow,
  expansions: readonly GraphNodeData[],
  loadExpansion: (node: GraphNodeData) => Promise<NeighborWindow>,
): Promise<GraphWindow> {
  let restored = base
  for (const node of expansions) {
    restored = mergeGraphWindow(restored, await loadExpansion(node))
  }
  return restored
}
