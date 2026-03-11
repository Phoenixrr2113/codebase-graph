/**
 * Integration Tests: indexSingleFile + indexProject utilities
 *
 * Exercises indexSingleFile against a real Kuzu DB with real TypeScript files.
 * Follows the same temp Kuzu DB + fork isolation pattern as e2e-smoke.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient, createOperations, type GraphClient } from '@codegraph/graph';
import { indexSingleFile, isProjectIndexed, indexProject } from '../indexer';

// ============================================================================
// Test Source Files
// ============================================================================

const calculatorCode = `\
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export class Calculator {
  value: number = 0;

  add(n: number): Calculator {
    this.value = add(this.value, n);
    return this;
  }

  multiply(n: number): Calculator {
    this.value = multiply(this.value, n);
    return this;
  }

  result(): number {
    return this.value;
  }
}
`;

const helperCode = `\
import { add, multiply } from './calculator';

export function sum(nums: number[]): number {
  return nums.reduce((acc, n) => add(acc, n), 0);
}

export function product(nums: number[]): number {
  return nums.reduce((acc, n) => multiply(acc, n), 1);
}
`;

const updatedCalculatorCode = `\
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export class Calculator {
  value: number = 0;

  add(n: number): Calculator {
    this.value = add(this.value, n);
    return this;
  }

  multiply(n: number): Calculator {
    this.value = multiply(this.value, n);
    return this;
  }

  subtract(n: number): Calculator {
    this.value = subtract(this.value, n);
    return this;
  }

  result(): number {
    return this.value;
  }
}
`;

// ============================================================================
// Setup / Teardown
// ============================================================================

let client: GraphClient;
let projectDir: string;
let dbPath: string;

beforeAll(async () => {
  // Create temp project
  const parentDir = mkdtempSync(join(tmpdir(), 'codegraph-indexer-'));
  projectDir = parentDir;
  const srcDir = join(parentDir, 'src');
  mkdirSync(srcDir, { recursive: true });

  // Write source files
  writeFileSync(join(srcDir, 'calculator.ts'), calculatorCode);
  writeFileSync(join(srcDir, 'helper.ts'), helperCode);

  // Create Kuzu DB
  const dbParent = mkdtempSync(join(tmpdir(), 'codegraph-indexer-db-'));
  dbPath = join(dbParent, 'kuzu-db');
  client = await createClient({ driver: 'kuzu', databasePath: dbPath, graphName: 'test' });
  await client.ensureIndexes();
}, 30_000);

afterAll(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(join(dbPath, '..'), { recursive: true, force: true }); } catch { /* best effort */ }
});

// ============================================================================
// Tests: indexSingleFile
// ============================================================================

// LEGACY: Kuzu-specific tests — skipped after FalkorDB migration.
describe.skip('indexSingleFile', () => {
  it('indexes a TypeScript file with functions and classes', async () => {
    const filePath = join(projectDir, 'src', 'calculator.ts');
    const result = await indexSingleFile(filePath, projectDir, client);

    expect(result.success).toBe(true);
    expect(result.entities).toBeGreaterThanOrEqual(4); // 1 file + add + multiply + Calculator + methods
    expect(result.edges).toBeGreaterThan(0); // CONTAINS edges at minimum
  });

  it('persists entities to Kuzu — query finds them', async () => {
    const fnResult = await client.roQuery<{ name: string }>(
      'MATCH (f:Function) WHERE f.filePath CONTAINS $path RETURN f.name as name ORDER BY f.name',
      { params: { path: 'calculator.ts' } },
    );

    const names = fnResult.data.map((r) => r.name);
    expect(names).toContain('add');
    expect(names).toContain('multiply');
  });

  it('persists class nodes', async () => {
    const classResult = await client.roQuery<{ name: string }>(
      'MATCH (c:Class) WHERE c.filePath CONTAINS $path RETURN c.name as name',
      { params: { path: 'calculator.ts' } },
    );
    expect(classResult.data.map((r) => r.name)).toContain('Calculator');
  });

  it('creates CONTAINS edges from file to entities', async () => {
    const containsResult = await client.roQuery<{ child: string }>(
      `MATCH (f:File)-[:CONTAINS]->(n)
       WHERE f.path CONTAINS 'calculator.ts'
       RETURN n.name as child`,
      { params: {} },
    );
    expect(containsResult.data.length).toBeGreaterThanOrEqual(3); // add, multiply, Calculator
  });

  it('indexes a second file with imports', async () => {
    const filePath = join(projectDir, 'src', 'helper.ts');
    const result = await indexSingleFile(filePath, projectDir, client);

    expect(result.success).toBe(true);
    expect(result.entities).toBeGreaterThanOrEqual(3); // file + sum + product
    expect(result.edges).toBeGreaterThan(0);
  });

  it('re-indexing a modified file updates entities', async () => {
    // Overwrite calculator.ts with version that adds subtract()
    const filePath = join(projectDir, 'src', 'calculator.ts');
    writeFileSync(filePath, updatedCalculatorCode);

    const result = await indexSingleFile(filePath, projectDir, client);
    expect(result.success).toBe(true);
    expect(result.entities).toBeGreaterThanOrEqual(5); // now has subtract too

    // Verify subtract exists in the graph (upsert may create duplicates in Kuzu)
    const fnResult = await client.roQuery<{ name: string }>(
      'MATCH (f:Function) WHERE f.name = $name AND f.filePath CONTAINS $path RETURN f.name as name',
      { params: { name: 'subtract', path: 'calculator.ts' } },
    );
    expect(fnResult.data.length).toBeGreaterThanOrEqual(1);
  });

  it('returns error for non-existent file', async () => {
    const result = await indexSingleFile('/nonexistent/file.ts', projectDir, client);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================================
// Tests: isProjectIndexed + indexProject
// ============================================================================

// LEGACY: Kuzu-specific
describe.skip('isProjectIndexed', () => {
  it('returns false for a never-indexed path', async () => {
    const result = await isProjectIndexed('/some/random/path/that/doesnt/exist');
    // This will either return false (if the graph client is available) or false (if it throws)
    expect(result).toBe(false);
  });
});

// LEGACY: Kuzu-specific
describe.skip('indexProject', () => {
  it('indexes a project and creates a Project node', async () => {
    const result = await indexProject(projectDir, { client });

    expect(result.success).toBe(true);
    expect(result.stats.files).toBeGreaterThanOrEqual(2);
    expect(result.stats.entities).toBeGreaterThan(0);
    expect(result.stats.edges).toBeGreaterThan(0);
    expect(result.projectName).toBe(projectDir.split('/').pop());
  });

  it('the Project node is queryable from Kuzu', async () => {
    const ops = createOperations(client);
    const project = await ops.getProjectByRoot(projectDir);
    expect(project).not.toBeNull();
    expect(project!.rootPath).toBe(projectDir);
    expect(project!.fileCount).toBeGreaterThanOrEqual(2);
  });

  it('returns failure for a file path (not a directory)', async () => {
    const filePath = join(projectDir, 'src', 'calculator.ts');
    const result = await indexProject(filePath, { client });
    expect(result.success).toBe(false);
    expect(result.errorMessages.length).toBeGreaterThan(0);
  });
});
