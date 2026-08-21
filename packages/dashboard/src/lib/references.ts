/**
 * Where a symbol is used.
 *
 * The canvas only ever holds a window onto the graph, so a symbol's callers in
 * other files are usually not on screen at all. Selecting a node therefore asks
 * the server for its references rather than reading them off the rendered
 * neighbourhood: the panel can list every one, and the canvas highlights those
 * that happen to be loaded.
 */

import { API_URL } from './api'

export type ReferenceEdgeType = 'CALLS' | 'USES_TYPE' | 'EXTENDS' | 'IMPLEMENTS' | 'RENDERS'

export interface SymbolReference {
  name: string
  nodeType: string
  filePath: string
  startLine?: number
  edgeType: ReferenceEdgeType
  sameFile: boolean
}

export interface SymbolReferences {
  references: SymbolReference[]
  referencingFiles: string[]
  truncated: boolean
}

interface SymbolNodeIdentity {
  name?: string | null
  filePath?: string | null
  startLine?: number | null
  line?: number | null
}

export function canonicalSymbolNodeId(label: string, node: SymbolNodeIdentity): string {
  const name = node.name ?? ''
  const filePath = node.filePath ?? ''
  const line = node.startLine ?? node.line ?? 0
  return `${label}:${filePath}:${name}:${line}`
}

export interface FileRelationshipNode {
  id: string
  label: string
  displayName: string
  filePath?: string
  data: Record<string, unknown>
}

export interface FileRelationships {
  filePath: string
  containedSymbols: FileRelationshipNode[]
  imports: FileRelationshipNode[]
  importers: FileRelationshipNode[]
  knowledgeEntities: FileRelationshipNode[]
}

/** Node labels that declare something another file can use. */
const REFERENCEABLE_TYPES = new Set([
  'Function',
  'Class',
  'Interface',
  'Variable',
  'Type',
  'Component',
])

export function isReferenceable(nodeType: string): boolean {
  return REFERENCEABLE_TYPES.has(nodeType)
}

/**
 * Identity used to match a reference against a node on the canvas.
 *
 * The line is part of the identity because a file can hold several symbols of
 * the same name, and only one of them is the end of the relationship. Matching
 * on path and name alone lit up all of them.
 */
export function referenceKey(
  filePath: string | undefined,
  name: string,
  startLine: number | undefined,
): string {
  return `${filePath ?? ''}::${name}::${startLine ?? ''}`
}

export async function fetchReferences(
  name: string,
  filePath: string | undefined,
  startLine: number | undefined,
  signal?: AbortSignal,
): Promise<SymbolReferences> {
  const params = new URLSearchParams({ name })
  if (filePath) params.set('path', filePath)
  if (startLine != null) params.set('startLine', String(startLine))

  const response = await fetch(`${API_URL}/api/graph/references?${params.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`References request failed with ${response.status}`)
  }
  return (await response.json()) as SymbolReferences
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRelationshipNode(value: unknown): FileRelationshipNode {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.label !== 'string'
    || typeof value.displayName !== 'string'
    || (value.filePath !== undefined && typeof value.filePath !== 'string')
    || !isRecord(value.data)
  ) {
    throw new Error('Invalid file relationships response')
  }

  return {
    id: value.id,
    label: value.label,
    displayName: value.displayName,
    ...(value.filePath !== undefined ? { filePath: value.filePath } : {}),
    data: value.data,
  }
}

export function parseFileRelationships(value: unknown): FileRelationships {
  if (
    !isRecord(value)
    || typeof value.filePath !== 'string'
    || !Array.isArray(value.containedSymbols)
    || !Array.isArray(value.imports)
    || !Array.isArray(value.importers)
    || !Array.isArray(value.knowledgeEntities)
  ) {
    throw new Error('Invalid file relationships response')
  }

  return {
    filePath: value.filePath,
    containedSymbols: value.containedSymbols.map(parseRelationshipNode),
    imports: value.imports.map(parseRelationshipNode),
    importers: value.importers.map(parseRelationshipNode),
    knowledgeEntities: value.knowledgeEntities.map(parseRelationshipNode),
  }
}

export async function fetchFileRelationships(
  filePath: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FileRelationships> {
  const params = new URLSearchParams({ path: filePath })
  const response = await fetchImpl(
    `${API_URL}/api/graph/file-relationships?${params.toString()}`,
    { signal },
  )
  if (!response.ok) {
    throw new Error(`File relationships request failed with ${response.status}`)
  }
  return parseFileRelationships(await response.json())
}
