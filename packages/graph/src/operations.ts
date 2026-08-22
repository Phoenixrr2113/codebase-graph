/**
 * @codegraph/graph - CRUD Operations
 * Graph database operations for entities and edges
 * Engine: FalkorDB (primary), FalkorDBLite (local)
 * Based on CodeGraph MVP Specification Section 6.2
 */

import type { GraphClient, QueryParams } from './client';
import type { CypherDialect } from './driver';
import { createLogger, trace } from '@codegraph/logger';
import {
  fileToNodeProps,
  functionToNodeProps,
  classToNodeProps,
  interfaceToNodeProps,
  variableToNodeProps,
  typeToNodeProps,
  componentToNodeProps,
  commitToNodeProps,
  markdownDocumentToNodeProps,
  sectionToNodeProps,
  codeBlockToNodeProps,
  linkToNodeProps,
  type ParsedFileEntities,
  type FileEntity,
  type FunctionEntity,
  type ClassEntity,
  type InterfaceEntity,
  type VariableEntity,
  type TypeEntity,
  type ComponentEntity,
  type CommitEntity,
} from './schema';
import { SYMBOL_LABELS } from '@codegraph/types';
import type {
  ProjectEntity,
  ExtractedDocumentEntities,
  TypeRefEntity,
  HasParamEdgeDescriptor,
  ReturnsEdgeDescriptor,
  UsesTypeEdgeDescriptor,
  ExportsEdgeDescriptor,
  ImportsSymbolEdgeDescriptor,
  ExportableSymbolKind,
  SymbolLabel,
} from '@codegraph/types';


const logger = createLogger({ namespace: 'graph:operations' });

// ============================================================================
// Entity ID parsing — format: "Type:filePath:name" or "Type:external:name"
// ============================================================================

interface ParsedEntityId {
  type: string;
  filePath: string;
  name: string;
  isExternal: boolean;
}

interface EdgeEndpoint {
  id: string | null;
  filePath: string | null;
  name: string | null;
}

function edgeEndpoint(id: string): EdgeEndpoint {
  if (/^sym:v1:[0-9a-f]{64}$/.test(id)) {
    return { id, filePath: null, name: null };
  }
  const parsed = parseEntityId(id);
  return {
    id: null,
    filePath: resolvedFilePath(parsed) ?? null,
    name: resolvedName(parsed),
  };
}

/**
 * Parse a colon-delimited entity ID into structured parts.
 * Handles both `Type:filePath:name` and `Type:external:name` formats.
 */
function parseEntityId(id: string): ParsedEntityId {
  const parts = id.split(':');
  const type = parts[0] ?? '';
  const fileOrExternal = parts[1] ?? '';
  const name = parts[2] ?? fileOrExternal; // fallback for 2-part IDs
  return {
    type,
    filePath: fileOrExternal,
    name,
    isExternal: fileOrExternal === 'external',
  };
}

/** Get the resolved file path (undefined if external) */
function resolvedFilePath(parsed: ParsedEntityId): string | undefined {
  return parsed.isExternal ? undefined : parsed.filePath;
}

/** Get the resolved name (handles external IDs where name might be at index 1) */
function resolvedName(parsed: ParsedEntityId): string {
  return parsed.name;
}

// ============================================================================
// Cypher Query Templates — FalkorDB (default)
// ============================================================================

const CYPHER = {
  // File operations
  UPSERT_FILE: `
    MERGE (f:File {filePath: $filePath})
    SET f.id = $id,
        f.name = $name,
        f.extension = $extension,
        f.loc = $loc,
        f.lastModified = $lastModified,
        f.hash = $hash,
        f.sourcePipeline = $sourcePipeline,
        f.sourceTask = $sourceTask,
        f.processedAt = $processedAt
    RETURN f
  `,

  // Function operations - creates CONTAINS edge to File
  UPSERT_FUNCTION: `
    MERGE (fn:Function {id: $id})
    SET fn.name = $name,
        fn.filePath = $filePath,
        fn.startLine = $startLine,
        fn.endLine = $endLine,
        fn.scopeKey = $scopeKey,
        fn.disambiguator = $disambiguator,
        fn._staleForRefresh = false,
        fn.isExported = $isExported,
        fn.isAsync = $isAsync,
        fn.isArrow = $isArrow,
        fn.params = $params,
        fn.returnType = $returnType,
        fn.docstring = $docstring,
        fn.bodySnippet = $bodySnippet,
        fn.complexity = $complexity,
        fn.cognitiveComplexity = $cognitiveComplexity,
        fn.nestingDepth = $nestingDepth,
        fn.sourcePipeline = $sourcePipeline,
        fn.sourceTask = $sourceTask,
        fn.processedAt = $processedAt
    WITH fn
    MATCH (f:File {filePath: $filePath})
    MERGE (f)-[:CONTAINS]->(fn)
    RETURN fn
  `,

  // Class operations - creates CONTAINS edge to File
  UPSERT_CLASS: `
    MERGE (c:Class {id: $id})
    SET c.name = $name,
        c.filePath = $filePath,
        c.startLine = $startLine,
        c.endLine = $endLine,
        c.scopeKey = $scopeKey,
        c.disambiguator = $disambiguator,
        c._staleForRefresh = false,
        c.isExported = $isExported,
        c.isAbstract = $isAbstract,
        c.extends = $extends,
        c.implements = $implements,
        c.docstring = $docstring,
        c.sourcePipeline = $sourcePipeline,
        c.sourceTask = $sourceTask,
        c.processedAt = $processedAt
    WITH c
    MATCH (f:File {filePath: $filePath})
    MERGE (f)-[:CONTAINS]->(c)
    RETURN c
  `,

  // Interface operations - creates CONTAINS edge to File
  UPSERT_INTERFACE: `
    MERGE (i:Interface {id: $id})
    SET i.name = $name,
        i.filePath = $filePath,
        i.startLine = $startLine,
        i.endLine = $endLine,
        i.scopeKey = $scopeKey,
        i.disambiguator = $disambiguator,
        i._staleForRefresh = false,
        i.isExported = $isExported,
        i.extends = $extends,
        i.docstring = $docstring,
        i.sourcePipeline = $sourcePipeline,
        i.sourceTask = $sourceTask,
        i.processedAt = $processedAt
    WITH i
    MATCH (f:File {filePath: $filePath})
    MERGE (f)-[:CONTAINS]->(i)
    RETURN i
  `,

  // Variable operations - creates CONTAINS edge to File
  UPSERT_VARIABLE: `
    MERGE (v:Variable {id: $id})
    SET v.name = $name,
        v.filePath = $filePath,
        v.line = $line,
        v.scopeKey = $scopeKey,
        v.disambiguator = $disambiguator,
        v._staleForRefresh = false,
        v.kind = $kind,
        v.isExported = $isExported,
        v.type = $type,
        v.sourcePipeline = $sourcePipeline,
        v.sourceTask = $sourceTask,
        v.processedAt = $processedAt
    WITH v
    MATCH (f:File {filePath: $filePath})
    MERGE (f)-[:CONTAINS]->(v)
    RETURN v
  `,

  // Type operations - creates CONTAINS edge to File
  UPSERT_TYPE: `
    MERGE (t:Type {id: $id})
    SET t.name = $name,
        t.filePath = $filePath,
        t.startLine = $startLine,
        t.endLine = $endLine,
        t.scopeKey = $scopeKey,
        t.disambiguator = $disambiguator,
        t._staleForRefresh = false,
        t.isExported = $isExported,
        t.kind = $kind,
        t.docstring = $docstring,
        t.sourcePipeline = $sourcePipeline,
        t.sourceTask = $sourceTask,
        t.processedAt = $processedAt
    WITH t
    MATCH (f:File {filePath: $filePath})
    MERGE (f)-[:CONTAINS]->(t)
    RETURN t
  `,

  // Component operations - creates CONTAINS edge to File
  UPSERT_COMPONENT: `
    MERGE (comp:Component {id: $id})
    SET comp.name = $name,
        comp.filePath = $filePath,
        comp.startLine = $startLine,
        comp.endLine = $endLine,
        comp.scopeKey = $scopeKey,
        comp.disambiguator = $disambiguator,
        comp._staleForRefresh = false,
        comp.isExported = $isExported,
        comp.props = $props,
        comp.propsType = $propsType,
        comp.sourcePipeline = $sourcePipeline,
        comp.sourceTask = $sourceTask,
        comp.processedAt = $processedAt
    WITH comp
    MATCH (f:File {filePath: $filePath})
    MERGE (f)-[:CONTAINS]->(comp)
    RETURN comp
  `,

  // Edge operations
  // CALLS source can be Function | Variable | Class | Interface. Canonical
  // endpoint ids take priority. Name and path remain the documented fallback
  // for descriptors produced before endpoint resolution.
  // from the original Function-only constraint so calls inside arrow
  // initialisers (e.g., zod's $ZodCheckMultipleOf) are reachable.
  // labels(caller)[0] disambiguates same-name+filePath nodes across labels.
  // ON MATCH deliberately leaves c.via untouched: existing pre-fix edges
  // have c.via IS NULL — consumers read via as coalesce(c.via, 'direct').
  CREATE_CALLS_EDGE: `
    MATCH (caller)
    WHERE ($callerId IS NOT NULL AND caller.id = $callerId) OR
      ($callerId IS NULL AND caller.name = $callerName AND caller.filePath = $callerFile AND labels(caller)[0] = $callerKind)
    MATCH (callee:Function)
    WHERE ($calleeId IS NOT NULL AND callee.id = $calleeId) OR
      ($calleeId IS NULL AND callee.name = $calleeName AND callee.filePath = $calleeFile)
    MERGE (caller)-[c:CALLS]->(callee)
    ON CREATE SET c.line = $line, c.count = 1, c.via = $via
    ON MATCH SET c.count = c.count + 1
    RETURN c
  `,

  // Class-qualified variant of CREATE_CALLS_EDGE, used when the extractor
  // knows which class the receiver was bound to (calleeClassName set on the
  // call-edge descriptor). Matching plain {name, filePath} on the callee is
  // not enough to pick the right method when two classes in the same file
  // declare a method with the same name (e.g. Service.work / OtherService.work
  // are both Function{name:'work', filePath: same file}): that ambiguous match
  // used to create a CALLS edge to every same-named method regardless of
  // which class the receiver actually was. Routing through HAS_METHOD from
  // the named class disambiguates. OPTIONAL MATCH + WHERE callee IS NOT NULL
  // means a missing HAS_METHOD edge (or a class/method that doesn't resolve)
  // drops the edge instead of falling back to the ambiguous unqualified match.
  CREATE_CALLS_EDGE_BY_CLASS: `
    MATCH (caller {name: $callerName, filePath: $callerFile})
    WHERE labels(caller)[0] = $callerKind
    OPTIONAL MATCH (cls:Class {name: $calleeClassName, filePath: $calleeFile})-[:HAS_METHOD]->(callee:Function {name: $calleeName})
    WITH caller, callee WHERE callee IS NOT NULL
    MERGE (caller)-[c:CALLS]->(callee)
    ON CREATE SET c.line = $line, c.count = 1, c.via = $via
    ON MATCH SET c.count = c.count + 1
    RETURN c
  `,

  CREATE_IMPORTS_EDGE: `
    MATCH (from:File {filePath: $fromPath})
    MERGE (to:File {filePath: $toPath})
    ON CREATE SET to:External
    MERGE (from)-[i:IMPORTS]->(to)
    SET i.specifiers = $specifiers
    RETURN i
  `,

  CREATE_EXTENDS_EDGE: `
    MATCH (child:Class)
    WHERE ($childId IS NOT NULL AND child.id = $childId) OR
      ($childId IS NULL AND child.name = $childName AND child.filePath = $childFile)
    MERGE (parent:Class {name: $parentName, filePath: COALESCE($parentFile, 'external')})
    ON CREATE SET parent:External
    MERGE (child)-[e:EXTENDS]->(parent)
    RETURN e
  `,

  CREATE_EXTENDS_EDGE_BY_ID: `
    MATCH (child:Class)
    WHERE ($childId IS NOT NULL AND child.id = $childId) OR
      ($childId IS NULL AND child.name = $childName AND child.filePath = $childFile)
    MATCH (parent:Class {id: $parentId})
    MERGE (child)-[e:EXTENDS]->(parent)
    RETURN e
  `,

  CREATE_IMPLEMENTS_EDGE: `
    MATCH (c:Class)
    WHERE ($classId IS NOT NULL AND c.id = $classId) OR
      ($classId IS NULL AND c.name = $className AND c.filePath = $classFile)
    MERGE (i:Interface {name: $interfaceName, filePath: COALESCE($interfaceFile, 'external')})
    ON CREATE SET i:External
    MERGE (c)-[impl:IMPLEMENTS]->(i)
    RETURN impl
  `,

  CREATE_IMPLEMENTS_EDGE_BY_ID: `
    MATCH (c:Class)
    WHERE ($classId IS NOT NULL AND c.id = $classId) OR
      ($classId IS NULL AND c.name = $className AND c.filePath = $classFile)
    MATCH (i:Interface {id: $interfaceId})
    MERGE (c)-[impl:IMPLEMENTS]->(i)
    RETURN impl
  `,

  CREATE_RENDERS_EDGE: `
    MATCH (parent:Component)
    WHERE ($parentId IS NOT NULL AND parent.id = $parentId) OR
      ($parentId IS NULL AND parent.name = $parentName AND parent.filePath = $parentFile)
    MATCH (child:Component)
    WHERE ($childId IS NOT NULL AND child.id = $childId) OR
      ($childId IS NULL AND child.name = $childName)
    MERGE (parent)-[r:RENDERS]->(child)
    SET r.line = $line
    RETURN r
  `,

  CREATE_HAS_METHOD_EDGE: `
    MATCH (from:Class {id: $fromId})
    MATCH (to:Function {id: $toId})
    MERGE (from)-[r:HAS_METHOD]->(to)
    SET r.isStatic = coalesce($isStatic, false),
        r.visibility = coalesce($visibility, 'public')
  `,

  CREATE_HAS_PROPERTY_EDGE: `
    MATCH (from:Class {id: $fromId})
    MATCH (to:Variable {id: $toId})
    MERGE (from)-[r:HAS_PROPERTY]->(to)
    SET r.isStatic = coalesce($isStatic, false),
        r.visibility = coalesce($visibility, 'public'),
        r.isReadonly = coalesce($isReadonly, false)
  `,

  // Type reference node — MERGE by id so cross-file references share one node.
  // Uses :TypeRef (NOT :Type) — TypeRef represents inline type expressions,
  // generic parameters, and primitives (e.g. "T", "any", "Promise<User>"); these
  // have no source location of their own. :Type is reserved for source-level
  // type alias / enum *declarations* (TypeEntity), which do have filePath +
  // startLine and which are embedded for vector search. Conflating the two
  // labels means embed-pass crashes on null filePath and search returns
  // unknown#unknown rows for half the result set.
  MERGE_TYPE_REF: `
    MERGE (t:TypeRef {id: $id})
    SET t.name = $name,
        t.language = $language,
        t.isPrimitive = $isPrimitive,
        t.definingFile = coalesce($definingFile, t.definingFile)
  `,

  CREATE_HAS_PARAM_EDGE: `
    MATCH (from:Function {id: $fromId}), (to:TypeRef {id: $toId})
    MERGE (from)-[r:HAS_PARAM]->(to)
    SET r.position = $position,
        r.name = $name,
        r.isOptional = $isOptional
  `,

  CREATE_RETURNS_EDGE: `
    MATCH (from:Function {id: $fromId}), (to:TypeRef {id: $toId})
    MERGE (from)-[r:RETURNS]->(to)
    SET r.isAsync = $isAsync
  `,

  CREATE_USES_TYPE_EDGE: `
    MATCH (from:Function {id: $fromId}), (to:TypeRef {id: $toId})
    MERGE (from)-[r:USES_TYPE]->(to)
    SET r.kind = $kind
  `,

  // Commit operations
  UPSERT_COMMIT: `
    MERGE (c:Commit {hash: $hash})
    SET c.message = $message,
        c.author = $author,
        c.email = $email,
        c.date = $date,
        c.sourcePipeline = $sourcePipeline,
        c.sourceTask = $sourceTask,
        c.processedAt = $processedAt
    RETURN c
  `,

  // Temporal edge operations
  CREATE_INTRODUCED_IN_EDGE: `
    MATCH (entity) WHERE id(entity) = $entityId
    MATCH (c:Commit {hash: $commitHash})
    MERGE (entity)-[r:INTRODUCED_IN]->(c)
    RETURN r
  `,

  CREATE_MODIFIED_IN_EDGE: `
    MATCH (f:File {filePath: $filePath})
    MATCH (c:Commit {hash: $commitHash})
    MERGE (f)-[r:MODIFIED_IN]->(c)
    SET r.linesAdded = $linesAdded,
        r.linesRemoved = $linesRemoved,
        r.complexityDelta = $complexityDelta
    RETURN r
  `,

  CREATE_DELETED_IN_EDGE: `
    MATCH (entity) WHERE id(entity) = $entityId
    MATCH (c:Commit {hash: $commitHash})
    MERGE (entity)-[r:DELETED_IN]->(c)
    RETURN r
  `,

  // Export edge operations. Canonical endpoint ids take priority. symbolKind
  // disambiguates declaration merging only on the legacy name/path fallback.
  CREATE_EXPORTS_EDGE: `
    MATCH (f:File)
    WHERE ($fromId IS NOT NULL AND f.id = $fromId) OR ($fromId IS NULL AND f.filePath = $filePath)
    MATCH (symbol)
    WHERE ($toId IS NOT NULL AND symbol.id = $toId) OR
      ($toId IS NULL AND symbol.name = $symbolName AND symbol.filePath = $filePath AND labels(symbol)[0] = $symbolKind)
    MERGE (f)-[r:EXPORTS]->(symbol)
    SET r.asName = $asName,
        r.isDefault = $isDefault
    RETURN r
  `,

  GET_FILE_EXPORTS: `
    MATCH (f:File {filePath: $filePath})-[r:EXPORTS]->(symbol)
    RETURN symbol.name as name, labels(symbol)[0] as type, r.asName as asName, r.isDefault as isDefault
  `,

  // IMPORTS_SYMBOL connects an importing File to the imported declaration.
  // Canonical endpoint ids take priority. The legacy fallback matches by name
  // and path and never creates a stub when the target is unavailable.
  CREATE_IMPORTS_SYMBOL_EDGE: `
    MATCH (from:File)
    WHERE ($fromId IS NOT NULL AND from.id = $fromId) OR ($fromId IS NULL AND from.filePath = $fromFilePath)
    MATCH (symbol)
    WHERE ($toId IS NOT NULL AND symbol.id = $toId) OR
      ($toId IS NULL AND symbol.name = $symbolName AND symbol.filePath = $toFilePath)
    MERGE (from)-[r:IMPORTS_SYMBOL]->(symbol)
    SET r.alias = $alias,
        r.isDefault = $isDefault
    RETURN r
  `,

  // PARENT_SECTION edge: Section to Section nesting within one document,
  // derived from heading levels by buildSectionHierarchy in
  // @codegraph/plugin-markdown (each section's parent is the nearest
  // preceding section with a smaller level). Matches on (filePath,
  // startLine), the same key BATCH_UPSERT_SECTIONS below MERGEs Section
  // nodes on, not on this package's synthetic section id. OPTIONAL MATCH +
  // WHERE ... IS NOT NULL so a section that failed to upsert for any reason
  // drops this edge instead of erroring the whole batch.
  CREATE_PARENT_SECTION_EDGE: `
    OPTIONAL MATCH (parent:Section {filePath: $filePath, startLine: $parentStartLine})
    OPTIONAL MATCH (child:Section {filePath: $filePath, startLine: $childStartLine})
    WITH parent, child WHERE parent IS NOT NULL AND child IS NOT NULL
    MERGE (parent)-[r:PARENT_SECTION]->(child)
    RETURN r
  `,

  // Real file removal deletes the source owner and every declaration it owns.
  REMOVE_FILE_NODE: `
    MATCH (f:File {filePath: $filePath})
    DETACH DELETE f
  `,

  REMOVE_FILE_SYMBOLS: `
    MATCH (e)
    WHERE e.filePath = $filePath AND
      (e:Function OR e:Class OR e:Interface OR e:Variable OR e:Type OR e:Component)
    DETACH DELETE e
  `,

  REMOVE_FILE_DOCUMENT: `
    MATCH (d:MarkdownDocument {path: $filePath})
    OPTIONAL MATCH (d)-[:CONTAINS]->(content)
    DETACH DELETE content, d
  `,

  // Mark the prior declaration set before refresh. Current canonical IDs clear
  // this marker during upsert, then SWEEP_STALE_FILE_SYMBOLS removes the rest.
  REMOVE_FILE_CONTENTS: `
    MATCH (e)
    WHERE e.filePath = $filePath AND
      (e:Function OR e:Class OR e:Interface OR e:Variable OR e:Type OR e:Component)
    SET e._staleForRefresh = true
  `,

  REMOVE_FILE_OUTGOING_EDGES: `
    MATCH (f:File {filePath: $filePath})-[r:IMPORTS|IMPORTS_SYMBOL|EXPORTS]->()
    DELETE r
  `,

  REMOVE_SYMBOL_OUTGOING_EDGES: `
    MATCH (e)-[r:CALLS|EXTENDS|IMPLEMENTS|RENDERS|HAS_METHOD|HAS_PROPERTY|HAS_PARAM|RETURNS|USES_TYPE]->()
    WHERE e.filePath = $filePath AND
      (e:Function OR e:Class OR e:Interface OR e:Variable OR e:Type OR e:Component)
    DELETE r
  `,

  SWEEP_STALE_FILE_SYMBOLS: `
    MATCH (e {_staleForRefresh: true})
    WHERE e.filePath = $filePath AND
      (e:Function OR e:Class OR e:Interface OR e:Variable OR e:Type OR e:Component)
    DETACH DELETE e
  `,

  SWEEP_STALE_FILE_SYMBOL_IDS: `
    MATCH (e)
    WHERE e.filePath = $filePath AND
      (e:Function OR e:Class OR e:Interface OR e:Variable OR e:Type OR e:Component) AND
      NOT e.id IN $currentIds
    DETACH DELETE e
  `,

  // Content-only removal for a changed Markdown document. Keep the stable
  // MarkdownDocument node, but delete every contained content node and all
  // of their relationships so re-upsert cannot retain obsolete hierarchy.
  REMOVE_DOCUMENT_CONTENTS: `
    MATCH (:MarkdownDocument {path: $documentPath})-[:CONTAINS]->(content)
    WHERE content:Section OR content:CodeBlock OR content:Link
    DETACH DELETE content
  `,

  // Count nodes for a file
  COUNT_FILE_ENTITIES: `
    MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(e)
    RETURN count(e) as count
  `,

  // Clear all nodes and edges from the graph
  CLEAR_ALL: `
    MATCH (n)
    DETACH DELETE n
  `,

  // Project operations
  UPSERT_PROJECT: `
    MERGE (p:Project {id: $id})
    SET p.projectId = $id,
        p.name = $name,
        p.rootPath = $rootPath,
        p.createdAt = $createdAt,
        p.lastParsed = $lastParsed,
        p.fileCount = $fileCount,
        p.sourcePipeline = $sourcePipeline,
        p.sourceTask = $sourceTask,
        p.processedAt = $processedAt
    RETURN p
  `,

  GET_ALL_PROJECTS: `
    MATCH (p:Project)
    RETURN p
    ORDER BY p.lastParsed DESC
  `,

  GET_PROJECT_BY_ROOT: `
    MATCH (p:Project {rootPath: $rootPath})
    RETURN p
  `,

  DELETE_PROJECT: `
    MATCH (owned)
    WHERE owned.projectId = $id OR (owned:Project AND owned.id = $id)
    DETACH DELETE owned
  `,

  LINK_PROJECT_FILE: `
    MATCH (p:Project {id: $projectId})
    MATCH (f:File {filePath: $filePath})
    SET f.projectId = $projectId
    MERGE (p)-[:HAS_FILE]->(f)
  `,

  STAMP_FILE_SYMBOL_OWNERSHIP: `
    MATCH (:File {filePath: $filePath})-[:CONTAINS]->(owned)
    WHERE owned:Function OR owned:Class OR owned:Interface OR owned:Variable OR owned:Type OR owned:Component
    SET owned.projectId = $projectId
  `,

  GET_PROJECT_FILE_HASHES: `
    MATCH (p:Project {id: $projectId})-[:HAS_FILE]->(f:File)
    RETURN f.filePath AS path, f.hash AS hash
  `,

  // ---- UNWIND Batch Operations (PERF.2) ----
  // These replace N individual queries with 1 UNWIND query per entity type.

  BATCH_UPSERT_FILES: `
    UNWIND $items AS item
    MERGE (f:File {filePath: item.filePath})
    SET f.id = item.id,
        f.name = item.name,
        f.extension = item.extension,
        f.loc = item.loc,
        f.lastModified = item.lastModified,
        f.hash = item.hash,
        f.sourcePipeline = item.sourcePipeline,
        f.sourceTask = item.sourceTask,
        f.processedAt = item.processedAt
  `,

  BATCH_UPSERT_FUNCTIONS: `
    UNWIND $items AS item
    MERGE (fn:Function {id: item.id})
    SET fn.name = item.name,
        fn.filePath = item.filePath,
        fn.startLine = item.startLine,
        fn.endLine = item.endLine,
        fn.scopeKey = item.scopeKey,
        fn.disambiguator = item.disambiguator,
        fn._staleForRefresh = false,
        fn.isExported = item.isExported,
        fn.isAsync = item.isAsync,
        fn.isArrow = item.isArrow,
        fn.params = item.params,
        fn.returnType = item.returnType,
        fn.docstring = item.docstring,
        fn.bodySnippet = item.bodySnippet,
        fn.complexity = item.complexity,
        fn.cognitiveComplexity = item.cognitiveComplexity,
        fn.nestingDepth = item.nestingDepth,
        fn.sourcePipeline = item.sourcePipeline,
        fn.sourceTask = item.sourceTask,
        fn.processedAt = item.processedAt
    WITH fn, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(fn)
  `,

  BATCH_UPSERT_CLASSES: `
    UNWIND $items AS item
    MERGE (c:Class {id: item.id})
    SET c.name = item.name,
        c.filePath = item.filePath,
        c.startLine = item.startLine,
        c.endLine = item.endLine,
        c.scopeKey = item.scopeKey,
        c.disambiguator = item.disambiguator,
        c._staleForRefresh = false,
        c.isExported = item.isExported,
        c.isAbstract = item.isAbstract,
        c.extends = item.extends,
        c.implements = item.implements,
        c.docstring = item.docstring,
        c.sourcePipeline = item.sourcePipeline,
        c.sourceTask = item.sourceTask,
        c.processedAt = item.processedAt
    WITH c, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(c)
  `,

  BATCH_UPSERT_INTERFACES: `
    UNWIND $items AS item
    MERGE (i:Interface {id: item.id})
    SET i.name = item.name,
        i.filePath = item.filePath,
        i.startLine = item.startLine,
        i.endLine = item.endLine,
        i.scopeKey = item.scopeKey,
        i.disambiguator = item.disambiguator,
        i._staleForRefresh = false,
        i.isExported = item.isExported,
        i.extends = item.extends,
        i.docstring = item.docstring,
        i.sourcePipeline = item.sourcePipeline,
        i.sourceTask = item.sourceTask,
        i.processedAt = item.processedAt
    WITH i, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(i)
  `,

  BATCH_UPSERT_VARIABLES: `
    UNWIND $items AS item
    MERGE (v:Variable {id: item.id})
    SET v.name = item.name,
        v.filePath = item.filePath,
        v.line = item.line,
        v.scopeKey = item.scopeKey,
        v.disambiguator = item.disambiguator,
        v._staleForRefresh = false,
        v.kind = item.kind,
        v.isExported = item.isExported,
        v.type = item.type,
        v.sourcePipeline = item.sourcePipeline,
        v.sourceTask = item.sourceTask,
        v.processedAt = item.processedAt
    WITH v, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(v)
  `,

  BATCH_UPSERT_TYPES: `
    UNWIND $items AS item
    MERGE (t:Type {id: item.id})
    SET t.name = item.name,
        t.filePath = item.filePath,
        t.startLine = item.startLine,
        t.endLine = item.endLine,
        t.scopeKey = item.scopeKey,
        t.disambiguator = item.disambiguator,
        t._staleForRefresh = false,
        t.isExported = item.isExported,
        t.kind = item.kind,
        t.docstring = item.docstring,
        t.sourcePipeline = item.sourcePipeline,
        t.sourceTask = item.sourceTask,
        t.processedAt = item.processedAt
    WITH t, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(t)
  `,

  BATCH_UPSERT_COMPONENTS: `
    UNWIND $items AS item
    MERGE (comp:Component {id: item.id})
    SET comp.name = item.name,
        comp.filePath = item.filePath,
        comp.startLine = item.startLine,
        comp.endLine = item.endLine,
        comp.scopeKey = item.scopeKey,
        comp.disambiguator = item.disambiguator,
        comp._staleForRefresh = false,
        comp.isExported = item.isExported,
        comp.props = item.props,
        comp.propsType = item.propsType,
        comp.sourcePipeline = item.sourcePipeline,
        comp.sourceTask = item.sourceTask,
        comp.processedAt = item.processedAt
    WITH comp, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(comp)
  `,

  // --- Document entities (markdown) ---
  // Sections, code blocks, and links all attach to their MarkdownDocument
  // with the generic CONTAINS edge below, not a dedicated HAS_SECTION /
  // CONTAINS_CODE / LINKS_TO edge type: those three were declared in
  // @codegraph/types at one point but never actually written here, so they
  // were removed rather than left promising a relationship that doesn't
  // exist. PARENT_SECTION (CREATE_PARENT_SECTION_EDGE above) is the one real
  // document edge beyond CONTAINS.

  BATCH_UPSERT_DOCUMENTS: `
    UNWIND $items AS item
    MERGE (d:MarkdownDocument {path: item.path})
    SET d.name = item.name,
        d.title = item.title,
        d.frontmatter = item.frontmatter,
        d.hash = item.hash,
        d.lastModified = item.lastModified
  `,

  BATCH_UPSERT_SECTIONS: `
    UNWIND $items AS item
    MERGE (s:Section {filePath: item.filePath, startLine: item.startLine})
    SET s.heading = item.heading,
        s.level = item.level,
        s.endLine = item.endLine
    WITH s, item
    MATCH (d:MarkdownDocument {path: item.filePath})
    MERGE (d)-[:CONTAINS]->(s)
  `,

  BATCH_UPSERT_CODEBLOCKS: `
    UNWIND $items AS item
    MERGE (cb:CodeBlock {filePath: item.filePath, startLine: item.startLine})
    SET cb.language = item.language,
        cb.content = item.content,
        cb.endLine = item.endLine
    WITH cb, item
    MATCH (d:MarkdownDocument {path: item.filePath})
    MERGE (d)-[:CONTAINS]->(cb)
  `,

  BATCH_UPSERT_LINKS: `
    UNWIND $items AS item
    MERGE (l:Link {filePath: item.filePath, line: item.line, target: item.target})
    SET l.text = item.text,
        l.isInternal = item.isInternal,
        l.anchor = item.anchor
    WITH l, item
    MATCH (d:MarkdownDocument {path: item.filePath})
    MERGE (d)-[:CONTAINS]->(l)
  `,

  STAMP_DOCUMENT_PROJECT_OWNERSHIP: `
    MATCH (p:Project)
    WHERE p.rootPath = '/' OR $documentPath STARTS WITH (p.rootPath + '/')
    WITH p ORDER BY size(p.rootPath) DESC
    LIMIT 1
    MATCH (d:MarkdownDocument {path: $documentPath})
    SET d.projectId = p.id
    WITH p, d
    OPTIONAL MATCH (d)-[:CONTAINS]->(content)
    SET content.projectId = p.id
  `,

  // Batch variant of CREATE_PARENT_SECTION_EDGE, run after BATCH_UPSERT_SECTIONS
  // so every Section node in this batch already exists.
  BATCH_CREATE_PARENT_SECTION_EDGES: `
    UNWIND $items AS item
    OPTIONAL MATCH (parent:Section {filePath: item.filePath, startLine: item.parentStartLine})
    OPTIONAL MATCH (child:Section {filePath: item.filePath, startLine: item.childStartLine})
    WITH parent, child WHERE parent IS NOT NULL AND child IS NOT NULL
    MERGE (parent)-[r:PARENT_SECTION]->(child)
  `,

  BATCH_LINK_PROJECT_FILES: `
    UNWIND $items AS item
    OPTIONAL MATCH (p:Project {id: item.projectId})
    OPTIONAL MATCH (f:File {filePath: item.filePath})
    WITH p, f WHERE p IS NOT NULL AND f IS NOT NULL
    SET f.projectId = p.id
    MERGE (p)-[:HAS_FILE]->(f)
  `,

  BATCH_STAMP_FILE_SYMBOL_OWNERSHIP: `
    UNWIND $items AS item
    MATCH (:File {filePath: item.filePath})-[:CONTAINS]->(owned)
    WHERE owned:Function OR owned:Class OR owned:Interface OR owned:Variable OR owned:Type OR owned:Component
    SET owned.projectId = item.projectId
  `,

  // --- Fast CREATE path for full reindex (no MERGE lookups needed) ---
  // Used after clearing old data; CREATE is much faster than MERGE for bulk inserts.
  BATCH_CREATE_FILES: `
    UNWIND $items AS item
    CREATE (f:File {id: item.id, filePath: item.filePath, name: item.name, extension: item.extension,
      loc: item.loc, lastModified: item.lastModified, hash: item.hash,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
  `,

  BATCH_CREATE_FUNCTIONS_FAST: `
    UNWIND $items AS item
    CREATE (fn:Function {id: item.id, scopeKey: item.scopeKey, disambiguator: item.disambiguator,
      name: item.name, filePath: item.filePath, startLine: item.startLine,
      endLine: item.endLine, isExported: item.isExported, isAsync: item.isAsync,
      isArrow: item.isArrow, params: item.params, returnType: item.returnType,
      docstring: item.docstring, bodySnippet: item.bodySnippet, complexity: item.complexity,
      cognitiveComplexity: item.cognitiveComplexity, nestingDepth: item.nestingDepth,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH fn
    MATCH (f:File {filePath: fn.filePath})
    CREATE (f)-[:CONTAINS]->(fn)
  `,

  BATCH_CREATE_CLASSES_FAST: `
    UNWIND $items AS item
    CREATE (c:Class {id: item.id, scopeKey: item.scopeKey, disambiguator: item.disambiguator,
      name: item.name, filePath: item.filePath, startLine: item.startLine,
      endLine: item.endLine, isExported: item.isExported, isAbstract: item.isAbstract,
      extends: item.extends, implements: item.implements, docstring: item.docstring,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH c
    MATCH (f:File {filePath: c.filePath})
    CREATE (f)-[:CONTAINS]->(c)
  `,

  BATCH_CREATE_INTERFACES_FAST: `
    UNWIND $items AS item
    CREATE (i:Interface {id: item.id, scopeKey: item.scopeKey, disambiguator: item.disambiguator,
      name: item.name, filePath: item.filePath, startLine: item.startLine,
      endLine: item.endLine, isExported: item.isExported, extends: item.extends,
      docstring: item.docstring,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH i
    MATCH (f:File {filePath: i.filePath})
    CREATE (f)-[:CONTAINS]->(i)
  `,

  BATCH_CREATE_VARIABLES_FAST: `
    UNWIND $items AS item
    CREATE (v:Variable {id: item.id, scopeKey: item.scopeKey, disambiguator: item.disambiguator,
      name: item.name, filePath: item.filePath, line: item.line,
      kind: item.kind, isExported: item.isExported, type: item.type,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH v
    MATCH (f:File {filePath: v.filePath})
    CREATE (f)-[:CONTAINS]->(v)
  `,

  BATCH_CREATE_TYPES_FAST: `
    UNWIND $items AS item
    CREATE (t:Type {id: item.id, scopeKey: item.scopeKey, disambiguator: item.disambiguator,
      name: item.name, filePath: item.filePath, startLine: item.startLine,
      endLine: item.endLine, isExported: item.isExported, kind: item.kind,
      docstring: item.docstring,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH t
    MATCH (f:File {filePath: t.filePath})
    CREATE (f)-[:CONTAINS]->(t)
  `,

  BATCH_CREATE_COMPONENTS_FAST: `
    UNWIND $items AS item
    CREATE (comp:Component {id: item.id, scopeKey: item.scopeKey, disambiguator: item.disambiguator,
      name: item.name, filePath: item.filePath, startLine: item.startLine,
      endLine: item.endLine, isExported: item.isExported, props: item.props,
      propsType: item.propsType,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH comp
    MATCH (f:File {filePath: comp.filePath})
    CREATE (f)-[:CONTAINS]->(comp)
  `,

  // --- Combined single-query upserts (reduces 7 round-trips to 1) ---
  // Each block: UNWIND + MERGE/SET, separated by WITH count(*) AS _ to reset cardinality.
  // The MATCH (f:File) + MERGE CONTAINS is inlined into each entity block.
  // Empty arrays are safe: UNWIND [] produces zero rows, skipping that block.
  COMBINED_UPSERT_ALL: `
    UNWIND $files AS item
    MERGE (f:File {filePath: item.filePath})
    SET f.id = item.id,
        f.name = item.name,
        f.extension = item.extension,
        f.loc = item.loc,
        f.lastModified = item.lastModified,
        f.hash = item.hash,
        f.sourcePipeline = item.sourcePipeline,
        f.sourceTask = item.sourceTask,
        f.processedAt = item.processedAt
    WITH count(*) AS _c1
    UNWIND $functions AS item
    MERGE (fn:Function {id: item.id})
    SET fn.name = item.name,
        fn.filePath = item.filePath,
        fn.startLine = item.startLine,
        fn.endLine = item.endLine,
        fn.scopeKey = item.scopeKey,
        fn.disambiguator = item.disambiguator,
        fn._staleForRefresh = false,
        fn.isExported = item.isExported,
        fn.isAsync = item.isAsync,
        fn.isArrow = item.isArrow,
        fn.params = item.params,
        fn.returnType = item.returnType,
        fn.docstring = item.docstring,
        fn.complexity = item.complexity,
        fn.cognitiveComplexity = item.cognitiveComplexity,
        fn.nestingDepth = item.nestingDepth,
        fn.sourcePipeline = item.sourcePipeline,
        fn.sourceTask = item.sourceTask,
        fn.processedAt = item.processedAt
    WITH fn, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(fn)
    WITH count(*) AS _c2
    UNWIND $classes AS item
    MERGE (c:Class {id: item.id})
    SET c.name = item.name,
        c.filePath = item.filePath,
        c.startLine = item.startLine,
        c.endLine = item.endLine,
        c.scopeKey = item.scopeKey,
        c.disambiguator = item.disambiguator,
        c._staleForRefresh = false,
        c.isExported = item.isExported,
        c.isAbstract = item.isAbstract,
        c.extends = item.extends,
        c.implements = item.implements,
        c.docstring = item.docstring,
        c.sourcePipeline = item.sourcePipeline,
        c.sourceTask = item.sourceTask,
        c.processedAt = item.processedAt
    WITH c, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(c)
    WITH count(*) AS _c3
    UNWIND $interfaces AS item
    MERGE (i:Interface {id: item.id})
    SET i.name = item.name,
        i.filePath = item.filePath,
        i.startLine = item.startLine,
        i.endLine = item.endLine,
        i.scopeKey = item.scopeKey,
        i.disambiguator = item.disambiguator,
        i._staleForRefresh = false,
        i.isExported = item.isExported,
        i.extends = item.extends,
        i.docstring = item.docstring,
        i.sourcePipeline = item.sourcePipeline,
        i.sourceTask = item.sourceTask,
        i.processedAt = item.processedAt
    WITH i, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(i)
    WITH count(*) AS _c4
    UNWIND $variables AS item
    MERGE (v:Variable {id: item.id})
    SET v.name = item.name,
        v.filePath = item.filePath,
        v.line = item.line,
        v.scopeKey = item.scopeKey,
        v.disambiguator = item.disambiguator,
        v._staleForRefresh = false,
        v.kind = item.kind,
        v.isExported = item.isExported,
        v.type = item.type,
        v.sourcePipeline = item.sourcePipeline,
        v.sourceTask = item.sourceTask,
        v.processedAt = item.processedAt
    WITH v, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(v)
    WITH count(*) AS _c5
    UNWIND $types AS item
    MERGE (t:Type {id: item.id})
    SET t.name = item.name,
        t.filePath = item.filePath,
        t.startLine = item.startLine,
        t.endLine = item.endLine,
        t.scopeKey = item.scopeKey,
        t.disambiguator = item.disambiguator,
        t._staleForRefresh = false,
        t.isExported = item.isExported,
        t.kind = item.kind,
        t.docstring = item.docstring,
        t.sourcePipeline = item.sourcePipeline,
        t.sourceTask = item.sourceTask,
        t.processedAt = item.processedAt
    WITH t, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(t)
    WITH count(*) AS _c6
    UNWIND $components AS item
    MERGE (comp:Component {id: item.id})
    SET comp.name = item.name,
        comp.filePath = item.filePath,
        comp.startLine = item.startLine,
        comp.endLine = item.endLine,
        comp.scopeKey = item.scopeKey,
        comp.disambiguator = item.disambiguator,
        comp._staleForRefresh = false,
        comp.isExported = item.isExported,
        comp.props = item.props,
        comp.propsType = item.propsType,
        comp.sourcePipeline = item.sourcePipeline,
        comp.sourceTask = item.sourceTask,
        comp.processedAt = item.processedAt
    WITH comp, item
    MATCH (f:File {filePath: item.filePath})
    MERGE (f)-[:CONTAINS]->(comp)
    RETURN count(*) AS done
  `,

  // Embedding update operations (per-node-type) — uses vecf32() for proper vector storage
  UPDATE_FILE_EMBEDDING: `
    MATCH (f:File {filePath: $filePath})
    SET f.embedding = vecf32($embedding), f.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_FUNCTION_EMBEDDING: `
    MATCH (fn:Function {id: $id})
    SET fn.embedding = vecf32($embedding), fn.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_CLASS_EMBEDDING: `
    MATCH (c:Class {id: $id})
    SET c.embedding = vecf32($embedding), c.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_INTERFACE_EMBEDDING: `
    MATCH (i:Interface {id: $id})
    SET i.embedding = vecf32($embedding), i.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_VARIABLE_EMBEDDING: `
    MATCH (v:Variable {id: $id})
    SET v.embedding = vecf32($embedding), v.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_TYPE_EMBEDDING: `
    MATCH (t:Type {id: $id})
    SET t.embedding = vecf32($embedding), t.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_COMPONENT_EMBEDDING: `
    MATCH (comp:Component {id: $id})
    SET comp.embedding = vecf32($embedding), comp.embeddingTextHash = $embeddingTextHash
  `,

  // --- Get existing embedding hashes for incremental embedding ---
  GET_EMBEDDING_HASHES_FOR_FILES: `
    UNWIND $filePaths AS fp
    MATCH (f:File {filePath: fp})
    OPTIONAL MATCH (f)-[:CONTAINS]->(e)
    WHERE e.embeddingTextHash IS NOT NULL
    WITH fp, collect({
      nodeType: labels(e)[0],
      id: e.id,
      name: CASE WHEN e:Variable THEN e.name ELSE e.name END,
      filePath: e.filePath,
      startLine: CASE WHEN e:Variable THEN e.line ELSE e.startLine END,
      hash: e.embeddingTextHash
    }) AS entityHashes,
    CASE WHEN f.embeddingTextHash IS NOT NULL THEN f.embeddingTextHash ELSE null END AS fileHash
    RETURN fp AS filePath, fileHash, entityHashes
  `,

  // --- Batch embedding UNWIND queries ---
  BATCH_UPDATE_FILE_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (f:File {filePath: item.filePath})
    SET f.embedding = vecf32(item.embedding), f.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_FUNCTION_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (fn:Function {id: item.id})
    SET fn.embedding = vecf32(item.embedding), fn.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_CLASS_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (c:Class {id: item.id})
    SET c.embedding = vecf32(item.embedding), c.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_INTERFACE_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (i:Interface {id: item.id})
    SET i.embedding = vecf32(item.embedding), i.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_VARIABLE_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (v:Variable {id: item.id})
    SET v.embedding = vecf32(item.embedding), v.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_TYPE_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (t:Type {id: item.id})
    SET t.embedding = vecf32(item.embedding), t.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_COMPONENT_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (comp:Component {id: item.id})
    SET comp.embedding = vecf32(item.embedding), comp.embeddingTextHash = item.embeddingTextHash
  `,
};


// ============================================================================
// Operations Interface
// ============================================================================

/**
 * Graph CRUD operations interface
 */
export interface GraphOperations {
  upsertFile(file: FileEntity): Promise<void>;
  upsertFunction(fn: FunctionEntity): Promise<void>;
  upsertClass(cls: ClassEntity): Promise<void>;
  upsertInterface(iface: InterfaceEntity): Promise<void>;
  upsertVariable(variable: VariableEntity): Promise<void>;
  upsertType(type: TypeEntity): Promise<void>;
  upsertComponent(component: ComponentEntity): Promise<void>;

  createCallEdge(
    callerName: string,
    callerFile: string,
    calleeName: string,
    calleeFile: string,
    line: number,
    callerKind?: 'Function' | 'Variable' | 'Class' | 'Interface',
    via?: 'direct' | 'closure',
    /**
     * Class the callee method belongs to, when known (receiver-typed call).
     * When set, the edge is created via CREATE_CALLS_EDGE_BY_CLASS (matched
     * through HAS_METHOD) instead of the plain {name, filePath} match, so two
     * same-named methods on different classes in the same file don't both
     * receive the edge. Omitted/undefined keeps today's unqualified behavior.
     */
    calleeClassName?: string,
    endpointIds?: { callerId?: string | undefined; calleeId?: string | undefined },
  ): Promise<void>;

  createImportsEdge(
    fromPath: string,
    toPath: string,
    specifiers?: string[]
  ): Promise<void>;

  /**
   * Create a File EXPORTS symbol edge. Canonical endpoint ids take priority.
   * Name, path, and kind matching is the fallback for legacy descriptors
   * without ids and can be removed after all producers resolve endpoints.
   */
  createExportsEdge(
    filePath: string,
    symbolName: string,
    symbolKind: ExportableSymbolKind,
    props?: { asName?: string | undefined; isDefault?: boolean | undefined; fromId?: string | undefined; toId?: string | undefined }
  ): Promise<void>;

  /**
   * Create an importing File to imported-symbol IMPORTS_SYMBOL edge (not the
   * imported File, which is handled by createImportsEdge). Canonical endpoint
   * ids take priority, with name and path retained only for descriptors that
   * do not carry ids.
   */
  createImportsSymbolEdge(
    fromFilePath: string,
    toFilePath: string,
    symbolName: string,
    props?: { alias?: string | undefined; isDefault?: boolean | undefined; fromId?: string | undefined; toId?: string | undefined }
  ): Promise<void>;

  createExtendsEdge(
    childName: string,
    childFile: string,
    parentName: string,
    parentFile?: string,
    endpointIds?: { childId?: string | undefined; parentId?: string | undefined },
  ): Promise<void>;

  createImplementsEdge(
    className: string,
    classFile: string,
    interfaceName: string,
    interfaceFile?: string,
    endpointIds?: { classId?: string | undefined; interfaceId?: string | undefined },
  ): Promise<void>;

  createRendersEdge(
    parentName: string,
    parentFile: string,
    childName: string,
    line: number,
    endpointIds?: { parentId?: string | undefined; childId?: string | undefined },
  ): Promise<void>;

  createHasMethodEdge(
    fromId: string,
    toId: string,
    props?: { isStatic?: boolean; visibility?: 'public' | 'private' | 'protected' }
  ): Promise<void>;

  createHasPropertyEdge(
    fromId: string,
    toId: string,
    props?: { isStatic?: boolean; visibility?: 'public' | 'private' | 'protected'; isReadonly?: boolean }
  ): Promise<void>;

  /** Ensure a semantic Type reference node exists in the graph (MERGE by id). */
  mergeTypeRef(typeRef: TypeRefEntity): Promise<void>;

  /** Create a HAS_PARAM edge from a Function node to a Type node. */
  createHasParamEdge(
    fromId: string,
    toId: string,
    props: { position: number; name: string; isOptional: boolean }
  ): Promise<void>;

  /** Create a RETURNS edge from a Function node to a Type node. */
  createReturnsEdge(
    fromId: string,
    toId: string,
    props?: { isAsync: boolean }
  ): Promise<void>;

  /** Create a USES_TYPE edge from a Function node to a Type node. */
  createUsesTypeEdge(
    fromId: string,
    toId: string,
    props: { kind: 'annotation' | 'instantiation' | 'cast' }
  ): Promise<void>;

  deleteFileEntities(filePath: string): Promise<void>;

  /** Remove a deleted file and detach-delete every source declaration it owned. */
  removeFileAndCleanup(filePath: string): Promise<void>;

  /**
   * Content-only removal, for a file whose CONTENT changed and is about to
   * be re-parsed (not a file deleted from disk: use removeFileAndCleanup()
   * for that). Marks its prior source declarations stale and clears
   * refresh-owned outgoing edges. The following upsert clears the marker
   * on current IDs, then detach-deletes every remaining stale declaration.
   */
  removeFileContents(filePath: string): Promise<void>;

  /** Detach-delete source declarations not present in the changed file's current ID set. */
  sweepStaleFileSymbols(filePath: string, currentIds: readonly string[]): Promise<void>;

  /**
   * Content-only removal for a changed Markdown document. Deletes its
   * contained Section, CodeBlock, and Link nodes and their edges while
   * preserving the MarkdownDocument node itself.
   */
  removeDocumentContents(documentPath: string): Promise<void>;

  clearAll(): Promise<void>;

  batchUpsert(entities: ParsedFileEntities): Promise<void>;

  /** Batch upsert multiple files' entities using UNWIND (much fewer Cypher round trips) */
  batchUpsertBulk(entitiesList: ParsedFileEntities[]): Promise<void>;

  /** Batch CREATE (no MERGE) — use after clearAll() for full reindex. Much faster than MERGE. */
  batchCreateBulk(entitiesList: ParsedFileEntities[]): Promise<void>;

  /** Batch link multiple files to a project in one query */
  linkProjectFiles(projectId: string, filePaths: string[]): Promise<void>;

  /** Batch upsert document entities (markdown files: document + sections + codeBlocks + links) */
  batchUpsertDocuments(docsList: ExtractedDocumentEntities[]): Promise<void>;

  /** Batch update embeddings for multiple entities using UNWIND (7 queries max instead of N) */
  batchUpdateEmbeddings(items: Array<{
    nodeType: SymbolLabel;
    identifier: Record<string, unknown>;
    embedding: number[];
    embeddingTextHash: string;
  }>): Promise<number>;

  // Project operations
  upsertProject(project: ProjectEntity): Promise<void>;
  getProjects(): Promise<ProjectEntity[]>;
  getProjectByRoot(rootPath: string): Promise<ProjectEntity | null>;
  deleteProject(projectId: string): Promise<void>;
  linkProjectFile(projectId: string, filePath: string): Promise<void>;

  /** Get all file paths and hashes for a project (for incremental indexing) */
  getProjectFileHashes(projectId: string): Promise<Array<{ path: string; hash: string }>>;

  // Commit operations
  upsertCommit(commit: CommitEntity): Promise<void>;
  createModifiedInEdge(
    filePath: string,
    commitHash: string,
    linesAdded?: number,
    linesRemoved?: number,
    complexityDelta?: number
  ): Promise<void>;

  /** Create INTRODUCED_IN edges from all entities in a file to a commit */
  createIntroducedInEdgesForFile(filePath: string, commitHash: string): Promise<number>;

  /** Create DELETED_IN edges from all entities in a file to a commit */
  createDeletedInEdgesForFile(filePath: string, commitHash: string): Promise<number>;

  /** Get existing embedding text hashes for entities in the given files (for incremental embedding) */
  getEmbeddingHashesForFiles(filePaths: string[]): Promise<Map<string, string>>;

  /** Update embedding + embeddingTextHash for a node in the graph */
  updateEmbedding(
    nodeType: SymbolLabel,
    identifier: Record<string, unknown>,
    embedding: number[],
    embeddingTextHash: string,
  ): Promise<void>;

  /** Vector similarity search across a specific node type */
  searchByVector(
    nodeType: SymbolLabel,
    embedding: number[],
    limit?: number,
  ): Promise<VectorSearchResult[]>;
}

/** Result from vector similarity search */
export interface VectorSearchResult {
  id: string;
  nodeType: string;
  name: string;
  filePath: string;
  startLine?: number;
  distance: number;
  properties: Record<string, unknown>;
}

// ============================================================================
// Helper to convert props to QueryParams
// ============================================================================

function toParams<T extends object>(props: T): QueryParams {
  return props as unknown as QueryParams;
}

// ============================================================================
// Operations Implementation
// ============================================================================

class GraphOperationsImpl implements GraphOperations {
  private readonly dialect: CypherDialect;

  constructor(private readonly client: GraphClient) {
    this.dialect = client.dialect;
  }

  @trace()
  async upsertFile(file: FileEntity): Promise<void> {
    const props = fileToNodeProps(file);
    // File PK is `filePath` — unique identifier for File nodes
    await this.client.query(CYPHER.UPSERT_FILE, { params: toParams(props) });
  }

  @trace()
  async upsertFunction(fn: FunctionEntity): Promise<void> {
    const props = functionToNodeProps(fn);
    await this.client.query(CYPHER.UPSERT_FUNCTION, { params: toParams(props) });
  }

  @trace()
  async upsertClass(cls: ClassEntity): Promise<void> {
    const props = classToNodeProps(cls);
    await this.client.query(CYPHER.UPSERT_CLASS, { params: toParams(props) });
  }

  @trace()
  async upsertInterface(iface: InterfaceEntity): Promise<void> {
    const props = interfaceToNodeProps(iface);
    await this.client.query(CYPHER.UPSERT_INTERFACE, { params: toParams(props) });
  }

  @trace()
  async upsertVariable(variable: VariableEntity): Promise<void> {
    const props = variableToNodeProps(variable);
    await this.client.query(CYPHER.UPSERT_VARIABLE, { params: toParams(props) });
  }

  @trace()
  async upsertType(type: TypeEntity): Promise<void> {
    const props = typeToNodeProps(type);
    await this.client.query(CYPHER.UPSERT_TYPE, { params: toParams(props) });
  }

  @trace()
  async upsertComponent(component: ComponentEntity): Promise<void> {
    const props = componentToNodeProps(component);
    await this.client.query(CYPHER.UPSERT_COMPONENT, { params: toParams(props) });
  }

  @trace()
  async createCallEdge(
    callerName: string,
    callerFile: string,
    calleeName: string,
    calleeFile: string,
    line: number,
    callerKind: 'Function' | 'Variable' | 'Class' | 'Interface' = 'Function',
    via: 'direct' | 'closure' = 'direct',
    calleeClassName?: string,
    endpointIds: { callerId?: string | undefined; calleeId?: string | undefined } = {},
  ): Promise<void> {
    const callerId = endpointIds.callerId ?? null;
    const calleeId = endpointIds.calleeId ?? null;
    if (calleeClassName && callerId === null && calleeId === null) {
      await this.client.query(CYPHER.CREATE_CALLS_EDGE_BY_CLASS, {
        params: { callerName, callerFile, calleeName, calleeFile, line, callerKind, via, calleeClassName },
      });
      return;
    }
    await this.client.query(CYPHER.CREATE_CALLS_EDGE, {
      params: { callerId, calleeId, callerName, callerFile, calleeName, calleeFile, line, callerKind, via },
    });
  }

  @trace()
  async createImportsEdge(
    fromPath: string,
    toPath: string,
    specifiers?: string[]
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_IMPORTS_EDGE, {
      params: { fromPath, toPath, specifiers: specifiers ?? null },
    });
  }

  @trace()
  async createExportsEdge(
    filePath: string,
    symbolName: string,
    symbolKind: ExportableSymbolKind,
    props: { asName?: string | undefined; isDefault?: boolean | undefined; fromId?: string | undefined; toId?: string | undefined } = {},
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_EXPORTS_EDGE, {
      params: {
        fromId: props.fromId ?? null,
        toId: props.toId ?? null,
        filePath,
        symbolName,
        symbolKind,
        asName: props.asName ?? null,
        isDefault: props.isDefault ?? null,
      },
    });
  }

  @trace()
  async createImportsSymbolEdge(
    fromFilePath: string,
    toFilePath: string,
    symbolName: string,
    props: { alias?: string | undefined; isDefault?: boolean | undefined; fromId?: string | undefined; toId?: string | undefined } = {},
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_IMPORTS_SYMBOL_EDGE, {
      params: {
        fromId: props.fromId ?? null,
        toId: props.toId ?? null,
        fromFilePath,
        toFilePath,
        symbolName,
        alias: props.alias ?? null,
        isDefault: props.isDefault ?? false,
      },
    });
  }

  @trace()
  async createExtendsEdge(
    childName: string,
    childFile: string,
    parentName: string,
    parentFile?: string,
    endpointIds: { childId?: string | undefined; parentId?: string | undefined } = {},
  ): Promise<void> {
    const params = {
      childId: endpointIds.childId ?? null,
      parentId: endpointIds.parentId ?? null,
      childName,
      childFile,
      parentName,
      parentFile: parentFile ?? null,
    };
    await this.client.query(endpointIds.parentId ? CYPHER.CREATE_EXTENDS_EDGE_BY_ID : CYPHER.CREATE_EXTENDS_EDGE, {
      params,
    });
  }

  @trace()
  async createImplementsEdge(
    className: string,
    classFile: string,
    interfaceName: string,
    interfaceFile?: string,
    endpointIds: { classId?: string | undefined; interfaceId?: string | undefined } = {},
  ): Promise<void> {
    const params = {
      classId: endpointIds.classId ?? null,
      interfaceId: endpointIds.interfaceId ?? null,
      className,
      classFile,
      interfaceName,
      interfaceFile: interfaceFile ?? null,
    };
    await this.client.query(endpointIds.interfaceId ? CYPHER.CREATE_IMPLEMENTS_EDGE_BY_ID : CYPHER.CREATE_IMPLEMENTS_EDGE, {
      params,
    });
  }

  @trace()
  async createRendersEdge(
    parentName: string,
    parentFile: string,
    childName: string,
    line: number,
    endpointIds: { parentId?: string | undefined; childId?: string | undefined } = {},
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_RENDERS_EDGE, {
      params: {
        parentId: endpointIds.parentId ?? null,
        childId: endpointIds.childId ?? null,
        parentName,
        parentFile,
        childName,
        line,
      },
    });
  }

  @trace()
  async createHasMethodEdge(
    fromId: string,
    toId: string,
    props: { isStatic?: boolean; visibility?: 'public' | 'private' | 'protected' } = {},
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_HAS_METHOD_EDGE, {
      params: { fromId, toId, isStatic: props.isStatic ?? null, visibility: props.visibility ?? null },
    });
  }

  @trace()
  async createHasPropertyEdge(
    fromId: string,
    toId: string,
    props: { isStatic?: boolean; visibility?: 'public' | 'private' | 'protected'; isReadonly?: boolean } = {},
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_HAS_PROPERTY_EDGE, {
      params: { fromId, toId, isStatic: props.isStatic ?? null, visibility: props.visibility ?? null, isReadonly: props.isReadonly ?? null },
    });
  }

  @trace()
  async mergeTypeRef(typeRef: TypeRefEntity): Promise<void> {
    await this.client.query(CYPHER.MERGE_TYPE_REF, {
      params: {
        id: typeRef.id,
        name: typeRef.name,
        language: typeRef.language,
        isPrimitive: typeRef.isPrimitive,
        definingFile: typeRef.definingFile ?? null,
      },
    });
  }

  @trace()
  async createHasParamEdge(
    fromId: string,
    toId: string,
    props: { position: number; name: string; isOptional: boolean },
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_HAS_PARAM_EDGE, {
      params: { fromId, toId, ...props },
    });
  }

  @trace()
  async createReturnsEdge(
    fromId: string,
    toId: string,
    props: { isAsync: boolean } = { isAsync: false },
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_RETURNS_EDGE, {
      params: { fromId, toId, isAsync: props.isAsync },
    });
  }

  @trace()
  async createUsesTypeEdge(
    fromId: string,
    toId: string,
    props: { kind: 'annotation' | 'instantiation' | 'cast' },
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_USES_TYPE_EDGE, {
      params: { fromId, toId, kind: props.kind },
    });
  }

  @trace()
  async deleteFileEntities(filePath: string): Promise<void> {
    await this.client.query(CYPHER.REMOVE_FILE_SYMBOLS, { params: { filePath } });
    await this.client.query(CYPHER.REMOVE_FILE_DOCUMENT, { params: { filePath } });
    await this.client.query(CYPHER.REMOVE_FILE_NODE, { params: { filePath } });
  }

  @trace()
  async removeFileAndCleanup(filePath: string): Promise<void> {
    await this.client.query(CYPHER.REMOVE_FILE_SYMBOLS, { params: { filePath } });
    await this.client.query(CYPHER.REMOVE_FILE_DOCUMENT, { params: { filePath } });
    await this.client.query(CYPHER.REMOVE_FILE_NODE, { params: { filePath } });
  }

  @trace()
  async removeFileContents(filePath: string): Promise<void> {
    await this.client.query(CYPHER.REMOVE_FILE_CONTENTS, { params: { filePath } });
    await this.client.query(CYPHER.REMOVE_FILE_OUTGOING_EDGES, { params: { filePath } });
    await this.client.query(CYPHER.REMOVE_SYMBOL_OUTGOING_EDGES, { params: { filePath } });
  }

  @trace()
  async sweepStaleFileSymbols(filePath: string, currentIds: readonly string[]): Promise<void> {
    await this.client.query(CYPHER.SWEEP_STALE_FILE_SYMBOL_IDS, {
      params: { filePath, currentIds: [...currentIds] },
    });
  }

  @trace()
  async removeDocumentContents(documentPath: string): Promise<void> {
    await this.client.query(CYPHER.REMOVE_DOCUMENT_CONTENTS, { params: { documentPath } });
  }

  @trace()
  async clearAll(): Promise<void> {
    await this.client.query(CYPHER.CLEAR_ALL, { params: {} });
  }

  @trace()
  async batchUpsert(entities: ParsedFileEntities): Promise<void> {
    // Upsert file first (parent node for CONTAINS edges)
    await this.upsertFile(entities.file);

    // Upsert all entity types in parallel as they all connect to the file
    await Promise.all([
      // Functions
      ...entities.functions.map((fn) => this.upsertFunction(fn)),
      // Classes
      ...entities.classes.map((cls) => this.upsertClass(cls)),
      // Interfaces
      ...entities.interfaces.map((iface) => this.upsertInterface(iface)),
      // Variables
      ...entities.variables.map((v) => this.upsertVariable(v)),
      // Types
      ...entities.types.map((t) => this.upsertType(t)),
      // Components
      ...entities.components.map((comp) => this.upsertComponent(comp)),
    ]);

    await this.client.query(CYPHER.SWEEP_STALE_FILE_SYMBOLS, {
      params: { filePath: entities.file.path },
    });

    // Create edges in parallel (after entities exist). Call edges are
    // deliberately NOT in this batch: a class-qualified call edge
    // (calleeClassName set) is matched through Class-HAS_METHOD-Function, so
    // it must run after HAS_METHOD edges exist, not concurrently with them,
    // see the separate await below.
    await Promise.all([
      // Import edges
      ...entities.importsEdges.map((edge) =>
        this.createImportsEdge(edge.fromFilePath, edge.toFilePath, edge.specifiers)
      ),
      // Extends edges (classes) - extract parent file from ID if present
      ...entities.extendsEdges.map((edge) => {
        const parent = edgeEndpoint(edge.parentId);
        const child = edgeEndpoint(edge.childId);
        return this.createExtendsEdge(
          child.name ?? '',
          child.filePath ?? '',
          parent.name ?? '',
          parent.filePath ?? undefined,
          { childId: child.id ?? undefined, parentId: parent.id ?? undefined },
        );
      }),
      // Implements edges (class -> interface) - extract interface file from ID if present
      ...entities.implementsEdges.map((edge) => {
        const iface = edgeEndpoint(edge.interfaceId);
        const cls = edgeEndpoint(edge.classId);
        return this.createImplementsEdge(
          cls.name ?? '',
          cls.filePath ?? '',
          iface.name ?? '',
          iface.filePath ?? undefined,
          { classId: cls.id ?? undefined, interfaceId: iface.id ?? undefined },
        );
      }),
      // Renders edges (components)
      ...entities.rendersEdges.map((edge) => {
        const parent = edgeEndpoint(edge.parentId);
        const child = edgeEndpoint(edge.childId);
        return this.createRendersEdge(
          parent.name ?? '',
          parent.filePath ?? '',
          child.name ?? '',
          edge.line,
          { parentId: parent.id ?? undefined, childId: child.id ?? undefined },
        );
      }),
      // HAS_METHOD edges (class → method Function node)
      ...entities.hasMethodEdges.map((edge) =>
        this.createHasMethodEdge(edge.fromId, edge.toId, { isStatic: edge.isStatic, visibility: edge.visibility })
      ),
      // HAS_PROPERTY edges (class → property Variable node)
      ...entities.hasPropertyEdges.map((edge) =>
        this.createHasPropertyEdge(edge.fromId, edge.toId, { isStatic: edge.isStatic, visibility: edge.visibility, isReadonly: edge.isReadonly })
      ),
      // EXPORTS edges (File → exported symbol)
      ...entities.exportsEdges.map((edge) =>
        this.createExportsEdge(edge.filePath, edge.symbolName, edge.symbolKind, {
          asName: edge.asName,
          isDefault: edge.isDefault,
          fromId: edge.fromId,
          toId: edge.toId,
        })
      ),
      // IMPORTS_SYMBOL edges (importing File → imported symbol node)
      ...entities.importsSymbolEdges.map((edge) =>
        this.createImportsSymbolEdge(edge.fromFilePath, edge.toFilePath, edge.symbolName, {
          alias: edge.alias,
          isDefault: edge.isDefault,
          fromId: edge.fromId,
          toId: edge.toId,
        })
      ),
    ]);

    // Call edges, after HAS_METHOD edges above: a class-qualified call edge
    // (calleeClassName set) is matched through Class-HAS_METHOD-Function, so
    // that edge must already exist or the OPTIONAL MATCH finds nothing and
    // silently drops the call.
    await Promise.all(
      entities.callEdges.map((edge) => {
        const caller = edgeEndpoint(edge.callerId);
        const callee = edgeEndpoint(edge.calleeId);
        return this.createCallEdge(
          caller.name ?? '',
          caller.filePath ?? '',
          callee.name ?? '',
          callee.filePath ?? '',
          edge.line,
          edge.callerKind,
          edge.via,
          edge.calleeClassName,
          { callerId: caller.id ?? undefined, calleeId: callee.id ?? undefined },
        );
      }),
    );

    // Type ref nodes must exist before type-relationship edges are MERGE'd.
    // Process sequentially: create all TypeRef nodes, then create the edges.
    for (const typeRef of entities.typeRefs) {
      await this.mergeTypeRef(typeRef);
    }

    // HAS_PARAM edges (function → parameter type node)
    for (const edge of entities.hasParamEdges) {
      await this.createHasParamEdge(edge.fromId, edge.toId, { position: edge.position, name: edge.name, isOptional: edge.isOptional });
    }

    // RETURNS edges (function → return type node)
    for (const edge of entities.returnsEdges) {
      await this.createReturnsEdge(edge.fromId, edge.toId, { isAsync: edge.isAsync });
    }

    // USES_TYPE edges (function → type used in body)
    for (const edge of entities.usesTypeEdges) {
      await this.createUsesTypeEdge(edge.fromId, edge.toId, { kind: edge.kind });
    }
  }

  // ---- UNWIND Bulk Operations (PERF.2) ----

  @trace()
  async batchUpsertBulk(entitiesList: ParsedFileEntities[]): Promise<void> {
    if (entitiesList.length === 0) return;

    // Collect all entities by type across all files
    const files = entitiesList.map(e => fileToNodeProps(e.file));
    const functions = entitiesList.flatMap(e => e.functions.map(fn => functionToNodeProps(fn)));
    const classes = entitiesList.flatMap(e => e.classes.map(cls => classToNodeProps(cls)));
    const interfaces = entitiesList.flatMap(e => e.interfaces.map(iface => interfaceToNodeProps(iface)));
    const variables = entitiesList.flatMap(e => e.variables.map(v => variableToNodeProps(v)));
    const types = entitiesList.flatMap(e => e.types.map(t => typeToNodeProps(t)));
    const components = entitiesList.flatMap(e => e.components.map(comp => componentToNodeProps(comp)));

    // Sub-chunk helper to avoid crashing FalkorDB with huge UNWIND arrays.
    // Node MERGE uses larger chunks; edge MERGE uses smaller chunks because
    // UNWIND + double-MATCH + MERGE is expensive and can crash FalkorDB.
    const NODE_CHUNK = 500;
    const chunkedQuery = async <T>(cypher: string, items: T[], chunkSize = NODE_CHUNK): Promise<void> => {
      for (let i = 0; i < items.length; i += chunkSize) {
        await this.client.query(cypher, { params: { items: items.slice(i, i + chunkSize) } });
      }
    };

    // Upsert files first (parent nodes for CONTAINS edges)
    if (files.length > 0) await chunkedQuery(CYPHER.BATCH_UPSERT_FILES, files);

    // Upsert all entity types sequentially with sub-chunking
    if (functions.length > 0) await chunkedQuery(CYPHER.BATCH_UPSERT_FUNCTIONS, functions);
    if (classes.length > 0) await chunkedQuery(CYPHER.BATCH_UPSERT_CLASSES, classes);
    if (interfaces.length > 0) await chunkedQuery(CYPHER.BATCH_UPSERT_INTERFACES, interfaces);
    if (variables.length > 0) await chunkedQuery(CYPHER.BATCH_UPSERT_VARIABLES, variables);
    if (types.length > 0) await chunkedQuery(CYPHER.BATCH_UPSERT_TYPES, types);
    if (components.length > 0) await chunkedQuery(CYPHER.BATCH_UPSERT_COMPONENTS, components);

    for (const entities of entitiesList) {
      await this.client.query(CYPHER.SWEEP_STALE_FILE_SYMBOLS, {
        params: { filePath: entities.file.path },
      });
    }

    // Collect and batch all edges
    const callEdges = entitiesList.flatMap(e =>
      e.callEdges.map(edge => {
        const caller = edgeEndpoint(edge.callerId);
        const callee = edgeEndpoint(edge.calleeId);
        return {
          callerId: caller.id,
          callerName: caller.name ?? '',
          callerFile: caller.filePath ?? '',
          callerKind: edge.callerKind,
          calleeId: callee.id,
          calleeName: callee.name ?? '',
          calleeFile: callee.filePath ?? '',
          line: edge.line,
          via: edge.via,
          calleeClassName: edge.calleeClassName ?? null,
        };
      }),
    );
    const importEdges = entitiesList.flatMap(e =>
      e.importsEdges.map(edge => ({
        fromPath: edge.fromFilePath,
        toPath: edge.toFilePath,
        specifiers: edge.specifiers ?? null,
      })),
    );
    const extendsEdges = entitiesList.flatMap(e =>
      e.extendsEdges.map(edge => {
        const parent = edgeEndpoint(edge.parentId);
        const child = edgeEndpoint(edge.childId);
        return {
          childId: child.id,
          childName: child.name ?? '',
          childFile: child.filePath ?? '',
          parentId: parent.id,
          parentName: parent.name ?? '',
          parentFile: parent.filePath,
        };
      }),
    );
    const implementsEdges = entitiesList.flatMap(e =>
      e.implementsEdges.map(edge => {
        const iface = edgeEndpoint(edge.interfaceId);
        const cls = edgeEndpoint(edge.classId);
        return {
          classId: cls.id,
          className: cls.name ?? '',
          classFile: cls.filePath ?? '',
          interfaceId: iface.id,
          interfaceName: iface.name ?? '',
          interfaceFile: iface.filePath,
        };
      }),
    );
    const rendersEdges = entitiesList.flatMap(e =>
      e.rendersEdges.map(edge => {
        const parent = edgeEndpoint(edge.parentId);
        const child = edgeEndpoint(edge.childId);
        return {
          parentId: parent.id,
          parentName: parent.name ?? '',
          parentFile: parent.filePath ?? '',
          childId: child.id,
          childName: child.name ?? '',
          line: edge.line,
        };
      }),
    );

    // Create edges individually to avoid FalkorDB UNWIND+MATCH crash (Record_GetType segfault)
    const safeEdge = async (cypher: string, params: Record<string, unknown>): Promise<void> => {
      try {
        await this.client.query(cypher, { params: params as QueryParams });
      } catch (error) {
        logger.debug('Skipped edge write with missing or unavailable endpoints', error);
      }
    };
    for (const e of importEdges) {
      await safeEdge(
        `MATCH (from:File {filePath: $fromPath})
         MERGE (to:File {filePath: $toPath}) ON CREATE SET to:External
         MERGE (from)-[i:IMPORTS]->(to) SET i.specifiers = $specifiers`,
        e,
      );
    }
    for (const e of extendsEdges) {
      await safeEdge(e.parentId ? CYPHER.CREATE_EXTENDS_EDGE_BY_ID : CYPHER.CREATE_EXTENDS_EDGE, e);
    }
    for (const e of implementsEdges) {
      await safeEdge(e.interfaceId ? CYPHER.CREATE_IMPLEMENTS_EDGE_BY_ID : CYPHER.CREATE_IMPLEMENTS_EDGE, e);
    }
    for (const e of rendersEdges) {
      await safeEdge(CYPHER.CREATE_RENDERS_EDGE, e);
    }

    // HAS_METHOD edges (class → method Function node)
    const hasMethodEdges = entitiesList.flatMap(e => e.hasMethodEdges);
    for (const e of hasMethodEdges) {
      await safeEdge(
        `MATCH (from:Class {id: $fromId})
         MATCH (to:Function {id: $toId})
         MERGE (from)-[r:HAS_METHOD]->(to)
         SET r.isStatic = coalesce($isStatic, false), r.visibility = coalesce($visibility, 'public')`,
        { fromId: e.fromId, toId: e.toId, isStatic: e.isStatic ?? null, visibility: e.visibility ?? null },
      );
    }

    // Call edges, after HAS_METHOD edges above: a class-qualified call edge
    // (calleeClassName set) is matched through Class-HAS_METHOD-Function, so
    // that edge must already exist or the OPTIONAL MATCH finds nothing and
    // silently drops the call. Same query text as CYPHER.CREATE_CALLS_EDGE /
    // CREATE_CALLS_EDGE_BY_CLASS (minus RETURN c, unused here), reused
    // directly so the unqualified path stays byte-for-byte identical to
    // today and the qualified path can never drift out of sync with the
    // canonical template.
    for (const e of callEdges) {
      const usesCanonicalIds = e.callerId !== null || e.calleeId !== null;
      await safeEdge(e.calleeClassName && !usesCanonicalIds ? CYPHER.CREATE_CALLS_EDGE_BY_CLASS : CYPHER.CREATE_CALLS_EDGE, e);
    }

    // HAS_PROPERTY edges (class → property Variable node)
    const hasPropertyEdges = entitiesList.flatMap(e => e.hasPropertyEdges);
    for (const e of hasPropertyEdges) {
      await safeEdge(
        `MATCH (from:Class {id: $fromId})
         MATCH (to:Variable {id: $toId})
         MERGE (from)-[r:HAS_PROPERTY]->(to)
         SET r.isStatic = coalesce($isStatic, false), r.visibility = coalesce($visibility, 'public'), r.isReadonly = coalesce($isReadonly, false)`,
        { fromId: e.fromId, toId: e.toId, isStatic: e.isStatic ?? null, visibility: e.visibility ?? null, isReadonly: e.isReadonly ?? null },
      );
    }

    // TypeRef nodes must exist before type-relationship edges are MERGE'd.
    // Uses :TypeRef (NOT :Type) — see CYPHER.MERGE_TYPE_REF for rationale.
    const typeRefs = entitiesList.flatMap(e => e.typeRefs);
    for (const t of typeRefs) {
      await safeEdge(
        `MERGE (t:TypeRef {id: $id})
         SET t.name = $name, t.language = $language, t.isPrimitive = $isPrimitive,
             t.definingFile = coalesce($definingFile, t.definingFile)`,
        { id: t.id, name: t.name, language: t.language, isPrimitive: t.isPrimitive, definingFile: t.definingFile ?? null },
      );
    }

    // HAS_PARAM edges (function → parameter type node)
    const hasParamEdges: HasParamEdgeDescriptor[] = entitiesList.flatMap(e => e.hasParamEdges);
    for (const e of hasParamEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:TypeRef {id: $toId})
         MERGE (from)-[r:HAS_PARAM]->(to)
         SET r.position = $position, r.name = $name, r.isOptional = $isOptional`,
        { fromId: e.fromId, toId: e.toId, position: e.position, name: e.name, isOptional: e.isOptional },
      );
    }

    // RETURNS edges (function → return type node)
    const returnsEdges: ReturnsEdgeDescriptor[] = entitiesList.flatMap(e => e.returnsEdges);
    for (const e of returnsEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:TypeRef {id: $toId})
         MERGE (from)-[r:RETURNS]->(to)
         SET r.isAsync = $isAsync`,
        { fromId: e.fromId, toId: e.toId, isAsync: e.isAsync },
      );
    }

    // USES_TYPE edges (function → type used in body)
    const usesTypeEdges: UsesTypeEdgeDescriptor[] = entitiesList.flatMap(e => e.usesTypeEdges);
    for (const e of usesTypeEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:TypeRef {id: $toId})
         MERGE (from)-[r:USES_TYPE]->(to)
         SET r.kind = $kind`,
        { fromId: e.fromId, toId: e.toId, kind: e.kind },
      );
    }

    // EXPORTS edges (File → exported symbol). Same MATCH + label-predicate
    // shape as CYPHER.CREATE_EXPORTS_EDGE, see that template for why
    // symbolKind is required.
    const exportsEdges: ExportsEdgeDescriptor[] = entitiesList.flatMap(e => e.exportsEdges);
    for (const e of exportsEdges) {
      await safeEdge(
        CYPHER.CREATE_EXPORTS_EDGE,
        {
          fromId: e.fromId ?? null,
          toId: e.toId ?? null,
          filePath: e.filePath,
          symbolName: e.symbolName,
          symbolKind: e.symbolKind,
          asName: e.asName ?? null,
          isDefault: e.isDefault ?? null,
        },
      );
    }

    // IMPORTS_SYMBOL edges (importing File → imported symbol node, not the
    // imported File). Same plain-MATCH-on-both-sides shape as
    // CYPHER.CREATE_IMPORTS_SYMBOL_EDGE: drops silently when the target
    // symbol isn't in the graph, never MERGEs a stub.
    const importsSymbolEdges: ImportsSymbolEdgeDescriptor[] = entitiesList.flatMap(e => e.importsSymbolEdges);
    for (const e of importsSymbolEdges) {
      await safeEdge(
        CYPHER.CREATE_IMPORTS_SYMBOL_EDGE,
        {
          fromId: e.fromId ?? null,
          toId: e.toId ?? null,
          fromFilePath: e.fromFilePath,
          toFilePath: e.toFilePath,
          symbolName: e.symbolName,
          alias: e.alias ?? null,
          isDefault: e.isDefault,
        },
      );
    }
  }

  @trace()
  async batchCreateBulk(entitiesList: ParsedFileEntities[]): Promise<void> {
    if (entitiesList.length === 0) return;

    // Collect all entities by type across all files
    const files = entitiesList.map(e => fileToNodeProps(e.file));
    const functions = entitiesList.flatMap(e => e.functions.map(fn => functionToNodeProps(fn)));
    const classes = entitiesList.flatMap(e => e.classes.map(cls => classToNodeProps(cls)));
    const interfaces = entitiesList.flatMap(e => e.interfaces.map(iface => interfaceToNodeProps(iface)));
    const variables = entitiesList.flatMap(e => e.variables.map(v => variableToNodeProps(v)));
    const types = entitiesList.flatMap(e => e.types.map(t => typeToNodeProps(t)));
    const components = entitiesList.flatMap(e => e.components.map(comp => componentToNodeProps(comp)));

    // Helper: run a query in sub-chunks to avoid crashing FalkorDB with huge UNWIND arrays.
    // Node CREATE uses larger chunks (simple inserts). Edge MERGE uses smaller chunks
    // because UNWIND + double-MATCH + MERGE is O(n²) and crashes FalkorDB's
    // Record_GetType on large arrays (FalkorDB #1240).
    const NODE_CHUNK = 500;
    const chunkedQuery = async <T>(cypher: string, items: T[], chunkSize = NODE_CHUNK): Promise<void> => {
      for (let i = 0; i < items.length; i += chunkSize) {
        await this.client.query(cypher, { params: { items: items.slice(i, i + chunkSize) } });
      }
    };

    // CREATE files first (must exist for CONTAINS edges in subsequent queries)
    if (files.length > 0) {
      await chunkedQuery(CYPHER.BATCH_CREATE_FILES, files);
    }

    // CREATE all entity types sequentially (FalkorDB is single-threaded; sequential avoids connection overload)
    if (functions.length > 0) await chunkedQuery(CYPHER.BATCH_CREATE_FUNCTIONS_FAST, functions);
    if (classes.length > 0) await chunkedQuery(CYPHER.BATCH_CREATE_CLASSES_FAST, classes);
    if (interfaces.length > 0) await chunkedQuery(CYPHER.BATCH_CREATE_INTERFACES_FAST, interfaces);
    if (variables.length > 0) await chunkedQuery(CYPHER.BATCH_CREATE_VARIABLES_FAST, variables);
    if (types.length > 0) await chunkedQuery(CYPHER.BATCH_CREATE_TYPES_FAST, types);
    if (components.length > 0) await chunkedQuery(CYPHER.BATCH_CREATE_COMPONENTS_FAST, components);

    // Create edges (same as batchUpsertBulk — edges always use MERGE for idempotency)
    const callEdges = entitiesList.flatMap(e =>
      e.callEdges.map(edge => {
        const caller = edgeEndpoint(edge.callerId);
        const callee = edgeEndpoint(edge.calleeId);
        return {
          callerId: caller.id,
          callerName: caller.name ?? '',
          callerFile: caller.filePath ?? '',
          callerKind: edge.callerKind,
          calleeId: callee.id,
          calleeName: callee.name ?? '',
          calleeFile: callee.filePath ?? '',
          line: edge.line,
          via: edge.via,
          calleeClassName: edge.calleeClassName ?? null,
        };
      }),
    );
    const importEdges = entitiesList.flatMap(e =>
      e.importsEdges.map(edge => ({
        fromPath: edge.fromFilePath,
        toPath: edge.toFilePath,
        specifiers: edge.specifiers ?? null,
      })),
    );
    const extendsEdges = entitiesList.flatMap(e =>
      e.extendsEdges.map(edge => {
        const parent = edgeEndpoint(edge.parentId);
        const child = edgeEndpoint(edge.childId);
        return {
          childId: child.id,
          childName: child.name ?? '',
          childFile: child.filePath ?? '',
          parentId: parent.id,
          parentName: parent.name ?? '',
          parentFile: parent.filePath,
        };
      }),
    );
    const implementsEdges = entitiesList.flatMap(e =>
      e.implementsEdges.map(edge => {
        const iface = edgeEndpoint(edge.interfaceId);
        const cls = edgeEndpoint(edge.classId);
        return {
          classId: cls.id,
          className: cls.name ?? '',
          classFile: cls.filePath ?? '',
          interfaceId: iface.id,
          interfaceName: iface.name ?? '',
          interfaceFile: iface.filePath,
        };
      }),
    );
    const rendersEdges = entitiesList.flatMap(e =>
      e.rendersEdges.map(edge => {
        const parent = edgeEndpoint(edge.parentId);
        const child = edgeEndpoint(edge.childId);
        return {
          parentId: parent.id,
          parentName: parent.name ?? '',
          parentFile: parent.filePath ?? '',
          childId: child.id,
          childName: child.name ?? '',
          line: edge.line,
        };
      }),
    );

    // Create edges individually to avoid FalkorDB UNWIND+MATCH crash (Record_GetType segfault).
    // This is slower but stable. FalkorDB crashes on UNWIND+MATCH edge queries on arm64.
    const safeEdge = async (cypher: string, params: Record<string, unknown>): Promise<void> => {
      try {
        await this.client.query(cypher, { params: params as QueryParams });
      } catch (error) {
        logger.debug('Skipped edge write with missing or unavailable endpoints', error);
      }
    };
    for (const e of importEdges) {
      await safeEdge(
        `MATCH (from:File {filePath: $fromPath})
         MERGE (to:File {filePath: $toPath}) ON CREATE SET to:External
         MERGE (from)-[i:IMPORTS]->(to) SET i.specifiers = $specifiers`,
        e,
      );
    }
    for (const e of extendsEdges) {
      await safeEdge(e.parentId ? CYPHER.CREATE_EXTENDS_EDGE_BY_ID : CYPHER.CREATE_EXTENDS_EDGE, e);
    }
    for (const e of implementsEdges) {
      await safeEdge(e.interfaceId ? CYPHER.CREATE_IMPLEMENTS_EDGE_BY_ID : CYPHER.CREATE_IMPLEMENTS_EDGE, e);
    }
    for (const e of rendersEdges) {
      await safeEdge(CYPHER.CREATE_RENDERS_EDGE, e);
    }

    // HAS_METHOD edges (class → method Function node)
    const hasMethodEdges = entitiesList.flatMap(e => e.hasMethodEdges);
    for (const e of hasMethodEdges) {
      await safeEdge(
        `MATCH (from:Class {id: $fromId})
         MATCH (to:Function {id: $toId})
         MERGE (from)-[r:HAS_METHOD]->(to)
         SET r.isStatic = coalesce($isStatic, false), r.visibility = coalesce($visibility, 'public')`,
        { fromId: e.fromId, toId: e.toId, isStatic: e.isStatic ?? null, visibility: e.visibility ?? null },
      );
    }

    // Call edges, after HAS_METHOD edges above: a class-qualified call edge
    // (calleeClassName set) is matched through Class-HAS_METHOD-Function, so
    // that edge must already exist or the OPTIONAL MATCH finds nothing and
    // silently drops the call. Same query text as CYPHER.CREATE_CALLS_EDGE /
    // CREATE_CALLS_EDGE_BY_CLASS (minus RETURN c, unused here), reused
    // directly so the unqualified path stays byte-for-byte identical to
    // today and the qualified path can never drift out of sync with the
    // canonical template.
    for (const e of callEdges) {
      const usesCanonicalIds = e.callerId !== null || e.calleeId !== null;
      await safeEdge(e.calleeClassName && !usesCanonicalIds ? CYPHER.CREATE_CALLS_EDGE_BY_CLASS : CYPHER.CREATE_CALLS_EDGE, e);
    }

    // HAS_PROPERTY edges (class → property Variable node)
    const hasPropertyEdges = entitiesList.flatMap(e => e.hasPropertyEdges);
    for (const e of hasPropertyEdges) {
      await safeEdge(
        `MATCH (from:Class {id: $fromId})
         MATCH (to:Variable {id: $toId})
         MERGE (from)-[r:HAS_PROPERTY]->(to)
         SET r.isStatic = coalesce($isStatic, false), r.visibility = coalesce($visibility, 'public'), r.isReadonly = coalesce($isReadonly, false)`,
        { fromId: e.fromId, toId: e.toId, isStatic: e.isStatic ?? null, visibility: e.visibility ?? null, isReadonly: e.isReadonly ?? null },
      );
    }

    // TypeRef nodes must exist before type-relationship edges are MERGE'd.
    // Uses :TypeRef (NOT :Type) — see CYPHER.MERGE_TYPE_REF for rationale.
    const typeRefs = entitiesList.flatMap(e => e.typeRefs);
    for (const t of typeRefs) {
      await safeEdge(
        `MERGE (t:TypeRef {id: $id})
         SET t.name = $name, t.language = $language, t.isPrimitive = $isPrimitive,
             t.definingFile = coalesce($definingFile, t.definingFile)`,
        { id: t.id, name: t.name, language: t.language, isPrimitive: t.isPrimitive, definingFile: t.definingFile ?? null },
      );
    }

    // HAS_PARAM edges (function → parameter type node)
    const hasParamEdges: HasParamEdgeDescriptor[] = entitiesList.flatMap(e => e.hasParamEdges);
    for (const e of hasParamEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:TypeRef {id: $toId})
         MERGE (from)-[r:HAS_PARAM]->(to)
         SET r.position = $position, r.name = $name, r.isOptional = $isOptional`,
        { fromId: e.fromId, toId: e.toId, position: e.position, name: e.name, isOptional: e.isOptional },
      );
    }

    // RETURNS edges (function → return type node)
    const returnsEdges: ReturnsEdgeDescriptor[] = entitiesList.flatMap(e => e.returnsEdges);
    for (const e of returnsEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:TypeRef {id: $toId})
         MERGE (from)-[r:RETURNS]->(to)
         SET r.isAsync = $isAsync`,
        { fromId: e.fromId, toId: e.toId, isAsync: e.isAsync },
      );
    }

    // USES_TYPE edges (function → type used in body)
    const usesTypeEdges: UsesTypeEdgeDescriptor[] = entitiesList.flatMap(e => e.usesTypeEdges);
    for (const e of usesTypeEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:TypeRef {id: $toId})
         MERGE (from)-[r:USES_TYPE]->(to)
         SET r.kind = $kind`,
        { fromId: e.fromId, toId: e.toId, kind: e.kind },
      );
    }

    // EXPORTS edges (File → exported symbol). Same MATCH + label-predicate
    // shape as CYPHER.CREATE_EXPORTS_EDGE, see that template for why
    // symbolKind is required.
    const exportsEdges: ExportsEdgeDescriptor[] = entitiesList.flatMap(e => e.exportsEdges);
    for (const e of exportsEdges) {
      await safeEdge(
        CYPHER.CREATE_EXPORTS_EDGE,
        {
          fromId: e.fromId ?? null,
          toId: e.toId ?? null,
          filePath: e.filePath,
          symbolName: e.symbolName,
          symbolKind: e.symbolKind,
          asName: e.asName ?? null,
          isDefault: e.isDefault ?? null,
        },
      );
    }

    // IMPORTS_SYMBOL edges (importing File → imported symbol node, not the
    // imported File). Same plain-MATCH-on-both-sides shape as
    // CYPHER.CREATE_IMPORTS_SYMBOL_EDGE: drops silently when the target
    // symbol isn't in the graph, never MERGEs a stub.
    const importsSymbolEdges: ImportsSymbolEdgeDescriptor[] = entitiesList.flatMap(e => e.importsSymbolEdges);
    for (const e of importsSymbolEdges) {
      await safeEdge(
        CYPHER.CREATE_IMPORTS_SYMBOL_EDGE,
        {
          fromId: e.fromId ?? null,
          toId: e.toId ?? null,
          fromFilePath: e.fromFilePath,
          toFilePath: e.toFilePath,
          symbolName: e.symbolName,
          alias: e.alias ?? null,
          isDefault: e.isDefault,
        },
      );
    }
  }

  @trace()
  async linkProjectFiles(projectId: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    const items = filePaths.map(fp => ({ projectId, filePath: fp }));
    await this.client.query(CYPHER.BATCH_LINK_PROJECT_FILES, { params: { items } });
    await this.client.query(CYPHER.BATCH_STAMP_FILE_SYMBOL_OWNERSHIP, { params: { items } });
  }

  @trace()
  async batchUpsertDocuments(docsList: ExtractedDocumentEntities[]): Promise<void> {
    if (docsList.length === 0) return;

    // Collect all document entities by type
    const documents = docsList.map(d => markdownDocumentToNodeProps(d.document));
    const sections = docsList.flatMap(d => d.sections.map(s => sectionToNodeProps(s)));
    const codeBlocks = docsList.flatMap(d => d.codeBlocks.map(cb => codeBlockToNodeProps(cb)));
    const links = docsList.flatMap(d => d.links.map(l => linkToNodeProps(l)));
    // PARENT_SECTION pairs, tagged with each document's own filePath so the
    // batch query can match sections within the right document (see
    // buildSectionHierarchy in @codegraph/plugin-markdown for how these are
    // computed).
    const sectionHierarchy = docsList.flatMap(d =>
      d.sectionHierarchy.map(h => ({
        filePath: d.document.path,
        parentStartLine: h.parentStartLine,
        childStartLine: h.childStartLine,
      })),
    );

    // Upsert documents first (parent nodes for CONTAINS edges)
    if (documents.length > 0) {
      await this.client.query(CYPHER.BATCH_UPSERT_DOCUMENTS, { params: { items: documents } });
    }

    // Upsert child entities (with CONTAINS edges to documents)
    const childOps: Promise<void>[] = [];
    if (sections.length > 0) {
      childOps.push(
        this.client.query(CYPHER.BATCH_UPSERT_SECTIONS, { params: { items: sections } }).then(() => {}),
      );
    }
    if (codeBlocks.length > 0) {
      childOps.push(
        this.client.query(CYPHER.BATCH_UPSERT_CODEBLOCKS, { params: { items: codeBlocks } }).then(() => {}),
      );
    }
    if (links.length > 0) {
      childOps.push(
        this.client.query(CYPHER.BATCH_UPSERT_LINKS, { params: { items: links } }).then(() => {}),
      );
    }
    await Promise.all(childOps);

    // PARENT_SECTION edges, after every Section node above exists: this
    // query MATCHes both endpoints by (filePath, startLine), so it must run
    // after BATCH_UPSERT_SECTIONS, not concurrently with it.
    if (sectionHierarchy.length > 0) {
      await this.client.query(CYPHER.BATCH_CREATE_PARENT_SECTION_EDGES, { params: { items: sectionHierarchy } });
    }

    for (const doc of docsList) {
      await this.client.query(CYPHER.STAMP_DOCUMENT_PROJECT_OWNERSHIP, {
        params: { documentPath: doc.document.path },
      });
    }
  }

  @trace()
  async batchUpdateEmbeddings(items: Array<{
    nodeType: SymbolLabel;
    identifier: Record<string, unknown>;
    embedding: number[];
    embeddingTextHash: string;
  }>): Promise<number> {
    if (items.length === 0) return 0;

    // Group items by node type
    const byType = new Map<string, Array<Record<string, unknown>>>();
    for (const item of items) {
      if (item.nodeType !== 'File') {
        const id = item.identifier['id'];
        if (typeof id !== 'string' || id.length === 0) {
          throw new Error(`Canonical id is required to update a ${item.nodeType} embedding`);
        }
      }
      const key = item.nodeType;
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push({
        ...item.identifier,
        embedding: item.embedding,
        embeddingTextHash: item.embeddingTextHash,
      });
    }

    const queryMap: Record<string, string> = {
      File: CYPHER.BATCH_UPDATE_FILE_EMBEDDINGS,
      Function: CYPHER.BATCH_UPDATE_FUNCTION_EMBEDDINGS,
      Class: CYPHER.BATCH_UPDATE_CLASS_EMBEDDINGS,
      Interface: CYPHER.BATCH_UPDATE_INTERFACE_EMBEDDINGS,
      Variable: CYPHER.BATCH_UPDATE_VARIABLE_EMBEDDINGS,
      Type: CYPHER.BATCH_UPDATE_TYPE_EMBEDDINGS,
      Component: CYPHER.BATCH_UPDATE_COMPONENT_EMBEDDINGS,
    };

    // Execute one UNWIND query per entity type (max 7 queries total)
    const ops = Array.from(byType.entries()).map(([nodeType, typeItems]) => {
      const cypher = queryMap[nodeType];
      if (!cypher) return Promise.resolve();
      return this.client.query(cypher, { params: { items: typeItems } });
    });
    await Promise.all(ops);

    return items.length;
  }

  @trace()
  async getEmbeddingHashesForFiles(filePaths: string[]): Promise<Map<string, string>> {
    if (filePaths.length === 0) return new Map();

    // Source embedding hashes use the same opaque persisted identity as writes.
    const hashMap = new Map<string, string>();

    // Process in chunks to avoid query size limits
    const CHUNK = 200;
    for (let i = 0; i < filePaths.length; i += CHUNK) {
      const chunk = filePaths.slice(i, i + CHUNK);
      try {
        const result = await this.client.roQuery<{
          filePath: string;
          fileHash: string | null;
          entityHashes: Array<{
            nodeType: string;
            id: string;
            name: string;
            filePath: string;
            startLine: number;
            hash: string;
          }>;
        }>(CYPHER.GET_EMBEDDING_HASHES_FOR_FILES, { params: { filePaths: chunk } });

        for (const row of (result.data ?? [])) {
          if (row.fileHash) {
            hashMap.set(`File::${row.filePath}:0`, row.fileHash);
          }
          for (const entity of row.entityHashes) {
            if (entity.hash && entity.id) {
              hashMap.set(entity.id, entity.hash);
            }
          }
        }
      } catch {
        // Non-fatal — will just regenerate all embeddings for this chunk
      }
    }

    return hashMap;
  }

  // Project operations

  @trace()
  async upsertProject(project: ProjectEntity): Promise<void> {
    await this.client.query(CYPHER.UPSERT_PROJECT, {
      params: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        createdAt: project.createdAt,
        lastParsed: project.lastParsed,
        fileCount: project.fileCount ?? 0,
        sourcePipeline: project.sourcePipeline ?? null,
        sourceTask: project.sourceTask ?? null,
        processedAt: project.processedAt ?? null,
      },
    });
  }

  @trace()
  async getProjects(): Promise<ProjectEntity[]> {
    try {
      const result = await this.client.roQuery<{ p: Record<string, unknown> }>(
        CYPHER.GET_ALL_PROJECTS
      );
      return (result.data ?? []).map((row) => this.projectFromRow(row.p));
    } catch {
      // Handle empty graph case - return empty array
      return [];
    }
  }

  @trace()
  async getProjectByRoot(rootPath: string): Promise<ProjectEntity | null> {
    try {
      const result = await this.client.roQuery<{ p: Record<string, unknown> }>(
        CYPHER.GET_PROJECT_BY_ROOT,
        { params: { rootPath } }
      );
      const row = result.data?.[0];
      return row ? this.projectFromRow(row.p) : null;
    } catch {
      // Handle empty graph case - return null (no existing project)
      return null;
    }
  }

  @trace()
  async deleteProject(projectId: string): Promise<void> {
    await this.client.query(CYPHER.DELETE_PROJECT, { params: { id: projectId } });
  }

  @trace()
  async linkProjectFile(projectId: string, filePath: string): Promise<void> {
    await this.client.query(CYPHER.LINK_PROJECT_FILE, {
      params: { projectId, filePath },
    });
    await this.client.query(CYPHER.STAMP_FILE_SYMBOL_OWNERSHIP, {
      params: { projectId, filePath },
    });
  }

  @trace()
  async getProjectFileHashes(projectId: string): Promise<Array<{ path: string; hash: string }>> {
    const result = await this.client.roQuery<{ path: string; hash: string }>(
      CYPHER.GET_PROJECT_FILE_HASHES,
      { params: { projectId } },
    );
    return result.data ?? [];
  }

  // Commit operations

  @trace()
  async upsertCommit(commit: CommitEntity): Promise<void> {
    const props = commitToNodeProps(commit);
    await this.client.query(CYPHER.UPSERT_COMMIT, { params: toParams(props) });
  }

  @trace()
  async createModifiedInEdge(
    filePath: string,
    commitHash: string,
    linesAdded?: number,
    linesRemoved?: number,
    complexityDelta?: number
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_MODIFIED_IN_EDGE, {
      params: {
        filePath,
        commitHash,
        linesAdded: linesAdded ?? null,
        linesRemoved: linesRemoved ?? null,
        complexityDelta: complexityDelta ?? null,
      },
    });
  }

  @trace()
  async createIntroducedInEdgesForFile(filePath: string, commitHash: string): Promise<number> {
    const params = { filePath, commitHash };
    try {
      await this.client.query(
        `MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(e)
         MATCH (c:Commit {hash: $commitHash})
         MERGE (e)-[:INTRODUCED_IN]->(c)`,
        { params }
      );
      return 1;
    } catch {
      // No entities in this file — expected
      return 0;
    }
  }

  @trace()
  async createDeletedInEdgesForFile(filePath: string, commitHash: string): Promise<number> {
    const params = { filePath, commitHash };
    try {
      await this.client.query(
        `MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(e)
         MATCH (c:Commit {hash: $commitHash})
         MERGE (e)-[:DELETED_IN]->(c)`,
        { params }
      );
      return 1;
    } catch {
      // No entities in this file — expected
      return 0;
    }
  }

  @trace()
  async updateEmbedding(
    nodeType: SymbolLabel,
    identifier: Record<string, unknown>,
    embedding: number[],
    embeddingTextHash: string,
  ): Promise<void> {
    const baseParams = { embedding, embeddingTextHash };

    if (nodeType === 'File') {
      await this.client.query(CYPHER.UPDATE_FILE_EMBEDDING, {
        params: { ...baseParams, filePath: (identifier['filePath'] ?? identifier['path']) as string },
      });
      return;
    }

    const id = identifier['id'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`Canonical id is required to update a ${nodeType} embedding`);
    }

    // FalkorDB uses natural keys (name + filePath + startLine/line)
    const templates: Record<string, string> = {
      Function: CYPHER.UPDATE_FUNCTION_EMBEDDING,
      Class: CYPHER.UPDATE_CLASS_EMBEDDING,
      Interface: CYPHER.UPDATE_INTERFACE_EMBEDDING,
      Variable: CYPHER.UPDATE_VARIABLE_EMBEDDING,
      Type: CYPHER.UPDATE_TYPE_EMBEDDING,
      Component: CYPHER.UPDATE_COMPONENT_EMBEDDING,
    };
    await this.client.query(templates[nodeType]!, { params: { ...baseParams, ...identifier, id } });
  }

  // --- Vector Search ---

  @trace()
  async searchByVector(
    nodeType: SymbolLabel,
    embedding: number[],
    limit: number = 10,
  ): Promise<VectorSearchResult[]> {
    // Validate nodeType against allowlist — Cypher doesn't support parameterized labels
    // SYMBOL_LABELS is the shared source of truth (packages/types/src/labels.ts).
    const VALID_NODE_TYPES = new Set(SYMBOL_LABELS);
    if (!VALID_NODE_TYPES.has(nodeType)) {
      throw new Error(`Invalid node type for vector search: ${nodeType}`);
    }

    // FalkorDB native HNSW vector search via db.idx.vector.queryNodes
    const filePathExpr = 'node.filePath';
    const startLineExpr = nodeType === 'Variable' ? 'node.line' : 'node.startLine';
    const startLineReturn = nodeType === 'File' ? '' : `, ${startLineExpr} AS startLine`;

    const cypher = `
      CALL db.idx.vector.queryNodes('${nodeType}', 'embedding', $k, vecf32($queryVec))
      YIELD node, score
      RETURN node.id AS id, node.name AS name, ${filePathExpr} AS filePath${startLineReturn}, score,
             node.endLine AS endLine,
             node.complexity AS complexity,
             node.cognitiveComplexity AS cognitiveComplexity,
             node.nestingDepth AS nestingDepth,
             node.isExported AS isExported,
             node.isAsync AS isAsync,
             node.docstring AS docstring,
             node.loc AS loc,
             node.params AS params,
             node.returnType AS returnType,
             node.signature AS signature,
             node.bodySnippet AS bodySnippet
    `;

    let result: { data: Array<Record<string, unknown>> };
    try {
      result = await this.client.roQuery<Record<string, unknown>>(cypher, {
        params: { queryVec: embedding, k: limit },
      });
    } catch (error) {
      // A missing vector index is an expected, benign state on a fresh graph.
      // Anything else is a real failure and must not be reported as "no results",
      // which is indistinguishable from a legitimately empty search.
      const message = error instanceof Error ? error.message : String(error);
      if (!/index|not indexed|no such/i.test(message)) {
        logger.warn(`Vector search failed for ${nodeType}: ${message}`);
      }
      return [];
    }

    return result.data.map((row) => {
      const id = row['id'];
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(`Vector search returned ${nodeType} row without a valid persisted id`);
      }

      const entry: VectorSearchResult = {
        id,
        nodeType,
        name: row['name'] as string,
        filePath: row['filePath'] as string,
        distance: row['score'] as number,
        properties: row,
      };
      const sl = row['startLine'];
      if (typeof sl === 'number') entry.startLine = sl;
      return entry;
    });
  }

  private projectFromRow(row: Record<string, unknown>): ProjectEntity {
    // Handle FalkorDB nested properties format
    const { properties } = this.dialect.normalizeNode(row);
    const fileCount = properties['fileCount'] as number | undefined;
    const entity: ProjectEntity = {
      id: properties['id'] as string,
      name: properties['name'] as string,
      rootPath: properties['rootPath'] as string,
      createdAt: properties['createdAt'] as string,
      lastParsed: properties['lastParsed'] as string,
    };
    if (fileCount !== undefined) {
      entity.fileCount = fileCount;
    }
    return entity;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create graph operations instance from client
 *
 * @example
 * ```typescript
 * const client = await createClient();
 * const ops = createOperations(client);
 *
 * await ops.upsertFile({
 *   path: '/src/index.ts',
 *   name: 'index.ts',
 *   extension: 'ts',
 *   loc: 150,
 *   lastModified: new Date().toISOString(),
 *   hash: 'abc123'
 * });
 *
 * await ops.deleteFileEntities('/src/old.ts');
 * ```
 */
export function createOperations(client: GraphClient): GraphOperations {
  return new GraphOperationsImpl(client);
}

/**
 * Create a HAS_METHOD edge from a Class to a Function.
 */
export async function createHasMethodEdge(
  client: GraphClient,
  fromId: string,
  toId: string,
  props: { isStatic?: boolean; visibility?: 'public' | 'private' | 'protected' } = {},
): Promise<void> {
  await client.query(CYPHER.CREATE_HAS_METHOD_EDGE, {
    params: { fromId, toId, isStatic: props.isStatic ?? null, visibility: props.visibility ?? null },
  });
}

/**
 * Create a HAS_PROPERTY edge from a Class to a Variable.
 */
export async function createHasPropertyEdge(
  client: GraphClient,
  fromId: string,
  toId: string,
  props: { isStatic?: boolean; visibility?: 'public' | 'private' | 'protected'; isReadonly?: boolean } = {},
): Promise<void> {
  await client.query(CYPHER.CREATE_HAS_PROPERTY_EDGE, {
    params: { fromId, toId, isStatic: props.isStatic ?? null, visibility: props.visibility ?? null, isReadonly: props.isReadonly ?? null },
  });
}
