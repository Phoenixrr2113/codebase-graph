/**
 * @codegraph/graph - CRUD Operations
 * Graph database operations for entities and edges
 * Engine: FalkorDB (primary), FalkorDBLite (local)
 * Based on CodeGraph MVP Specification Section 6.2
 */

import type { GraphClient, QueryParams } from './client';
import type { CypherDialect } from './driver';
import { trace } from '@codegraph/logger';
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
import type {
  ProjectEntity,
  ExtractedDocumentEntities,
  TypeRefEntity,
  HasParamEdgeDescriptor,
  ReturnsEdgeDescriptor,
  UsesTypeEdgeDescriptor,
} from '@codegraph/types';

// ============================================================================
// Entity ID parsing — format: "Type:filePath:name" or "Type:external:name"
// ============================================================================

interface ParsedEntityId {
  type: string;
  filePath: string;
  name: string;
  isExternal: boolean;
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
    SET f.name = $name,
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
    MERGE (fn:Function {name: $name, filePath: $filePath, startLine: $startLine})
    SET fn.endLine = $endLine,
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
    MERGE (c:Class {name: $name, filePath: $filePath, startLine: $startLine})
    SET c.endLine = $endLine,
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
    MERGE (i:Interface {name: $name, filePath: $filePath, startLine: $startLine})
    SET i.endLine = $endLine,
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
    MERGE (v:Variable {name: $name, filePath: $filePath, line: $line})
    SET v.kind = $kind,
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
    MERGE (t:Type {name: $name, filePath: $filePath, startLine: $startLine})
    SET t.endLine = $endLine,
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
    MERGE (comp:Component {name: $name, filePath: $filePath, startLine: $startLine})
    SET comp.endLine = $endLine,
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
  CREATE_CALLS_EDGE: `
    MATCH (caller:Function {name: $callerName, filePath: $callerFile})
    MATCH (callee:Function {name: $calleeName, filePath: $calleeFile})
    MERGE (caller)-[c:CALLS]->(callee)
    ON CREATE SET c.line = $line, c.count = 1
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
    MATCH (child:Class {name: $childName, filePath: $childFile})
    MERGE (parent:Class {name: $parentName, filePath: COALESCE($parentFile, 'external')})
    ON CREATE SET parent:External
    MERGE (child)-[e:EXTENDS]->(parent)
    RETURN e
  `,

  CREATE_IMPLEMENTS_EDGE: `
    MATCH (c:Class {name: $className, filePath: $classFile})
    MERGE (i:Interface {name: $interfaceName, filePath: COALESCE($interfaceFile, 'external')})
    ON CREATE SET i:External
    MERGE (c)-[impl:IMPLEMENTS]->(i)
    RETURN impl
  `,

  CREATE_RENDERS_EDGE: `
    MATCH (parent:Component {name: $parentName, filePath: $parentFile})
    MATCH (child:Component {name: $childName})
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

  // Type reference node — MERGE by id so cross-file references share one node
  MERGE_TYPE_REF: `
    MERGE (t:Type {id: $id})
    SET t.name = $name,
        t.language = $language,
        t.isPrimitive = $isPrimitive,
        t.definingFile = coalesce($definingFile, t.definingFile)
  `,

  CREATE_HAS_PARAM_EDGE: `
    MATCH (from:Function {id: $fromId}), (to:Type {id: $toId})
    MERGE (from)-[r:HAS_PARAM]->(to)
    SET r.position = $position,
        r.name = $name,
        r.isOptional = $isOptional
  `,

  CREATE_RETURNS_EDGE: `
    MATCH (from:Function {id: $fromId}), (to:Type {id: $toId})
    MERGE (from)-[r:RETURNS]->(to)
    SET r.isAsync = $isAsync
  `,

  CREATE_USES_TYPE_EDGE: `
    MATCH (from:Function {id: $fromId}), (to:Type {id: $toId})
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

  // Export edge operations
  CREATE_EXPORTS_EDGE: `
    MATCH (f:File {filePath: $filePath})
    MATCH (symbol {name: $symbolName, filePath: $filePath})
    MERGE (f)-[r:EXPORTS]->(symbol)
    SET r.asName = $asName,
        r.isDefault = $isDefault
    RETURN r
  `,

  GET_FILE_EXPORTS: `
    MATCH (f:File {filePath: $filePath})-[r:EXPORTS]->(symbol)
    RETURN symbol.name as name, labels(symbol)[0] as type, r.asName as asName, r.isDefault as isDefault
  `,

  // Instantiation edge operations
  CREATE_INSTANTIATES_EDGE: `
    MATCH (fn:Function {name: $functionName, filePath: $functionFile})
    MERGE (c:Class {name: $className, filePath: COALESCE($classFile, 'external')})
    ON CREATE SET c:External
    MERGE (fn)-[r:INSTANTIATES]->(c)
    SET r.line = $line
    RETURN r
  `,

  GET_CLASS_INSTANTIATIONS: `
    MATCH (fn:Function)-[r:INSTANTIATES]->(c:Class {name: $className})
    RETURN fn.name as functionName, fn.filePath as functionFile, r.line as line
  `,

  // Delete operations - cascade delete file and all contained entities
  DELETE_FILE_ENTITIES: `
    MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(e)
    DETACH DELETE e
    WITH f
    DETACH DELETE f
  `,

  // Smart file removal (PERF.4) — preserves incoming cross-file edges
  // Step 1: Remove CONTAINS edges and the File node (non-cascading)
  REMOVE_FILE_NODE: `
    MATCH (f:File {filePath: $filePath})
    OPTIONAL MATCH (f)-[c:CONTAINS]->()
    DELETE c, f
  `,

  // Step 2: Remove orphaned entities from this file that have no incoming edges
  // Uses OPTIONAL MATCH to check for ANY incoming relationship from other nodes
  CLEANUP_FILE_ORPHANS: `
    MATCH (e)
    WHERE e.filePath = $filePath
    OPTIONAL MATCH (other)-[r]->(e)
    WHERE other.filePath <> $filePath OR other.filePath IS NULL
    WITH e, r
    WHERE r IS NULL
    DETACH DELETE e
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
    SET p.name = $name,
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
    MATCH (p:Project {id: $id})
    OPTIONAL MATCH (p)-[:HAS_FILE]->(f:File)-[:CONTAINS]->(e)
    DETACH DELETE e
    WITH p, f
    DETACH DELETE f
    WITH p
    DETACH DELETE p
  `,

  LINK_PROJECT_FILE: `
    MATCH (p:Project {id: $projectId})
    MATCH (f:File {filePath: $filePath})
    MERGE (p)-[:HAS_FILE]->(f)
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
    SET f.name = item.name,
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
    MERGE (fn:Function {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET fn.endLine = item.endLine,
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
    MERGE (c:Class {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET c.endLine = item.endLine,
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
    MERGE (i:Interface {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET i.endLine = item.endLine,
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
    MERGE (v:Variable {name: item.name, filePath: item.filePath, line: item.line})
    SET v.kind = item.kind,
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
    MERGE (t:Type {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET t.endLine = item.endLine,
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
    MERGE (comp:Component {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET comp.endLine = item.endLine,
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

  // Edge queries use OPTIONAL MATCH + WHERE to avoid FalkorDB crashes on
  // NULL records (Record_GetType segfault when MATCH finds no node).
  BATCH_CREATE_CALL_EDGES: `
    UNWIND $items AS item
    OPTIONAL MATCH (caller:Function {name: item.callerName, filePath: item.callerFile})
    OPTIONAL MATCH (callee:Function {name: item.calleeName, filePath: item.calleeFile})
    WITH caller, callee, item WHERE caller IS NOT NULL AND callee IS NOT NULL
    MERGE (caller)-[c:CALLS]->(callee)
    ON CREATE SET c.line = item.line, c.count = 1
    ON MATCH SET c.count = c.count + 1
  `,

  BATCH_CREATE_IMPORT_EDGES: `
    UNWIND $items AS item
    OPTIONAL MATCH (from:File {filePath: item.fromPath})
    WITH from, item WHERE from IS NOT NULL
    MERGE (to:File {filePath: item.toPath})
    ON CREATE SET to:External
    MERGE (from)-[i:IMPORTS]->(to)
    SET i.specifiers = item.specifiers
  `,

  BATCH_CREATE_EXTENDS_EDGES: `
    UNWIND $items AS item
    OPTIONAL MATCH (child:Class {name: item.childName, filePath: item.childFile})
    WITH child, item WHERE child IS NOT NULL
    MERGE (parent:Class {name: item.parentName, filePath: COALESCE(item.parentFile, 'external')})
    ON CREATE SET parent:External
    MERGE (child)-[e:EXTENDS]->(parent)
  `,

  BATCH_CREATE_IMPLEMENTS_EDGES: `
    UNWIND $items AS item
    OPTIONAL MATCH (c:Class {name: item.className, filePath: item.classFile})
    WITH c, item WHERE c IS NOT NULL
    MERGE (i:Interface {name: item.interfaceName, filePath: COALESCE(item.interfaceFile, 'external')})
    ON CREATE SET i:External
    MERGE (c)-[impl:IMPLEMENTS]->(i)
  `,

  BATCH_CREATE_RENDERS_EDGES: `
    UNWIND $items AS item
    OPTIONAL MATCH (parent:Component {name: item.parentName, filePath: item.parentFile})
    OPTIONAL MATCH (child:Component {name: item.childName})
    WITH parent, child, item WHERE parent IS NOT NULL AND child IS NOT NULL
    MERGE (parent)-[r:RENDERS]->(child)
    SET r.line = item.line
  `,

  BATCH_LINK_PROJECT_FILES: `
    UNWIND $items AS item
    OPTIONAL MATCH (p:Project {id: item.projectId})
    OPTIONAL MATCH (f:File {filePath: item.filePath})
    WITH p, f WHERE p IS NOT NULL AND f IS NOT NULL
    MERGE (p)-[:HAS_FILE]->(f)
  `,

  // --- Fast CREATE path for full reindex (no MERGE lookups needed) ---
  // Used after clearing old data; CREATE is much faster than MERGE for bulk inserts.
  BATCH_CREATE_FILES: `
    UNWIND $items AS item
    CREATE (f:File {filePath: item.filePath, name: item.name, extension: item.extension,
      loc: item.loc, lastModified: item.lastModified, hash: item.hash,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
  `,

  BATCH_CREATE_FUNCTIONS_FAST: `
    UNWIND $items AS item
    CREATE (fn:Function {name: item.name, filePath: item.filePath, startLine: item.startLine,
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
    CREATE (c:Class {name: item.name, filePath: item.filePath, startLine: item.startLine,
      endLine: item.endLine, isExported: item.isExported, isAbstract: item.isAbstract,
      extends: item.extends, implements: item.implements, docstring: item.docstring,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH c
    MATCH (f:File {filePath: c.filePath})
    CREATE (f)-[:CONTAINS]->(c)
  `,

  BATCH_CREATE_INTERFACES_FAST: `
    UNWIND $items AS item
    CREATE (i:Interface {name: item.name, filePath: item.filePath, startLine: item.startLine,
      endLine: item.endLine, isExported: item.isExported, extends: item.extends,
      docstring: item.docstring,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH i
    MATCH (f:File {filePath: i.filePath})
    CREATE (f)-[:CONTAINS]->(i)
  `,

  BATCH_CREATE_VARIABLES_FAST: `
    UNWIND $items AS item
    CREATE (v:Variable {name: item.name, filePath: item.filePath, line: item.line,
      kind: item.kind, isExported: item.isExported, type: item.type,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH v
    MATCH (f:File {filePath: v.filePath})
    CREATE (f)-[:CONTAINS]->(v)
  `,

  BATCH_CREATE_TYPES_FAST: `
    UNWIND $items AS item
    CREATE (t:Type {name: item.name, filePath: item.filePath, startLine: item.startLine,
      endLine: item.endLine, isExported: item.isExported, kind: item.kind,
      docstring: item.docstring,
      sourcePipeline: item.sourcePipeline, sourceTask: item.sourceTask, processedAt: item.processedAt})
    WITH t
    MATCH (f:File {filePath: t.filePath})
    CREATE (f)-[:CONTAINS]->(t)
  `,

  BATCH_CREATE_COMPONENTS_FAST: `
    UNWIND $items AS item
    CREATE (comp:Component {name: item.name, filePath: item.filePath, startLine: item.startLine,
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
    SET f.name = item.name,
        f.extension = item.extension,
        f.loc = item.loc,
        f.lastModified = item.lastModified,
        f.hash = item.hash,
        f.sourcePipeline = item.sourcePipeline,
        f.sourceTask = item.sourceTask,
        f.processedAt = item.processedAt
    WITH count(*) AS _c1
    UNWIND $functions AS item
    MERGE (fn:Function {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET fn.endLine = item.endLine,
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
    MERGE (c:Class {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET c.endLine = item.endLine,
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
    MERGE (i:Interface {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET i.endLine = item.endLine,
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
    MERGE (v:Variable {name: item.name, filePath: item.filePath, line: item.line})
    SET v.kind = item.kind,
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
    MERGE (t:Type {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET t.endLine = item.endLine,
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
    MERGE (comp:Component {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET comp.endLine = item.endLine,
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

  // --- Combined edge creation (reduces 5 round-trips to 1) ---
  COMBINED_CREATE_EDGES: `
    UNWIND $callEdges AS item
    MATCH (caller:Function {name: item.callerName, filePath: item.callerFile})
    MATCH (callee:Function {name: item.calleeName, filePath: item.calleeFile})
    MERGE (caller)-[c:CALLS]->(callee)
    ON CREATE SET c.line = item.line, c.count = 1
    ON MATCH SET c.count = c.count + 1
    WITH count(*) AS _e1
    UNWIND $importEdges AS item
    MATCH (from:File {filePath: item.fromPath})
    MERGE (to:File {filePath: item.toPath})
    ON CREATE SET to:External
    MERGE (from)-[i:IMPORTS]->(to)
    SET i.specifiers = item.specifiers
    WITH count(*) AS _e2
    UNWIND $extendsEdges AS item
    MATCH (child:Class {name: item.childName, filePath: item.childFile})
    MERGE (parent:Class {name: item.parentName, filePath: COALESCE(item.parentFile, 'external')})
    ON CREATE SET parent:External
    MERGE (child)-[e:EXTENDS]->(parent)
    WITH count(*) AS _e3
    UNWIND $implementsEdges AS item
    MATCH (c:Class {name: item.className, filePath: item.classFile})
    MERGE (i:Interface {name: item.interfaceName, filePath: COALESCE(item.interfaceFile, 'external')})
    ON CREATE SET i:External
    MERGE (c)-[impl:IMPLEMENTS]->(i)
    WITH count(*) AS _e4
    UNWIND $rendersEdges AS item
    MATCH (parent:Component {name: item.parentName, filePath: item.parentFile})
    MATCH (child:Component {name: item.childName})
    MERGE (parent)-[r:RENDERS]->(child)
    SET r.line = item.line
    WITH count(*) AS _e5
    UNWIND $projectLinks AS item
    MATCH (p:Project {id: item.projectId})
    MATCH (f:File {filePath: item.filePath})
    MERGE (p)-[:HAS_FILE]->(f)
    RETURN count(*) AS done
  `,

  // Embedding update operations (per-node-type) — uses vecf32() for proper vector storage
  UPDATE_FILE_EMBEDDING: `
    MATCH (f:File {filePath: $filePath})
    SET f.embedding = vecf32($embedding), f.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_FUNCTION_EMBEDDING: `
    MATCH (fn:Function {name: $name, filePath: $filePath, startLine: $startLine})
    SET fn.embedding = vecf32($embedding), fn.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_CLASS_EMBEDDING: `
    MATCH (c:Class {name: $name, filePath: $filePath, startLine: $startLine})
    SET c.embedding = vecf32($embedding), c.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_INTERFACE_EMBEDDING: `
    MATCH (i:Interface {name: $name, filePath: $filePath, startLine: $startLine})
    SET i.embedding = vecf32($embedding), i.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_VARIABLE_EMBEDDING: `
    MATCH (v:Variable {name: $name, filePath: $filePath, line: $line})
    SET v.embedding = vecf32($embedding), v.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_TYPE_EMBEDDING: `
    MATCH (t:Type {name: $name, filePath: $filePath, startLine: $startLine})
    SET t.embedding = vecf32($embedding), t.embeddingTextHash = $embeddingTextHash
  `,
  UPDATE_COMPONENT_EMBEDDING: `
    MATCH (comp:Component {name: $name, filePath: $filePath, startLine: $startLine})
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
    MATCH (fn:Function {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET fn.embedding = vecf32(item.embedding), fn.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_CLASS_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (c:Class {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET c.embedding = vecf32(item.embedding), c.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_INTERFACE_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (i:Interface {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET i.embedding = vecf32(item.embedding), i.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_VARIABLE_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (v:Variable {name: item.name, filePath: item.filePath, line: item.line})
    SET v.embedding = vecf32(item.embedding), v.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_TYPE_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (t:Type {name: item.name, filePath: item.filePath, startLine: item.startLine})
    SET t.embedding = vecf32(item.embedding), t.embeddingTextHash = item.embeddingTextHash
  `,
  BATCH_UPDATE_COMPONENT_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (comp:Component {name: item.name, filePath: item.filePath, startLine: item.startLine})
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
    line: number
  ): Promise<void>;

  createImportsEdge(
    fromPath: string,
    toPath: string,
    specifiers?: string[]
  ): Promise<void>;

  createExtendsEdge(
    childName: string,
    childFile: string,
    parentName: string,
    parentFile?: string
  ): Promise<void>;

  createImplementsEdge(
    className: string,
    classFile: string,
    interfaceName: string,
    interfaceFile?: string
  ): Promise<void>;

  createRendersEdge(
    parentName: string,
    parentFile: string,
    childName: string,
    line: number
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

  /**
   * Smart file removal (PERF.4) — removes file and its entities while
   * preserving incoming cross-file edges (CALLS, EXTENDS, IMPLEMENTS).
   * Entities with incoming edges from other files are kept as external references.
   */
  removeFileAndCleanup(filePath: string): Promise<void>;

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
    nodeType: 'File' | 'Function' | 'Class' | 'Interface' | 'Variable' | 'Type' | 'Component';
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
    nodeType: 'File' | 'Function' | 'Class' | 'Interface' | 'Variable' | 'Type' | 'Component',
    identifier: Record<string, unknown>,
    embedding: number[],
    embeddingTextHash: string,
  ): Promise<void>;

  /** Vector similarity search across a specific node type */
  searchByVector(
    nodeType: 'File' | 'Function' | 'Class' | 'Interface' | 'Variable' | 'Type' | 'Component',
    embedding: number[],
    limit?: number,
  ): Promise<VectorSearchResult[]>;
}

/** Result from vector similarity search */
export interface VectorSearchResult {
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
    line: number
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_CALLS_EDGE, {
      params: { callerName, callerFile, calleeName, calleeFile, line },
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
  async createExtendsEdge(
    childName: string,
    childFile: string,
    parentName: string,
    parentFile?: string
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_EXTENDS_EDGE, {
      params: { childName, childFile, parentName, parentFile: parentFile ?? null },
    });
  }

  @trace()
  async createImplementsEdge(
    className: string,
    classFile: string,
    interfaceName: string,
    interfaceFile?: string
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_IMPLEMENTS_EDGE, {
      params: { className, classFile, interfaceName, interfaceFile: interfaceFile ?? null },
    });
  }

  @trace()
  async createRendersEdge(
    parentName: string,
    parentFile: string,
    childName: string,
    line: number
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_RENDERS_EDGE, {
      params: { parentName, parentFile, childName, line },
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
    await this.client.query(CYPHER.DELETE_FILE_ENTITIES, { params: { filePath } });
  }

  @trace()
  async removeFileAndCleanup(filePath: string): Promise<void> {
    // Step 1: Remove CONTAINS edges and the File node (without cascading to entities)
    await this.client.query(CYPHER.REMOVE_FILE_NODE, { params: { filePath } });

    // Step 2: Remove entities from this file that have NO incoming edges from other files
    // Entities with incoming cross-file edges (CALLS, EXTENDS, etc.) are preserved
    await this.client.query(CYPHER.CLEANUP_FILE_ORPHANS, { params: { filePath } });
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

    // Create edges in parallel (after entities exist)
    await Promise.all([
      // Call edges
      ...entities.callEdges.map((edge) => {
        const caller = parseEntityId(edge.callerId);
        const callee = parseEntityId(edge.calleeId);
        return this.createCallEdge(caller.name, caller.filePath, callee.name, callee.filePath, edge.line);
      }),
      // Import edges
      ...entities.importsEdges.map((edge) =>
        this.createImportsEdge(edge.fromFilePath, edge.toFilePath, edge.specifiers)
      ),
      // Extends edges (classes) - extract parent file from ID if present
      ...entities.extendsEdges.map((edge) => {
        const parent = parseEntityId(edge.parentId);
        const child = parseEntityId(edge.childId);
        return this.createExtendsEdge(child.name, child.filePath, resolvedName(parent), resolvedFilePath(parent));
      }),
      // Implements edges (class -> interface) - extract interface file from ID if present
      ...entities.implementsEdges.map((edge) => {
        const iface = parseEntityId(edge.interfaceId);
        const cls = parseEntityId(edge.classId);
        return this.createImplementsEdge(cls.name, cls.filePath, resolvedName(iface), resolvedFilePath(iface));
      }),
      // Renders edges (components)
      ...entities.rendersEdges.map((edge) => {
        const parent = parseEntityId(edge.parentId);
        const child = parseEntityId(edge.childId);
        return this.createRendersEdge(parent.name, parent.filePath, child.name, edge.line);
      }),
      // HAS_METHOD edges (class → method Function node)
      ...entities.hasMethodEdges.map((edge) =>
        this.createHasMethodEdge(edge.fromId, edge.toId, { isStatic: edge.isStatic, visibility: edge.visibility })
      ),
      // HAS_PROPERTY edges (class → property Variable node)
      ...entities.hasPropertyEdges.map((edge) =>
        this.createHasPropertyEdge(edge.fromId, edge.toId, { isStatic: edge.isStatic, visibility: edge.visibility, isReadonly: edge.isReadonly })
      ),
    ]);

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

    // Collect and batch all edges
    const callEdges = entitiesList.flatMap(e =>
      e.callEdges.map(edge => {
        const caller = parseEntityId(edge.callerId);
        const callee = parseEntityId(edge.calleeId);
        return { callerName: caller.name, callerFile: caller.filePath, calleeName: callee.name, calleeFile: callee.filePath, line: edge.line };
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
        const parent = parseEntityId(edge.parentId);
        const child = parseEntityId(edge.childId);
        return { childName: child.name, childFile: child.filePath, parentName: resolvedName(parent), parentFile: resolvedFilePath(parent) ?? null };
      }),
    );
    const implementsEdges = entitiesList.flatMap(e =>
      e.implementsEdges.map(edge => {
        const iface = parseEntityId(edge.interfaceId);
        const cls = parseEntityId(edge.classId);
        return { className: cls.name, classFile: cls.filePath, interfaceName: resolvedName(iface), interfaceFile: resolvedFilePath(iface) ?? null };
      }),
    );
    const rendersEdges = entitiesList.flatMap(e =>
      e.rendersEdges.map(edge => {
        const parent = parseEntityId(edge.parentId);
        const child = parseEntityId(edge.childId);
        return { parentName: parent.name, parentFile: parent.filePath, childName: child.name, line: edge.line };
      }),
    );

    // Create edges individually to avoid FalkorDB UNWIND+MATCH crash (Record_GetType segfault)
    const safeEdge = async (cypher: string, params: Record<string, unknown>): Promise<void> => {
      try { await this.client.query(cypher, { params: params as QueryParams }); } catch { /* skip missing endpoints */ }
    };
    for (const e of callEdges) {
      await safeEdge(
        `MATCH (caller:Function {name: $callerName, filePath: $callerFile})
         MATCH (callee:Function {name: $calleeName, filePath: $calleeFile})
         MERGE (caller)-[c:CALLS]->(callee) ON CREATE SET c.line = $line, c.count = 1 ON MATCH SET c.count = c.count + 1`,
        e,
      );
    }
    for (const e of importEdges) {
      await safeEdge(
        `MATCH (from:File {filePath: $fromPath})
         MERGE (to:File {filePath: $toPath}) ON CREATE SET to:External
         MERGE (from)-[i:IMPORTS]->(to) SET i.specifiers = $specifiers`,
        e,
      );
    }
    for (const e of extendsEdges) {
      await safeEdge(
        `MATCH (child:Class {name: $childName, filePath: $childFile})
         MERGE (parent:Class {name: $parentName, filePath: COALESCE($parentFile, 'external')}) ON CREATE SET parent:External
         MERGE (child)-[ex:EXTENDS]->(parent)`,
        e,
      );
    }
    for (const e of implementsEdges) {
      await safeEdge(
        `MATCH (c:Class {name: $className, filePath: $classFile})
         MERGE (i:Interface {name: $interfaceName, filePath: COALESCE($interfaceFile, 'external')}) ON CREATE SET i:External
         MERGE (c)-[impl:IMPLEMENTS]->(i)`,
        e,
      );
    }
    for (const e of rendersEdges) {
      await safeEdge(
        `MATCH (parent:Component {name: $parentName, filePath: $parentFile})
         MATCH (child:Component {name: $childName})
         MERGE (parent)-[r:RENDERS]->(child) SET r.line = $line`,
        e,
      );
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

    // Type ref nodes must exist before type-relationship edges are MERGE'd.
    const typeRefs = entitiesList.flatMap(e => e.typeRefs);
    for (const t of typeRefs) {
      await safeEdge(
        `MERGE (t:Type {id: $id})
         SET t.name = $name, t.language = $language, t.isPrimitive = $isPrimitive,
             t.definingFile = coalesce($definingFile, t.definingFile)`,
        { id: t.id, name: t.name, language: t.language, isPrimitive: t.isPrimitive, definingFile: t.definingFile ?? null },
      );
    }

    // HAS_PARAM edges (function → parameter type node)
    const hasParamEdges: HasParamEdgeDescriptor[] = entitiesList.flatMap(e => e.hasParamEdges);
    for (const e of hasParamEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:Type {id: $toId})
         MERGE (from)-[r:HAS_PARAM]->(to)
         SET r.position = $position, r.name = $name, r.isOptional = $isOptional`,
        { fromId: e.fromId, toId: e.toId, position: e.position, name: e.name, isOptional: e.isOptional },
      );
    }

    // RETURNS edges (function → return type node)
    const returnsEdges: ReturnsEdgeDescriptor[] = entitiesList.flatMap(e => e.returnsEdges);
    for (const e of returnsEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:Type {id: $toId})
         MERGE (from)-[r:RETURNS]->(to)
         SET r.isAsync = $isAsync`,
        { fromId: e.fromId, toId: e.toId, isAsync: e.isAsync },
      );
    }

    // USES_TYPE edges (function → type used in body)
    const usesTypeEdges: UsesTypeEdgeDescriptor[] = entitiesList.flatMap(e => e.usesTypeEdges);
    for (const e of usesTypeEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:Type {id: $toId})
         MERGE (from)-[r:USES_TYPE]->(to)
         SET r.kind = $kind`,
        { fromId: e.fromId, toId: e.toId, kind: e.kind },
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
        const caller = parseEntityId(edge.callerId);
        const callee = parseEntityId(edge.calleeId);
        return { callerName: caller.name, callerFile: caller.filePath, calleeName: callee.name, calleeFile: callee.filePath, line: edge.line };
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
        const parent = parseEntityId(edge.parentId);
        const child = parseEntityId(edge.childId);
        return { childName: child.name, childFile: child.filePath, parentName: resolvedName(parent), parentFile: resolvedFilePath(parent) ?? null };
      }),
    );
    const implementsEdges = entitiesList.flatMap(e =>
      e.implementsEdges.map(edge => {
        const iface = parseEntityId(edge.interfaceId);
        const cls = parseEntityId(edge.classId);
        return { className: cls.name, classFile: cls.filePath, interfaceName: resolvedName(iface), interfaceFile: resolvedFilePath(iface) ?? null };
      }),
    );
    const rendersEdges = entitiesList.flatMap(e =>
      e.rendersEdges.map(edge => {
        const parent = parseEntityId(edge.parentId);
        const child = parseEntityId(edge.childId);
        return { parentName: parent.name, parentFile: parent.filePath, childName: child.name, line: edge.line };
      }),
    );

    // Create edges individually to avoid FalkorDB UNWIND+MATCH crash (Record_GetType segfault).
    // This is slower but stable. FalkorDB crashes on UNWIND+MATCH edge queries on arm64.
    const safeEdge = async (cypher: string, params: Record<string, unknown>): Promise<void> => {
      try { await this.client.query(cypher, { params: params as QueryParams }); } catch { /* skip missing endpoints */ }
    };
    for (const e of callEdges) {
      await safeEdge(
        `MATCH (caller:Function {name: $callerName, filePath: $callerFile})
         MATCH (callee:Function {name: $calleeName, filePath: $calleeFile})
         MERGE (caller)-[c:CALLS]->(callee) ON CREATE SET c.line = $line, c.count = 1 ON MATCH SET c.count = c.count + 1`,
        e,
      );
    }
    for (const e of importEdges) {
      await safeEdge(
        `MATCH (from:File {filePath: $fromPath})
         MERGE (to:File {filePath: $toPath}) ON CREATE SET to:External
         MERGE (from)-[i:IMPORTS]->(to) SET i.specifiers = $specifiers`,
        e,
      );
    }
    for (const e of extendsEdges) {
      await safeEdge(
        `MATCH (child:Class {name: $childName, filePath: $childFile})
         MERGE (parent:Class {name: $parentName, filePath: COALESCE($parentFile, 'external')}) ON CREATE SET parent:External
         MERGE (child)-[ex:EXTENDS]->(parent)`,
        e,
      );
    }
    for (const e of implementsEdges) {
      await safeEdge(
        `MATCH (c:Class {name: $className, filePath: $classFile})
         MERGE (i:Interface {name: $interfaceName, filePath: COALESCE($interfaceFile, 'external')}) ON CREATE SET i:External
         MERGE (c)-[impl:IMPLEMENTS]->(i)`,
        e,
      );
    }
    for (const e of rendersEdges) {
      await safeEdge(
        `MATCH (parent:Component {name: $parentName, filePath: $parentFile})
         MATCH (child:Component {name: $childName})
         MERGE (parent)-[r:RENDERS]->(child) SET r.line = $line`,
        e,
      );
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

    // Type ref nodes must exist before type-relationship edges are MERGE'd.
    const typeRefs = entitiesList.flatMap(e => e.typeRefs);
    for (const t of typeRefs) {
      await safeEdge(
        `MERGE (t:Type {id: $id})
         SET t.name = $name, t.language = $language, t.isPrimitive = $isPrimitive,
             t.definingFile = coalesce($definingFile, t.definingFile)`,
        { id: t.id, name: t.name, language: t.language, isPrimitive: t.isPrimitive, definingFile: t.definingFile ?? null },
      );
    }

    // HAS_PARAM edges (function → parameter type node)
    const hasParamEdges: HasParamEdgeDescriptor[] = entitiesList.flatMap(e => e.hasParamEdges);
    for (const e of hasParamEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:Type {id: $toId})
         MERGE (from)-[r:HAS_PARAM]->(to)
         SET r.position = $position, r.name = $name, r.isOptional = $isOptional`,
        { fromId: e.fromId, toId: e.toId, position: e.position, name: e.name, isOptional: e.isOptional },
      );
    }

    // RETURNS edges (function → return type node)
    const returnsEdges: ReturnsEdgeDescriptor[] = entitiesList.flatMap(e => e.returnsEdges);
    for (const e of returnsEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:Type {id: $toId})
         MERGE (from)-[r:RETURNS]->(to)
         SET r.isAsync = $isAsync`,
        { fromId: e.fromId, toId: e.toId, isAsync: e.isAsync },
      );
    }

    // USES_TYPE edges (function → type used in body)
    const usesTypeEdges: UsesTypeEdgeDescriptor[] = entitiesList.flatMap(e => e.usesTypeEdges);
    for (const e of usesTypeEdges) {
      await safeEdge(
        `MATCH (from:Function {id: $fromId}), (to:Type {id: $toId})
         MERGE (from)-[r:USES_TYPE]->(to)
         SET r.kind = $kind`,
        { fromId: e.fromId, toId: e.toId, kind: e.kind },
      );
    }
  }

  @trace()
  async linkProjectFiles(projectId: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    const items = filePaths.map(fp => ({ projectId, filePath: fp }));
    await this.client.query(CYPHER.BATCH_LINK_PROJECT_FILES, { params: { items } });
  }

  @trace()
  async batchUpsertDocuments(docsList: ExtractedDocumentEntities[]): Promise<void> {
    if (docsList.length === 0) return;

    // Collect all document entities by type
    const documents = docsList.map(d => markdownDocumentToNodeProps(d.document));
    const sections = docsList.flatMap(d => d.sections.map(s => sectionToNodeProps(s)));
    const codeBlocks = docsList.flatMap(d => d.codeBlocks.map(cb => codeBlockToNodeProps(cb)));
    const links = docsList.flatMap(d => d.links.map(l => linkToNodeProps(l)));

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
  }

  @trace()
  async batchUpdateEmbeddings(items: Array<{
    nodeType: 'File' | 'Function' | 'Class' | 'Interface' | 'Variable' | 'Type' | 'Component';
    identifier: Record<string, unknown>;
    embedding: number[];
    embeddingTextHash: string;
  }>): Promise<number> {
    if (items.length === 0) return 0;

    // Group items by node type
    const byType = new Map<string, Array<Record<string, unknown>>>();
    for (const item of items) {
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

    // Build a map of "nodeType:name:filePath:startLine" → embeddingTextHash
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
            if (entity.hash) {
              hashMap.set(`${entity.nodeType}:${entity.name}:${entity.filePath}:${entity.startLine}`, entity.hash);
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
    nodeType: 'File' | 'Function' | 'Class' | 'Interface' | 'Variable' | 'Type' | 'Component',
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

    // FalkorDB uses natural keys (name + filePath + startLine/line)
    const templates: Record<string, string> = {
      Function: CYPHER.UPDATE_FUNCTION_EMBEDDING,
      Class: CYPHER.UPDATE_CLASS_EMBEDDING,
      Interface: CYPHER.UPDATE_INTERFACE_EMBEDDING,
      Variable: CYPHER.UPDATE_VARIABLE_EMBEDDING,
      Type: CYPHER.UPDATE_TYPE_EMBEDDING,
      Component: CYPHER.UPDATE_COMPONENT_EMBEDDING,
    };
    await this.client.query(templates[nodeType]!, { params: { ...baseParams, ...identifier } });
  }

  // --- Vector Search ---

  @trace()
  async searchByVector(
    nodeType: 'File' | 'Function' | 'Class' | 'Interface' | 'Variable' | 'Type' | 'Component',
    embedding: number[],
    limit: number = 10,
  ): Promise<VectorSearchResult[]> {
    // Validate nodeType against allowlist — Cypher doesn't support parameterized labels
    const VALID_NODE_TYPES = new Set(['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component']);
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
      RETURN node.name AS name, ${filePathExpr} AS filePath${startLineReturn}, score,
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

    try {
      const result = await this.client.roQuery<Record<string, unknown>>(cypher, {
        params: { queryVec: embedding, k: limit },
      });

      return result.data.map((row) => {
        const entry: VectorSearchResult = {
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
    } catch {
      // If vector index doesn't exist or has no data, return empty
      return [];
    }
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
