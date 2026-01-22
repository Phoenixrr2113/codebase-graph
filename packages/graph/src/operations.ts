/**
 * @codegraph/graph - CRUD Operations
 * Graph database operations for entities and edges
 * Based on CodeGraph MVP Specification Section 6.2
 */

import type { GraphClient, QueryParams } from './client';
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
// Cypher Query Templates
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
  constructor(private readonly client: GraphClient) {}

  @trace()
  async upsertFile(file: FileEntity): Promise<void> {
    const props = fileToNodeProps(file);
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
  async deleteFileEntities(filePath: string): Promise<void> {
    await this.client.query(CYPHER.DELETE_FILE_ENTITIES, {
      params: { path: filePath },
    });
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
    await this.client.query(CYPHER.DELETE_PROJECT, {
      params: { id: projectId },
    });
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
    // Handle FalkorDB nested properties format
    const props = (row['properties'] ?? row) as Record<string, unknown>;
    const fileCount = props['fileCount'] as number | undefined;
    const entity: ProjectEntity = {
      id: props['id'] as string,
      name: props['name'] as string,
      rootPath: props['rootPath'] as string,
      createdAt: props['createdAt'] as string,
      lastParsed: props['lastParsed'] as string,
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
