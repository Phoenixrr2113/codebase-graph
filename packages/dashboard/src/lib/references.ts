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

const REFERENCE_EDGE_TYPES = new Set<ReferenceEdgeType>([
  'CALLS',
  'USES_TYPE',
  'EXTENDS',
  'IMPLEMENTS',
  'RENDERS',
])
const SYMBOL_ID_PATTERN = /^sym:v1:[a-f0-9]{64}$/

export interface SymbolReference {
  id: string
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

export async function fetchReferences(
  id: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<SymbolReferences> {
  const params = new URLSearchParams({ id })

  const response = await fetchImpl(`${API_URL}/api/graph/references?${params.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`References request failed with ${response.status}`)
  }
  return parseSymbolReferences(await response.json())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSymbolReference(value: unknown): value is SymbolReference {
  return isRecord(value)
    && typeof value.id === 'string'
    && SYMBOL_ID_PATTERN.test(value.id)
    && typeof value.name === 'string'
    && typeof value.nodeType === 'string'
    && typeof value.filePath === 'string'
    && (value.startLine === undefined || typeof value.startLine === 'number')
    && typeof value.edgeType === 'string'
    && REFERENCE_EDGE_TYPES.has(value.edgeType as ReferenceEdgeType)
    && typeof value.sameFile === 'boolean'
}

function parseSymbolReferences(value: unknown): SymbolReferences {
  if (
    !isRecord(value)
    || !Array.isArray(value.references)
    || !value.references.every(isSymbolReference)
    || !Array.isArray(value.referencingFiles)
    || !value.referencingFiles.every((filePath) => typeof filePath === 'string')
    || typeof value.truncated !== 'boolean'
  ) {
    throw new Error('Invalid references response')
  }

  return {
    references: value.references,
    referencingFiles: value.referencingFiles,
    truncated: value.truncated,
  }
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
