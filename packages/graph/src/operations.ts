/**
 * @codegraph/graph - CRUD Operations
 * Graph database operations for entities and edges
 * Based on CodeGraph MVP Specification Section 6.2
 */

import type { GraphClient, QueryParams } from './client.js';
import { trace } from '@codegraph/logger';
import {
  fileToNodeProps,
  functionToNodeProps,
  classToNodeProps,
  interfaceToNodeProps,
  variableToNodeProps,
  typeToNodeProps,
  componentToNodeProps,
  type ParsedFileEntities,
  type FileEntity,
  type FunctionEntity,
  type ClassEntity,
  type InterfaceEntity,
  type VariableEntity,
  type TypeEntity,
  type ComponentEntity,
} from './schema.js';

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
        fn.docstring = $docstring
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
    MATCH (to:File {path: $toPath})
    MERGE (from)-[i:IMPORTS]->(to)
    SET i.specifiers = $specifiers
    RETURN i
  `,

  CREATE_EXTENDS_EDGE: `
    MATCH (child:Class {name: $childName, filePath: $childFile})
    MATCH (parent:Class {name: $parentName})
    MERGE (child)-[e:EXTENDS]->(parent)
    RETURN e
  `,

  CREATE_IMPLEMENTS_EDGE: `
    MATCH (c:Class {name: $className, filePath: $classFile})
    MATCH (i:Interface {name: $interfaceName})
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
    parentName: string
  ): Promise<void>;

  createImplementsEdge(
    className: string,
    classFile: string,
    interfaceName: string
  ): Promise<void>;

  createRendersEdge(
    parentName: string,
    parentFile: string,
    childName: string,
    line: number
  ): Promise<void>;

  deleteFileEntities(filePath: string): Promise<void>;
  
  batchUpsert(entities: ParsedFileEntities): Promise<void>;
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
    parentName: string
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_EXTENDS_EDGE, {
      params: { childName, childFile, parentName },
    });
  }

  @trace()
  async createImplementsEdge(
    className: string,
    classFile: string,
    interfaceName: string
  ): Promise<void> {
    await this.client.query(CYPHER.CREATE_IMPLEMENTS_EDGE, {
      params: { className, classFile, interfaceName },
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
      // Extends edges (classes)
      ...entities.extendsEdges.map((edge) =>
        this.createExtendsEdge(
          edge.childId.split(':')[2] ?? '',
          edge.childId.split(':')[1] ?? '',
          edge.parentId.split(':')[2] ?? ''
        )
      ),
      // Implements edges (class -> interface)
      ...entities.implementsEdges.map((edge) =>
        this.createImplementsEdge(
          edge.classId.split(':')[2] ?? '',
          edge.classId.split(':')[1] ?? '',
          edge.interfaceId.split(':')[2] ?? ''
        )
      ),
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
