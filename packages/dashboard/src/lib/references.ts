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

/** Identity used to match a reference against a node on the canvas. */
export function referenceKey(filePath: string | undefined, name: string): string {
  return `${filePath ?? ''}::${name}`
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
