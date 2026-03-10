/**
 * Kuzu Schema DDL — CREATE NODE TABLE / CREATE REL TABLE statements
 *
 * Key difference from FalkorDB: Kuzu requires explicit schema definition
 * with a single-column primary key per node table. Multi-key entities
 * use a synthetic `_pk` column = `"${filePath}:${name}:${startLine}"`.
 */

// ============================================================================
// Node Tables
// ============================================================================

export const NODE_TABLES = [
  // File — PK is the absolute path
  `CREATE NODE TABLE IF NOT EXISTS File (
    path STRING PRIMARY KEY,
    name STRING,
    extension STRING,
    loc INT64,
    lastModified STRING,
    hash STRING
  )`,

  // Function — synthetic PK: filePath:name:startLine
  `CREATE NODE TABLE IF NOT EXISTS Function (
    _pk STRING PRIMARY KEY,
    name STRING,
    filePath STRING,
    startLine INT64,
    endLine INT64,
    isExported BOOLEAN,
    isAsync BOOLEAN,
    isArrow BOOLEAN,
    params STRING,
    returnType STRING,
    docstring STRING,
    complexity INT64,
    cognitiveComplexity INT64,
    nestingDepth INT64
  )`,

  // Class — synthetic PK: filePath:name:startLine
  `CREATE NODE TABLE IF NOT EXISTS Class (
    _pk STRING PRIMARY KEY,
    name STRING,
    filePath STRING,
    startLine INT64,
    endLine INT64,
    isExported BOOLEAN,
    isAbstract BOOLEAN,
    extends STRING,
    implements STRING,
    docstring STRING
  )`,

  // Interface — synthetic PK: filePath:name:startLine
  `CREATE NODE TABLE IF NOT EXISTS Interface (
    _pk STRING PRIMARY KEY,
    name STRING,
    filePath STRING,
    startLine INT64,
    endLine INT64,
    isExported BOOLEAN,
    extends STRING,
    docstring STRING
  )`,

  // Variable — synthetic PK: filePath:name:line
  `CREATE NODE TABLE IF NOT EXISTS Variable (
    _pk STRING PRIMARY KEY,
    name STRING,
    filePath STRING,
    line INT64,
    kind STRING,
    isExported BOOLEAN,
    type STRING
  )`,

  // Type — synthetic PK: filePath:name:startLine
  `CREATE NODE TABLE IF NOT EXISTS Type (
    _pk STRING PRIMARY KEY,
    name STRING,
    filePath STRING,
    startLine INT64,
    endLine INT64,
    isExported BOOLEAN,
    kind STRING,
    docstring STRING
  )`,

  // Component — synthetic PK: filePath:name:startLine
  `CREATE NODE TABLE IF NOT EXISTS Component (
    _pk STRING PRIMARY KEY,
    name STRING,
    filePath STRING,
    startLine INT64,
    endLine INT64,
    isExported BOOLEAN,
    props STRING,
    propsType STRING
  )`,

  // Commit — PK is the hash
  `CREATE NODE TABLE IF NOT EXISTS Commit (
    hash STRING PRIMARY KEY,
    message STRING,
    author STRING,
    email STRING,
    date STRING
  )`,

  // Project — PK is the id
  `CREATE NODE TABLE IF NOT EXISTS Project (
    id STRING PRIMARY KEY,
    name STRING,
    rootPath STRING,
    createdAt STRING,
    lastParsed STRING,
    fileCount INT64
  )`,

  // External — used for unresolved references
  `CREATE NODE TABLE IF NOT EXISTS External (
    _pk STRING PRIMARY KEY,
    name STRING,
    filePath STRING,
    startLine INT64
  )`,

  // Metadata — generic key/value store for graph-level state (e.g. lastCommitSynced)
  `CREATE NODE TABLE IF NOT EXISTS Metadata (
    key STRING PRIMARY KEY,
    value STRING
  )`,
];

// ============================================================================
// Knowledge Graph Node Tables (NLC Merger)
// ============================================================================

export const KNOWLEDGE_NODE_TABLES = [
  // Entity — knowledge graph node (NLC's 28 entity types stored as `type` property)
  // Follows Graphiti pattern: generic node table, type as property
  `CREATE NODE TABLE IF NOT EXISTS Entity (
    id STRING PRIMARY KEY,
    text STRING,
    type STRING,
    confidence DOUBLE,
    embedding FLOAT[1536],
    createdAt INT64,
    lastAccessedAt INT64,
    accessCount INT64,
    relevanceScore DOUBLE,
    sampleIds STRING[],
    properties STRING
  )`,
];

// ============================================================================
// Code Graph Relationship Tables
// ============================================================================

export const REL_TABLES = [
  // File -[CONTAINS]-> Function|Class|Interface|Variable|Type|Component
  `CREATE REL TABLE IF NOT EXISTS CONTAINS (FROM File TO Function, FROM File TO Class, FROM File TO Interface, FROM File TO Variable, FROM File TO Type, FROM File TO Component)`,

  // Function -[CALLS]-> Function
  `CREATE REL TABLE IF NOT EXISTS CALLS (FROM Function TO Function, line INT64, count INT64)`,

  // File -[IMPORTS]-> File, File -[IMPORTS]-> External
  `CREATE REL TABLE IF NOT EXISTS IMPORTS (FROM File TO File, FROM File TO External, specifiers STRING)`,

  // Class -[EXTENDS]-> Class, Class -[EXTENDS]-> External
  `CREATE REL TABLE IF NOT EXISTS EXTENDS (FROM Class TO Class, FROM Class TO External)`,

  // Class -[IMPLEMENTS]-> Interface, Class -[IMPLEMENTS]-> External
  `CREATE REL TABLE IF NOT EXISTS IMPLEMENTS (FROM Class TO Interface, FROM Class TO External)`,

  // Component -[RENDERS]-> Component
  `CREATE REL TABLE IF NOT EXISTS RENDERS (FROM Component TO Component, line INT64)`,

  // Entity -[INTRODUCED_IN]-> Commit (multiple source types)
  `CREATE REL TABLE IF NOT EXISTS INTRODUCED_IN (FROM Function TO Commit, FROM Class TO Commit, FROM Interface TO Commit, FROM Variable TO Commit, FROM Type TO Commit, FROM Component TO Commit)`,

  // File -[MODIFIED_IN]-> Commit
  `CREATE REL TABLE IF NOT EXISTS MODIFIED_IN (FROM File TO Commit, linesAdded INT64, linesRemoved INT64, complexityDelta INT64)`,

  // Entity -[DELETED_IN]-> Commit
  `CREATE REL TABLE IF NOT EXISTS DELETED_IN (FROM Function TO Commit, FROM Class TO Commit, FROM Interface TO Commit, FROM Variable TO Commit, FROM Type TO Commit, FROM Component TO Commit)`,

  // Function -[READS]-> Variable
  `CREATE REL TABLE IF NOT EXISTS READS (FROM Function TO Variable, line INT64)`,

  // Function -[WRITES]-> Variable
  `CREATE REL TABLE IF NOT EXISTS WRITES (FROM Function TO Variable, line INT64)`,

  // FLOWS_TO — dataflow edges between various entity types
  `CREATE REL TABLE IF NOT EXISTS FLOWS_TO (FROM Function TO Function, FROM Function TO Variable, FROM Variable TO Function, FROM Variable TO Variable, transformation STRING, tainted BOOLEAN, sanitized BOOLEAN)`,

  // File -[EXPORTS]-> Function|Class|Interface|Variable|Type|Component
  `CREATE REL TABLE IF NOT EXISTS EXPORTS (FROM File TO Function, FROM File TO Class, FROM File TO Interface, FROM File TO Variable, FROM File TO Type, FROM File TO Component, asName STRING, isDefault BOOLEAN)`,

  // Function -[INSTANTIATES]-> Class, Function -[INSTANTIATES]-> External
  `CREATE REL TABLE IF NOT EXISTS INSTANTIATES (FROM Function TO Class, FROM Function TO External, line INT64)`,

  // Project -[HAS_FILE]-> File
  `CREATE REL TABLE IF NOT EXISTS HAS_FILE (FROM Project TO File)`,
];

// ============================================================================
// Knowledge Graph Relationship Tables (NLC Merger)
// ============================================================================

export const KNOWLEDGE_REL_TABLES = [
  // RELATES_TO — single edge table for all knowledge relationships (Graphiti pattern)
  // NLC's 52 relationship types stored as `type` property, not separate tables
  // Bi-temporal model: valid_at/invalid_at (event time) + created_at/expired_at (system time)
  `CREATE REL TABLE IF NOT EXISTS RELATES_TO (
    FROM Entity TO Entity,
    type STRING,
    confidence DOUBLE,
    fact STRING,
    fact_embedding FLOAT[1536],
    valid_at INT64,
    invalid_at INT64,
    created_at INT64,
    expired_at INT64,
    sampleIds STRING[],
    properties STRING
  )`,
];

// ============================================================================
// Vector Index Statements (Kuzu 0.11.3 native HNSW extension)
// ============================================================================
// NOTE: These must run AFTER the tables are created. Kuzu's HNSW index
// uses the pre-installed vector extension. Index creation is idempotent-ish —
// calling CREATE_VECTOR_INDEX on an existing index may error, so we wrap
// these in try/catch at the driver level.

export const VECTOR_INDEX_STMTS = [
  // Syntax: CREATE_VECTOR_INDEX(tableName, indexName, columnName)
  // Note: Only NODE tables support vector indexes in Kuzu 0.11.x
  // RELATES_TO is a REL table — vector search on edges is deferred
  `CALL CREATE_VECTOR_INDEX('Entity', 'entity_embedding_idx', 'embedding')`,
];

// ============================================================================
// All DDL in order
// ============================================================================

export const ALL_DDL = [
  ...NODE_TABLES,
  ...KNOWLEDGE_NODE_TABLES,
  ...REL_TABLES,
  ...KNOWLEDGE_REL_TABLES,
];
