import type { GraphNode } from '@/components/dashboard/graph-canvas'
import { API_URL } from './api'

export interface AnalysisSymbol {
  id: string
  name: string
  nodeType: string
  filePath: string
  startLine?: number
}

export interface HistoryCoverage {
  commitCount: number
  earliestCommitDate: string | null
  latestCommitDate: string | null
  historyComplete: boolean
}

export interface ImportCyclesResult {
  input: { rootPath: string; maxDepth: number; limit: number }
  projectRoot: string
  cycles: Array<{ filePaths: string[]; length: number }>
  candidateLimit: number
  candidateLimitReached: boolean
  truncated: boolean
  caveats: string[]
}

export interface UnreferencedExport extends AnalysisSymbol {
  fileImporterCount: number
  confidence: 'higher' | 'lower'
}

export interface UnreferencedExportsResult {
  input: { rootPath: string; limit: number }
  projectRoot: string
  items: UnreferencedExport[]
  truncated: boolean
  caveats: string[]
}

export interface HotspotItem {
  filePath: string
  changeCount: number
  churn: number
  complexity: number
  importDegree: number
  complexityScore: number
  degreeScore: number
}

export interface HotspotsResult {
  input: {
    rootPath: string
    since: string | null
    scoreBy: 'complexity' | 'degree'
    limit: number
  }
  projectRoot: string
  items: HotspotItem[]
  historyCoverage: HistoryCoverage | null
  truncated: boolean
  caveats: string[]
}

export interface ChangeCouplingItem {
  leftFile: string
  rightFile: string
  coChanges: number
  aChanges: number
  bChanges: number
  jaccard: number
}

export interface ChangeCouplingResult {
  input: { rootPath: string; since: string | null; minSupport: number; limit: number }
  projectRoot: string
  items: ChangeCouplingItem[]
  historyCoverage: HistoryCoverage | null
  truncated: boolean
  caveats: string[]
}

export interface BlastRadiusItem extends AnalysisSymbol {
  depth: number
}

export interface BlastRadiusResult {
  status: 'ok' | 'not_found'
  input: { id: string; depth: number; limit: number }
  projectRoot: string | null
  target: AnalysisSymbol | null
  items: BlastRadiusItem[]
  maxDepth: number
  countsByDepth: Record<number, number>
  countsByNodeType: Record<string, number>
  truncated: boolean
  caveats: string[]
}

export interface CallHierarchyItem extends AnalysisSymbol {
  callLine?: number
  count: number
  via: string
}

export interface CallHierarchyResult {
  status: 'ok' | 'not_found'
  input: { id: string; direction: 'callers' | 'callees' | 'both'; limit: number }
  projectRoot: string | null
  center: AnalysisSymbol | null
  callers: CallHierarchyItem[]
  callees: CallHierarchyItem[]
  callersTruncated: boolean
  calleesTruncated: boolean
  caveats: string[]
}

export interface AnalysisResponses {
  cycles: ImportCyclesResult
  unreferenced: UnreferencedExportsResult
  hotspots: HotspotsResult
  coupling: ChangeCouplingResult
}

export type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

type FetchImplementation = typeof fetch

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function stringValue(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  return value
}

function nullableString(value: unknown, message: string): string | null {
  if (value === null) return null
  return stringValue(value, message)
}

function numberValue(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(message)
  return value
}

function booleanValue(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new Error(message)
  return value
}

function arrayValue<T>(value: unknown, parse: (item: unknown) => T, message: string): T[] {
  if (!Array.isArray(value)) throw new Error(message)
  return value.map(parse)
}

function caveats(value: unknown, message: string): string[] {
  return arrayValue(value, (item) => stringValue(item, message), message)
}

function optionalNumber(value: unknown, message: string): number | undefined {
  return value === null || value === undefined ? undefined : numberValue(value, message)
}

function analysisSymbol(value: unknown, message: string): AnalysisSymbol {
  const item = record(value, message)
  const startLine = optionalNumber(item.startLine, message)
  return {
    id: stringValue(item.id, message),
    name: stringValue(item.name, message),
    nodeType: stringValue(item.nodeType, message),
    filePath: stringValue(item.filePath, message),
    ...(startLine === undefined ? {} : { startLine }),
  }
}

function historyCoverage(value: unknown, message: string): HistoryCoverage | null {
  if (value === null) return null
  const item = record(value, message)
  return {
    commitCount: numberValue(item.commitCount, message),
    earliestCommitDate: nullableString(item.earliestCommitDate, message),
    latestCommitDate: nullableString(item.latestCommitDate, message),
    historyComplete: booleanValue(item.historyComplete, message),
  }
}

function baseList(value: unknown, message: string): Record<string, unknown> {
  const response = record(value, message)
  stringValue(response.projectRoot, message)
  booleanValue(response.truncated, message)
  caveats(response.caveats, message)
  record(response.input, message)
  return response
}

export function parseImportCycles(value: unknown): ImportCyclesResult {
  const message = 'Invalid import cycles response'
  const response = baseList(value, message)
  const input = record(response.input, message)
  return {
    input: {
      rootPath: stringValue(input.rootPath, message),
      maxDepth: numberValue(input.maxDepth, message),
      limit: numberValue(input.limit, message),
    },
    projectRoot: stringValue(response.projectRoot, message),
    cycles: arrayValue(response.cycles, (value) => {
      const cycle = record(value, message)
      return {
        filePaths: arrayValue(cycle.filePaths, (path) => stringValue(path, message), message),
        length: numberValue(cycle.length, message),
      }
    }, message),
    candidateLimit: numberValue(response.candidateLimit, message),
    candidateLimitReached: booleanValue(response.candidateLimitReached, message),
    truncated: booleanValue(response.truncated, message),
    caveats: caveats(response.caveats, message),
  }
}

export function parseUnreferencedExports(value: unknown): UnreferencedExportsResult {
  const message = 'Invalid unreferenced exports response'
  const response = baseList(value, message)
  const input = record(response.input, message)
  return {
    input: {
      rootPath: stringValue(input.rootPath, message),
      limit: numberValue(input.limit, message),
    },
    projectRoot: stringValue(response.projectRoot, message),
    items: arrayValue(response.items, (value) => {
      const source = record(value, message)
      const symbol = analysisSymbol(source, message)
      const confidence = stringValue(source.confidence, message)
      if (confidence !== 'higher' && confidence !== 'lower') throw new Error(message)
      return {
        ...symbol,
        fileImporterCount: numberValue(source.fileImporterCount, message),
        confidence,
      }
    }, message),
    truncated: booleanValue(response.truncated, message),
    caveats: caveats(response.caveats, message),
  }
}

export function parseHotspots(value: unknown): HotspotsResult {
  const message = 'Invalid hotspots response'
  const response = baseList(value, message)
  const input = record(response.input, message)
  const scoreBy = stringValue(input.scoreBy, message)
  if (scoreBy !== 'complexity' && scoreBy !== 'degree') throw new Error(message)
  return {
    input: {
      rootPath: stringValue(input.rootPath, message),
      since: nullableString(input.since, message),
      scoreBy,
      limit: numberValue(input.limit, message),
    },
    projectRoot: stringValue(response.projectRoot, message),
    items: arrayValue(response.items, (value) => {
      const item = record(value, message)
      return {
        filePath: stringValue(item.filePath, message),
        changeCount: numberValue(item.changeCount, message),
        churn: numberValue(item.churn, message),
        complexity: numberValue(item.complexity, message),
        importDegree: numberValue(item.importDegree, message),
        complexityScore: numberValue(item.complexityScore, message),
        degreeScore: numberValue(item.degreeScore, message),
      }
    }, message),
    historyCoverage: historyCoverage(response.historyCoverage, message),
    truncated: booleanValue(response.truncated, message),
    caveats: caveats(response.caveats, message),
  }
}

export function parseChangeCoupling(value: unknown): ChangeCouplingResult {
  const message = 'Invalid change coupling response'
  const response = baseList(value, message)
  const input = record(response.input, message)
  return {
    input: {
      rootPath: stringValue(input.rootPath, message),
      since: nullableString(input.since, message),
      minSupport: numberValue(input.minSupport, message),
      limit: numberValue(input.limit, message),
    },
    projectRoot: stringValue(response.projectRoot, message),
    items: arrayValue(response.items, (value) => {
      const item = record(value, message)
      return {
        leftFile: stringValue(item.leftFile, message),
        rightFile: stringValue(item.rightFile, message),
        coChanges: numberValue(item.coChanges, message),
        aChanges: numberValue(item.aChanges, message),
        bChanges: numberValue(item.bChanges, message),
        jaccard: numberValue(item.jaccard, message),
      }
    }, message),
    historyCoverage: historyCoverage(response.historyCoverage, message),
    truncated: booleanValue(response.truncated, message),
    caveats: caveats(response.caveats, message),
  }
}

export function parseBlastRadius(value: unknown): BlastRadiusResult {
  const message = 'Invalid blast radius response'
  const response = record(value, message)
  const status = stringValue(response.status, message)
  if (status !== 'ok' && status !== 'not_found') throw new Error(message)
  const input = record(response.input, message)
  const target = response.target === null ? null : analysisSymbol(response.target, message)
  const countsByDepth = record(response.countsByDepth, message)
  const countsByNodeType = record(response.countsByNodeType, message)
  for (const count of Object.values(countsByDepth)) numberValue(count, message)
  for (const count of Object.values(countsByNodeType)) numberValue(count, message)
  return {
    status,
    input: {
      id: stringValue(input.id, message),
      depth: numberValue(input.depth, message),
      limit: numberValue(input.limit, message),
    },
    projectRoot: nullableString(response.projectRoot, message),
    target,
    items: arrayValue(response.items, (value) => {
      const item = record(value, message)
      return { ...analysisSymbol(item, message), depth: numberValue(item.depth, message) }
    }, message),
    maxDepth: numberValue(response.maxDepth, message),
    countsByDepth: countsByDepth as Record<number, number>,
    countsByNodeType: countsByNodeType as Record<string, number>,
    truncated: booleanValue(response.truncated, message),
    caveats: caveats(response.caveats, message),
  }
}

export function parseCallHierarchy(value: unknown): CallHierarchyResult {
  const message = 'Invalid call hierarchy response'
  const response = record(value, message)
  const status = stringValue(response.status, message)
  if (status !== 'ok' && status !== 'not_found') throw new Error(message)
  const input = record(response.input, message)
  const direction = stringValue(input.direction, message)
  if (direction !== 'callers' && direction !== 'callees' && direction !== 'both') throw new Error(message)
  const parseItem = (value: unknown): CallHierarchyItem => {
    const item = record(value, message)
    const callLine = optionalNumber(item.callLine, message)
    return {
      ...analysisSymbol(item, message),
      ...(callLine === undefined ? {} : { callLine }),
      count: numberValue(item.count, message),
      via: stringValue(item.via, message),
    }
  }
  return {
    status,
    input: {
      id: stringValue(input.id, message),
      direction,
      limit: numberValue(input.limit, message),
    },
    projectRoot: nullableString(response.projectRoot, message),
    center: response.center === null ? null : analysisSymbol(response.center, message),
    callers: arrayValue(response.callers, parseItem, message),
    callees: arrayValue(response.callees, parseItem, message),
    callersTruncated: booleanValue(response.callersTruncated, message),
    calleesTruncated: booleanValue(response.calleesTruncated, message),
    caveats: caveats(response.caveats, message),
  }
}

async function fetchAnalysis<T>(
  path: string,
  parse: (value: unknown) => T,
  signal?: AbortSignal,
  fetchImpl: FetchImplementation = fetch,
): Promise<T> {
  const response = await fetchImpl(`${API_URL}${path}`, { signal })
  if (!response.ok) throw new Error(`Analysis request failed with HTTP ${response.status}`)
  return parse(await response.json())
}

function projectPath(route: string, projectId: string): string {
  const params = new URLSearchParams({ projectId })
  return `/api/analysis/${route}?${params.toString()}`
}

export function fetchImportCycles(projectId: string, signal?: AbortSignal, fetchImpl?: FetchImplementation): Promise<ImportCyclesResult> {
  return fetchAnalysis(projectPath('import-cycles', projectId), parseImportCycles, signal, fetchImpl)
}

export function fetchUnreferencedExports(projectId: string, signal?: AbortSignal, fetchImpl?: FetchImplementation): Promise<UnreferencedExportsResult> {
  return fetchAnalysis(projectPath('dead-code', projectId), parseUnreferencedExports, signal, fetchImpl)
}

export function fetchHotspots(projectId: string, signal?: AbortSignal, fetchImpl?: FetchImplementation): Promise<HotspotsResult> {
  return fetchAnalysis(projectPath('hotspots', projectId), parseHotspots, signal, fetchImpl)
}

export function fetchChangeCoupling(projectId: string, signal?: AbortSignal, fetchImpl?: FetchImplementation): Promise<ChangeCouplingResult> {
  return fetchAnalysis(projectPath('change-coupling', projectId), parseChangeCoupling, signal, fetchImpl)
}

export function fetchBlastRadius(id: string, signal?: AbortSignal, fetchImpl?: FetchImplementation): Promise<BlastRadiusResult> {
  const params = new URLSearchParams({ id })
  return fetchAnalysis(`/api/analysis/blast-radius?${params.toString()}`, parseBlastRadius, signal, fetchImpl)
}

export function fetchCallHierarchy(
  id: string,
  direction: 'callers' | 'callees',
  signal?: AbortSignal,
  fetchImpl?: FetchImplementation,
): Promise<CallHierarchyResult> {
  const params = new URLSearchParams({ id, direction })
  return fetchAnalysis(`/api/analysis/call-hierarchy?${params.toString()}`, parseCallHierarchy, signal, fetchImpl)
}

export function analysisSymbolToGraphNode(symbol: AnalysisSymbol): GraphNode {
  if (!/^sym:v1:[a-f0-9]{64}$/.test(symbol.id)) {
    throw new Error('Analysis symbol is missing a persisted id')
  }
  return {
    id: symbol.id,
    label: symbol.name,
    type: symbol.nodeType,
    properties: { ...symbol },
  }
}

export function analysisFileToGraphNode(filePath: string): GraphNode {
  const name = filePath.split('/').filter(Boolean).at(-1) ?? filePath
  return {
    id: `File:${filePath}`,
    label: name,
    type: 'File',
    properties: { filePath, name },
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}
