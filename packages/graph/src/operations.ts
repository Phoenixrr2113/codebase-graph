/**
 * @codegraph/graph - CRUD Operations
 * Graph database operations for entities and edges
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
  generatePrimaryKey,
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
import type { ProjectEntity } from '@codegraph/types';

// ============================================================================
// Cypher Query Templates — FalkorDB (default)
// ============================================================================

const CYPHER = {
  // File operations
  UPSERT_FILE: `
    MERGE (f:File {path: $path})
    SET f.name = $name,
        f.extension = $extension,
        f.loc = $loc,
        f.lastModified = $lastModified,
        f.hash = $hash
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
        fn.complexity = $complexity,
        fn.cognitiveComplexity = $cognitiveComplexity,
        fn.nestingDepth = $nestingDepth
    WITH fn
    MATCH (f:File {path: $filePath})
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
        c.docstring = $docstring
    WITH c
    MATCH (f:File {path: $filePath})
    MERGE (f)-[:CONTAINS]->(c)
    RETURN c
  `,

  // Interface operations - creates CONTAINS edge to File
  UPSERT_INTERFACE: `
    MERGE (i:Interface {name: $name, filePath: $filePath, startLine: $startLine})
    SET i.endLine = $endLine,
        i.isExported = $isExported,
        i.extends = $extends,
        i.docstring = $docstring
    WITH i
    MATCH (f:File {path: $filePath})
    MERGE (f)-[:CONTAINS]->(i)
    RETURN i
  `,

  // Variable operations - creates CONTAINS edge to File
  UPSERT_VARIABLE: `
    MERGE (v:Variable {name: $name, filePath: $filePath, line: $line})
    SET v.kind = $kind,
        v.isExported = $isExported,
        v.type = $type
    WITH v
    MATCH (f:File {path: $filePath})
    MERGE (f)-[:CONTAINS]->(v)
    RETURN v
  `,

  // Type operations - creates CONTAINS edge to File
  UPSERT_TYPE: `
    MERGE (t:Type {name: $name, filePath: $filePath, startLine: $startLine})
    SET t.endLine = $endLine,
        t.isExported = $isExported,
        t.kind = $kind,
        t.docstring = $docstring
    WITH t
    MATCH (f:File {path: $filePath})
    MERGE (f)-[:CONTAINS]->(t)
    RETURN t
  `,

  // Component operations - creates CONTAINS edge to File
  UPSERT_COMPONENT: `
    MERGE (comp:Component {name: $name, filePath: $filePath, startLine: $startLine})
    SET comp.endLine = $endLine,
        comp.isExported = $isExported,
        comp.props = $props,
        comp.propsType = $propsType
    WITH comp
    MATCH (f:File {path: $filePath})
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
    MATCH (from:File {path: $fromPath})
    MERGE (to:File {path: $toPath})
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

  // Commit operations
  UPSERT_COMMIT: `
    MERGE (c:Commit {hash: $hash})
    SET c.message = $message,
        c.author = $author,
        c.email = $email,
        c.date = $date
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
    MATCH (f:File {path: $filePath})
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

  // Dataflow edge operations
  CREATE_READS_EDGE: `
    MATCH (fn:Function {name: $functionName, filePath: $functionFile})
    MATCH (v:Variable {name: $variableName, filePath: $variableFile})
    MERGE (fn)-[r:READS]->(v)
    SET r.line = $line
    RETURN r
  `,

  CREATE_WRITES_EDGE: `
    MATCH (fn:Function {name: $functionName, filePath: $functionFile})
    MATCH (v:Variable {name: $variableName, filePath: $variableFile})
    MERGE (fn)-[r:WRITES]->(v)
    SET r.line = $line
    RETURN r
  `,

  CREATE_FLOWS_TO_EDGE: `
    MATCH (source) WHERE id(source) = $sourceId
    MATCH (target) WHERE id(target) = $targetId
    MERGE (source)-[r:FLOWS_TO]->(target)
    SET r.transformation = $transformation,
        r.tainted = $tainted,
        r.sanitized = $sanitized
    RETURN r
  `,

  CREATE_FLOWS_TO_EDGE_BY_NAME: `
    MATCH (source {name: $sourceName, filePath: $sourceFile})
    MATCH (target {name: $targetName, filePath: $targetFile})
    MERGE (source)-[r:FLOWS_TO]->(target)
    SET r.transformation = $transformation,
        r.tainted = $tainted,
        r.sanitized = $sanitized
    RETURN r
  `,

  // Export edge operations
  CREATE_EXPORTS_EDGE: `
    MATCH (f:File {path: $filePath})
    MATCH (symbol {name: $symbolName, filePath: $filePath})
    MERGE (f)-[r:EXPORTS]->(symbol)
    SET r.asName = $asName,
        r.isDefault = $isDefault
    RETURN r
  `,

  GET_FILE_EXPORTS: `
    MATCH (f:File {path: $filePath})-[r:EXPORTS]->(symbol)
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
    MATCH (f:File {path: $path})-[:CONTAINS]->(e)
    DETACH DELETE e
    WITH f
    DETACH DELETE f
  `,

  // Count nodes for a file
  COUNT_FILE_ENTITIES: `
    MATCH (f:File {path: $path})-[:CONTAINS]->(e)
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
        p.fileCount = $fileCount
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
    MATCH (f:File {path: $filePath})
    MERGE (p)-[:HAS_FILE]->(f)
  `,
};

// ============================================================================
// Kuzu-specific Cypher Templates (overrides where dialect differs)
// ============================================================================

const KUZU_CYPHER = {
  UPSERT_FUNCTION: `
    MERGE (fn:Function {_pk: $pk})
    SET fn.name = $name,
        fn.filePath = $filePath,
        fn.startLine = $startLine,
        fn.endLine = $endLine,
        fn.isExported = $isExported,
        fn.isAsync = $isAsync,
        fn.isArrow = $isArrow,
        fn.params = $params,
        fn.returnType = $returnType,
        fn.docstring = $docstring,
        fn.complexity = $complexity,
        fn.cognitiveComplexity = $cognitiveComplexity,
        fn.nestingDepth = $nestingDepth
    RETURN fn
  `,

  UPSERT_FUNCTION_CONTAINS: `
    MATCH (f:File {path: $filePath})
    MATCH (fn:Function {_pk: $pk})
    MERGE (f)-[:CONTAINS]->(fn)
  `,

  UPSERT_CLASS: `
    MERGE (c:Class {_pk: $pk})
    SET c.name = $name,
        c.filePath = $filePath,
        c.startLine = $startLine,
        c.endLine = $endLine,
        c.isExported = $isExported,
        c.isAbstract = $isAbstract,
        c.extends = $extends,
        c.implements = $implements,
        c.docstring = $docstring
    RETURN c
  `,

  UPSERT_CLASS_CONTAINS: `
    MATCH (f:File {path: $filePath})
    MATCH (c:Class {_pk: $pk})
    MERGE (f)-[:CONTAINS]->(c)
  `,

  UPSERT_INTERFACE: `
    MERGE (i:Interface {_pk: $pk})
    SET i.name = $name,
        i.filePath = $filePath,
        i.startLine = $startLine,
        i.endLine = $endLine,
        i.isExported = $isExported,
        i.extends = $extends,
        i.docstring = $docstring
    RETURN i
  `,

  UPSERT_INTERFACE_CONTAINS: `
    MATCH (f:File {path: $filePath})
    MATCH (i:Interface {_pk: $pk})
    MERGE (f)-[:CONTAINS]->(i)
  `,

  UPSERT_VARIABLE: `
    MERGE (v:Variable {_pk: $pk})
    SET v.name = $name,
        v.filePath = $filePath,
        v.line = $line,
        v.kind = $kind,
        v.isExported = $isExported,
        v.type = $type
    RETURN v
  `,

  UPSERT_VARIABLE_CONTAINS: `
    MATCH (f:File {path: $filePath})
    MATCH (v:Variable {_pk: $pk})
    MERGE (f)-[:CONTAINS]->(v)
  `,

  UPSERT_TYPE: `
    MERGE (t:Type {_pk: $pk})
    SET t.name = $name,
        t.filePath = $filePath,
        t.startLine = $startLine,
        t.endLine = $endLine,
        t.isExported = $isExported,
        t.kind = $kind,
        t.docstring = $docstring
    RETURN t
  `,

  UPSERT_TYPE_CONTAINS: `
    MATCH (f:File {path: $filePath})
    MATCH (t:Type {_pk: $pk})
    MERGE (f)-[:CONTAINS]->(t)
  `,

  UPSERT_COMPONENT: `
    MERGE (comp:Component {_pk: $pk})
    SET comp.name = $name,
        comp.filePath = $filePath,
        comp.startLine = $startLine,
        comp.endLine = $endLine,
        comp.isExported = $isExported,
        comp.props = $props,
        comp.propsType = $propsType
    RETURN comp
  `,

  UPSERT_COMPONENT_CONTAINS: `
    MATCH (f:File {path: $filePath})
    MATCH (comp:Component {_pk: $pk})
    MERGE (f)-[:CONTAINS]->(comp)
  `,

  // CALLS edge: no ON CREATE/MATCH SET
  CREATE_CALLS_EDGE: `
    MATCH (caller:Function) WHERE caller.name = $callerName AND caller.filePath = $callerFile
    MATCH (callee:Function) WHERE callee.name = $calleeName AND callee.filePath = $calleeFile
    MERGE (caller)-[c:CALLS]->(callee)
    SET c.line = $line, c.count = COALESCE(c.count, 0) + 1
    RETURN c
  `,

  // IMPORTS: no ON CREATE SET label; just MERGE the edge
  CREATE_IMPORTS_EDGE: `
    MATCH (from:File {path: $fromPath})
    MATCH (to:File {path: $toPath})
    MERGE (from)-[i:IMPORTS]->(to)
    SET i.specifiers = $specifiers
    RETURN i
  `,

  // For external imports where the target File doesn't exist yet
  CREATE_IMPORTS_EDGE_EXTERNAL: `
    MATCH (from:File {path: $fromPath})
    MERGE (to:External {_pk: $toPath})
    SET to.name = $toPath, to.filePath = $toPath
    WITH from, to
    MERGE (from)-[i:IMPORTS]->(to)
    SET i.specifiers = $specifiers
    RETURN i
  `,

  // EXTENDS: match child, merge parent (may be external)
  CREATE_EXTENDS_EDGE: `
    MATCH (child:Class) WHERE child.name = $childName AND child.filePath = $childFile
    MATCH (parent:Class) WHERE parent.name = $parentName AND parent.filePath = COALESCE($parentFile, 'external')
    MERGE (child)-[e:EXTENDS]->(parent)
    RETURN e
  `,

  CREATE_EXTENDS_EDGE_EXTERNAL: `
    MATCH (child:Class) WHERE child.name = $childName AND child.filePath = $childFile
    MERGE (parent:External {_pk: $parentPk})
    SET parent.name = $parentName, parent.filePath = 'external'
    WITH child, parent
    MERGE (child)-[e:EXTENDS]->(parent)
    RETURN e
  `,

  // IMPLEMENTS: match class, merge interface (may be external)
  CREATE_IMPLEMENTS_EDGE: `
    MATCH (c:Class) WHERE c.name = $className AND c.filePath = $classFile
    MATCH (i:Interface) WHERE i.name = $interfaceName AND i.filePath = COALESCE($interfaceFile, 'external')
    MERGE (c)-[impl:IMPLEMENTS]->(i)
    RETURN impl
  `,

  CREATE_IMPLEMENTS_EDGE_EXTERNAL: `
    MATCH (c:Class) WHERE c.name = $className AND c.filePath = $classFile
    MERGE (i:External {_pk: $interfacePk})
    SET i.name = $interfaceName, i.filePath = 'external'
    WITH c, i
    MERGE (c)-[impl:IMPLEMENTS]->(i)
    RETURN impl
  `,

  // RENDERS
  CREATE_RENDERS_EDGE: `
    MATCH (parent:Component) WHERE parent.name = $parentName AND parent.filePath = $parentFile
    MATCH (child:Component) WHERE child.name = $childName
    MERGE (parent)-[r:RENDERS]->(child)
    SET r.line = $line
    RETURN r
  `,

  // INSTANTIATES: match function, merge class (may be external)
  CREATE_INSTANTIATES_EDGE: `
    MATCH (fn:Function) WHERE fn.name = $functionName AND fn.filePath = $functionFile
    MATCH (c:Class) WHERE c.name = $className AND c.filePath = COALESCE($classFile, 'external')
    MERGE (fn)-[r:INSTANTIATES]->(c)
    SET r.line = $line
    RETURN r
  `,

  CREATE_INSTANTIATES_EDGE_EXTERNAL: `
    MATCH (fn:Function) WHERE fn.name = $functionName AND fn.filePath = $functionFile
    MERGE (c:External {_pk: $classPk})
    SET c.name = $className, c.filePath = 'external'
    WITH fn, c
    MERGE (fn)-[r:INSTANTIATES]->(c)
    SET r.line = $line
    RETURN r
  `,

  // READS / WRITES — match by name+filePath
  CREATE_READS_EDGE: `
    MATCH (fn:Function) WHERE fn.name = $functionName AND fn.filePath = $functionFile
    MATCH (v:Variable) WHERE v.name = $variableName AND v.filePath = $variableFile
    MERGE (fn)-[r:READS]->(v)
    SET r.line = $line
    RETURN r
  `,

  CREATE_WRITES_EDGE: `
    MATCH (fn:Function) WHERE fn.name = $functionName AND fn.filePath = $functionFile
    MATCH (v:Variable) WHERE v.name = $variableName AND v.filePath = $variableFile
    MERGE (fn)-[r:WRITES]->(v)
    SET r.line = $line
    RETURN r
  `,

  // FLOWS_TO — property-based lookup instead of id()
  CREATE_FLOWS_TO_EDGE_BY_NAME: `
    MATCH (source) WHERE source.name = $sourceName AND source.filePath = $sourceFile
    MATCH (target) WHERE target.name = $targetName AND target.filePath = $targetFile
    MERGE (source)-[r:FLOWS_TO]->(target)
    SET r.transformation = $transformation,
        r.tainted = $tainted,
        r.sanitized = $sanitized
    RETURN r
  `,

  // EXPORTS — Kuzu requires labeled MATCH; try each entity type in operations code
  CREATE_EXPORTS_EDGE_FN: `
    MATCH (f:File {path: $filePath})
    MATCH (symbol:Function) WHERE symbol.name = $symbolName AND symbol.filePath = $filePath
    MERGE (f)-[r:EXPORTS]->(symbol)
    SET r.asName = $asName, r.isDefault = $isDefault
    RETURN r
  `,
  CREATE_EXPORTS_EDGE_CLASS: `
    MATCH (f:File {path: $filePath})
    MATCH (symbol:Class) WHERE symbol.name = $symbolName AND symbol.filePath = $filePath
    MERGE (f)-[r:EXPORTS]->(symbol)
    SET r.asName = $asName, r.isDefault = $isDefault
    RETURN r
  `,
  CREATE_EXPORTS_EDGE_IFACE: `
    MATCH (f:File {path: $filePath})
    MATCH (symbol:Interface) WHERE symbol.name = $symbolName AND symbol.filePath = $filePath
    MERGE (f)-[r:EXPORTS]->(symbol)
    SET r.asName = $asName, r.isDefault = $isDefault
    RETURN r
  `,
  CREATE_EXPORTS_EDGE_VAR: `
    MATCH (f:File {path: $filePath})
    MATCH (symbol:Variable) WHERE symbol.name = $symbolName AND symbol.filePath = $filePath
    MERGE (f)-[r:EXPORTS]->(symbol)
    SET r.asName = $asName, r.isDefault = $isDefault
    RETURN r
  `,
  CREATE_EXPORTS_EDGE_TYPE: `
    MATCH (f:File {path: $filePath})
    MATCH (symbol:Type) WHERE symbol.name = $symbolName AND symbol.filePath = $filePath
    MERGE (f)-[r:EXPORTS]->(symbol)
    SET r.asName = $asName, r.isDefault = $isDefault
    RETURN r
  `,
  CREATE_EXPORTS_EDGE_COMP: `
    MATCH (f:File {path: $filePath})
    MATCH (symbol:Component) WHERE symbol.name = $symbolName AND symbol.filePath = $filePath
    MERGE (f)-[r:EXPORTS]->(symbol)
    SET r.asName = $asName, r.isDefault = $isDefault
    RETURN r
  `,

  // GET_FILE_EXPORTS — Kuzu uses label() instead of labels()[0]
  GET_FILE_EXPORTS: `
    MATCH (f:File {path: $filePath})-[r:EXPORTS]->(symbol)
    RETURN symbol.name as name, label(symbol) as type, r.asName as asName, r.isDefault as isDefault
  `,

  // DELETE — Kuzu may need separate delete steps
  DELETE_FILE_ENTITIES: `
    MATCH (f:File {path: $path})-[:CONTAINS]->(e)
    DETACH DELETE e
  `,

  DELETE_FILE_NODE: `
    MATCH (f:File {path: $path})
    DETACH DELETE f
  `,

  // DELETE PROJECT — simpler cascade for Kuzu
  DELETE_PROJECT_ENTITIES: `
    MATCH (p:Project {id: $id})-[:HAS_FILE]->(f:File)-[:CONTAINS]->(e)
    DETACH DELETE e
  `,

  DELETE_PROJECT_FILES: `
    MATCH (p:Project {id: $id})-[:HAS_FILE]->(f:File)
    DETACH DELETE f
  `,

  DELETE_PROJECT_NODE: `
    MATCH (p:Project {id: $id})
    DETACH DELETE p
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

  deleteFileEntities(filePath: string): Promise<void>;

  clearAll(): Promise<void>;

  batchUpsert(entities: ParsedFileEntities): Promise<void>;

  // Project operations
  upsertProject(project: ProjectEntity): Promise<void>;
  getProjects(): Promise<ProjectEntity[]>;
  getProjectByRoot(rootPath: string): Promise<ProjectEntity | null>;
  deleteProject(projectId: string): Promise<void>;
  linkProjectFile(projectId: string, filePath: string): Promise<void>;

  // Commit operations
  upsertCommit(commit: CommitEntity): Promise<void>;
  createModifiedInEdge(
    filePath: string,
    commitHash: string,
    linesAdded?: number,
    linesRemoved?: number,
    complexityDelta?: number
  ): Promise<void>;
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
  private readonly driverType: 'falkordb' | 'kuzu';

  constructor(private readonly client: GraphClient) {
    this.dialect = client.dialect;
    this.driverType = this.dialect.driverType;
  }

  @trace()
  async upsertFile(file: FileEntity): Promise<void> {
    const props = fileToNodeProps(file);
    // File PK is `path` in both FalkorDB and Kuzu — same template works
    await this.client.query(CYPHER.UPSERT_FILE, { params: toParams(props) });
  }

  @trace()
  async upsertFunction(fn: FunctionEntity): Promise<void> {
    const props = functionToNodeProps(fn);
    if (this.driverType === 'kuzu') {
      const pk = generatePrimaryKey({ filePath: fn.filePath, name: fn.name, startLine: fn.startLine });
      await this.client.query(KUZU_CYPHER.UPSERT_FUNCTION, { params: { ...toParams(props), pk } });
      await this.client.query(KUZU_CYPHER.UPSERT_FUNCTION_CONTAINS, { params: { filePath: fn.filePath, pk } });
    } else {
      await this.client.query(CYPHER.UPSERT_FUNCTION, { params: toParams(props) });
    }
  }

  @trace()
  async upsertClass(cls: ClassEntity): Promise<void> {
    const props = classToNodeProps(cls);
    if (this.driverType === 'kuzu') {
      const pk = generatePrimaryKey({ filePath: cls.filePath, name: cls.name, startLine: cls.startLine });
      await this.client.query(KUZU_CYPHER.UPSERT_CLASS, { params: { ...toParams(props), pk } });
      await this.client.query(KUZU_CYPHER.UPSERT_CLASS_CONTAINS, { params: { filePath: cls.filePath, pk } });
    } else {
      await this.client.query(CYPHER.UPSERT_CLASS, { params: toParams(props) });
    }
  }

  @trace()
  async upsertInterface(iface: InterfaceEntity): Promise<void> {
    const props = interfaceToNodeProps(iface);
    if (this.driverType === 'kuzu') {
      const pk = generatePrimaryKey({ filePath: iface.filePath, name: iface.name, startLine: iface.startLine });
      await this.client.query(KUZU_CYPHER.UPSERT_INTERFACE, { params: { ...toParams(props), pk } });
      await this.client.query(KUZU_CYPHER.UPSERT_INTERFACE_CONTAINS, { params: { filePath: iface.filePath, pk } });
    } else {
      await this.client.query(CYPHER.UPSERT_INTERFACE, { params: toParams(props) });
    }
  }

  @trace()
  async upsertVariable(variable: VariableEntity): Promise<void> {
    const props = variableToNodeProps(variable);
    if (this.driverType === 'kuzu') {
      const pk = generatePrimaryKey({ filePath: variable.filePath, name: variable.name, line: variable.line });
      await this.client.query(KUZU_CYPHER.UPSERT_VARIABLE, { params: { ...toParams(props), pk } });
      await this.client.query(KUZU_CYPHER.UPSERT_VARIABLE_CONTAINS, { params: { filePath: variable.filePath, pk } });
    } else {
      await this.client.query(CYPHER.UPSERT_VARIABLE, { params: toParams(props) });
    }
  }

  @trace()
  async upsertType(type: TypeEntity): Promise<void> {
    const props = typeToNodeProps(type);
    if (this.driverType === 'kuzu') {
      const pk = generatePrimaryKey({ filePath: type.filePath, name: type.name, startLine: type.startLine });
      await this.client.query(KUZU_CYPHER.UPSERT_TYPE, { params: { ...toParams(props), pk } });
      await this.client.query(KUZU_CYPHER.UPSERT_TYPE_CONTAINS, { params: { filePath: type.filePath, pk } });
    } else {
      await this.client.query(CYPHER.UPSERT_TYPE, { params: toParams(props) });
    }
  }

  @trace()
  async upsertComponent(component: ComponentEntity): Promise<void> {
    const props = componentToNodeProps(component);
    if (this.driverType === 'kuzu') {
      const pk = generatePrimaryKey({ filePath: component.filePath, name: component.name, startLine: component.startLine });
      await this.client.query(KUZU_CYPHER.UPSERT_COMPONENT, { params: { ...toParams(props), pk } });
      await this.client.query(KUZU_CYPHER.UPSERT_COMPONENT_CONTAINS, { params: { filePath: component.filePath, pk } });
    } else {
      await this.client.query(CYPHER.UPSERT_COMPONENT, { params: toParams(props) });
    }
  }

  @trace()
  async createCallEdge(
    callerName: string,
    callerFile: string,
    calleeName: string,
    calleeFile: string,
    line: number
  ): Promise<void> {
    const cypher = this.driverType === 'kuzu' ? KUZU_CYPHER.CREATE_CALLS_EDGE : CYPHER.CREATE_CALLS_EDGE;
    await this.client.query(cypher, {
      params: { callerName, callerFile, calleeName, calleeFile, line },
    });
  }

  @trace()
  async createImportsEdge(
    fromPath: string,
    toPath: string,
    specifiers?: string[]
  ): Promise<void> {
    if (this.driverType === 'kuzu') {
      // Check if target file exists before choosing query
      const check = await this.client.roQuery<{ found: boolean }>(
        `MATCH (f:File {path: $path}) RETURN true as found LIMIT 1`,
        { params: { path: toPath } }
      );
      if (check.data.length > 0) {
        await this.client.query(KUZU_CYPHER.CREATE_IMPORTS_EDGE, {
          params: { fromPath, toPath, specifiers: specifiers ?? null },
        });
      } else {
        await this.client.query(KUZU_CYPHER.CREATE_IMPORTS_EDGE_EXTERNAL, {
          params: { fromPath, toPath, specifiers: specifiers ?? null },
        });
      }
    } else {
      await this.client.query(CYPHER.CREATE_IMPORTS_EDGE, {
        params: { fromPath, toPath, specifiers: specifiers ?? null },
      });
    }
  }

  @trace()
  async createExtendsEdge(
    childName: string,
    childFile: string,
    parentName: string,
    parentFile?: string
  ): Promise<void> {
    if (this.driverType === 'kuzu') {
      if (parentFile) {
        await this.client.query(KUZU_CYPHER.CREATE_EXTENDS_EDGE, {
          params: { childName, childFile, parentName, parentFile },
        });
      } else {
        const parentPk = `external:${parentName}:0`;
        await this.client.query(KUZU_CYPHER.CREATE_EXTENDS_EDGE_EXTERNAL, {
          params: { childName, childFile, parentName, parentPk },
        });
      }
    } else {
      await this.client.query(CYPHER.CREATE_EXTENDS_EDGE, {
        params: { childName, childFile, parentName, parentFile: parentFile ?? null },
      });
    }
  }

  @trace()
  async createImplementsEdge(
    className: string,
    classFile: string,
    interfaceName: string,
    interfaceFile?: string
  ): Promise<void> {
    if (this.driverType === 'kuzu') {
      if (interfaceFile) {
        await this.client.query(KUZU_CYPHER.CREATE_IMPLEMENTS_EDGE, {
          params: { className, classFile, interfaceName, interfaceFile },
        });
      } else {
        const interfacePk = `external:${interfaceName}:0`;
        await this.client.query(KUZU_CYPHER.CREATE_IMPLEMENTS_EDGE_EXTERNAL, {
          params: { className, classFile, interfaceName, interfacePk },
        });
      }
    } else {
      await this.client.query(CYPHER.CREATE_IMPLEMENTS_EDGE, {
        params: { className, classFile, interfaceName, interfaceFile: interfaceFile ?? null },
      });
    }
  }

  @trace()
  async createRendersEdge(
    parentName: string,
    parentFile: string,
    childName: string,
    line: number
  ): Promise<void> {
    const cypher = this.driverType === 'kuzu' ? KUZU_CYPHER.CREATE_RENDERS_EDGE : CYPHER.CREATE_RENDERS_EDGE;
    await this.client.query(cypher, {
      params: { parentName, parentFile, childName, line },
    });
  }

  @trace()
  async deleteFileEntities(filePath: string): Promise<void> {
    if (this.driverType === 'kuzu') {
      // Kuzu needs separate DELETE steps (no WITH between DETACH DELETE)
      try {
        await this.client.query(KUZU_CYPHER.DELETE_FILE_ENTITIES, { params: { path: filePath } });
      } catch (error) {
        // Swallow "no result" / empty match errors; re-throw connection/syntax errors
        const msg = error instanceof Error ? error.message : '';
        if (msg.includes('connect') || msg.includes('syntax') || msg.includes('Binder')) throw error;
      }
      await this.client.query(KUZU_CYPHER.DELETE_FILE_NODE, { params: { path: filePath } });
    } else {
      await this.client.query(CYPHER.DELETE_FILE_ENTITIES, { params: { path: filePath } });
    }
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
      ...entities.callEdges.map((edge) =>
        this.createCallEdge(
          edge.callerId.split(':')[2] ?? '',
          edge.callerId.split(':')[1] ?? '',
          edge.calleeId.split(':')[2] ?? '',
          edge.calleeId.split(':')[1] ?? '',
          edge.line
        )
      ),
      // Import edges
      ...entities.importsEdges.map((edge) =>
        this.createImportsEdge(edge.fromFilePath, edge.toFilePath, edge.specifiers)
      ),
      // Extends edges (classes) - extract parent file from ID if present
      ...entities.extendsEdges.map((edge) => {
        const parentParts = edge.parentId.split(':');
        const parentFile = parentParts[1] !== 'external' ? parentParts[1] : undefined;
        return this.createExtendsEdge(
          edge.childId.split(':')[2] ?? '',
          edge.childId.split(':')[1] ?? '',
          parentParts[2] ?? parentParts[1] ?? '', // name at index 2 or 1 for external
          parentFile
        );
      }),
      // Implements edges (class -> interface) - extract interface file from ID if present
      ...entities.implementsEdges.map((edge) => {
        const ifaceParts = edge.interfaceId.split(':');
        const ifaceFile = ifaceParts[1] !== 'external' ? ifaceParts[1] : undefined;
        return this.createImplementsEdge(
          edge.classId.split(':')[2] ?? '',
          edge.classId.split(':')[1] ?? '',
          ifaceParts[2] ?? ifaceParts[1] ?? '', // name at index 2 or 1 for external
          ifaceFile
        );
      }),
      // Renders edges (components)
      ...entities.rendersEdges.map((edge) =>
        this.createRendersEdge(
          edge.parentId.split(':')[2] ?? '',
          edge.parentId.split(':')[1] ?? '',
          edge.childId.split(':')[2] ?? '',
          edge.line
        )
      ),
    ]);
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
    if (this.driverType === 'kuzu') {
      // Kuzu needs cascading deletes in separate steps
      for (const cypher of [KUZU_CYPHER.DELETE_PROJECT_ENTITIES, KUZU_CYPHER.DELETE_PROJECT_FILES]) {
        try {
          await this.client.query(cypher, { params: { id: projectId } });
        } catch (error) {
          const msg = error instanceof Error ? error.message : '';
          if (msg.includes('connect') || msg.includes('syntax') || msg.includes('Binder')) throw error;
        }
      }
      await this.client.query(KUZU_CYPHER.DELETE_PROJECT_NODE, { params: { id: projectId } });
    } else {
      await this.client.query(CYPHER.DELETE_PROJECT, { params: { id: projectId } });
    }
  }

  @trace()
  async linkProjectFile(projectId: string, filePath: string): Promise<void> {
    await this.client.query(CYPHER.LINK_PROJECT_FILE, {
      params: { projectId, filePath },
    });
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

  private projectFromRow(row: Record<string, unknown>): ProjectEntity {
    // Handle FalkorDB nested properties format and Kuzu flat format
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
