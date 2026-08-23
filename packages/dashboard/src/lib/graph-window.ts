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
}

export interface GraphCanvasViewState extends GraphViewState {
  fileScope: GraphNodeData | null
  expansions: GraphNodeData[]
}

interface GraphWindowRequest {
  apiUrl: string
  mode: GraphViewMode
  limit: GraphWindowLimit
  projectId?: string | null
  fileScope?: GraphNodeData | null
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

const MODE_STORAGE_KEY = 'codegraph.graphMode'
const LIMIT_STORAGE_KEY = 'codegraph.graphLimit'
export const DEFAULT_GRAPH_VIEW: GraphViewState = { mode: 'symbols', limit: 300 }
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
  history.replaceState(null, '', url.href)
  storage.setItem(MODE_STORAGE_KEY, state.mode)
  storage.setItem(LIMIT_STORAGE_KEY, String(state.limit))
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

function parseGraphEdge(value: unknown, index: number): GraphEdgeData {
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
      : `${value.label}:${value.source}:${value.target}:${index}`,
    source: value.source,
    target: value.target,
    label: value.label,
  }
}

function parseTruncation(value: Record<string, unknown>): GraphTruncation {
  const nested = isRecord(value.truncation) ? value.truncation : null
  return {
    incoming: value.incomingTruncated === true || nested?.incoming === true,
    outgoing: value.outgoingTruncated === true || nested?.outgoing === true,
    ...(value.truncated === true || nested?.window === true ? { window: true } : {}),
  }
}

function parseGraphWindow(value: unknown): GraphWindow {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('Invalid graph window response')
  }
  const nodes = value.nodes.map(parseGraphNode)
  const edges = value.edges.map(parseGraphEdge)
  if (
    value.totalNodes !== undefined && typeof value.totalNodes !== 'number'
    || value.totalEdges !== undefined && typeof value.totalEdges !== 'number'
    || value.windowOrder !== undefined && typeof value.windowOrder !== 'string'
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
  }
}

function parseNeighborWindow(value: unknown): NeighborWindow {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('Invalid graph neighbors response')
  }
  const truncation = parseTruncation(value)
  return {
    nodes: value.nodes.map(parseGraphNode),
    edges: value.edges.map(parseGraphEdge),
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
  const params = new URLSearchParams({ id: nodeId, limit: String(limit) })
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
  const endpoint = request.mode === 'files' ? 'files' : 'full'
  return parseGraphWindow(await fetchJson(
    `${request.apiUrl}/api/graph/${endpoint}?${params.toString()}`,
    request.signal,
    fetchImpl,
  ))
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
