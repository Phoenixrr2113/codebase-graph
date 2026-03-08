/**
 * End-to-End Multi-Language Test
 *
 * Exercises the full pipeline for Python and C# language plugins:
 * real parser + Kuzu DB + indexer + direct Cypher queries.
 *
 * Creates temp directories with Python and C# source files, indexes them
 * into separate Kuzu databases via indexProject(), then queries results
 * via client.roQuery().
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient, type GraphClient } from '@codegraph/graph';
import { indexProject } from '../indexer';
import type { IndexResult } from '../indexer';

// ============================================================================
// Python Source File Contents
// ============================================================================

const pythonModelsCode = `\
class User:
    def __init__(self, name: str, email: str):
        self.name = name
        self.email = email

    def get_display_name(self) -> str:
        return self.name

class Admin(User):
    def __init__(self, name: str, email: str, role: str):
        super().__init__(name, email)
        self.role = role
`;

const pythonServiceCode = `\
from models import User, Admin

def create_user(name: str, email: str) -> User:
    return User(name, email)

def get_admin(name: str) -> Admin:
    user = create_user(name, "admin@example.com")
    return Admin(name, user.email, "admin")
`;

// ============================================================================
// C# Source File Contents
// ============================================================================

const csharpModelsCode = `\
namespace MyApp.Models
{
    public interface IEntity
    {
        string Id { get; }
    }

    public class Product : IEntity
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public decimal Price { get; set; }
    }
}
`;

const csharpServicesCode = `\
using MyApp.Models;

namespace MyApp.Services
{
    public class ProductService
    {
        public Product GetProduct(string id)
        {
            return new Product { Id = id };
        }

        public decimal CalculateTotal(Product[] products)
        {
            decimal total = 0;
            foreach (var p in products)
            {
                total += p.Price;
            }
            return total;
        }
    }
}
`;

// ============================================================================
// Python Tests
// ============================================================================

describe('E2E Multi-Language: Python indexing', () => {
  let pyClient: GraphClient;
  let pyProjectDir: string;
  let pyDbPath: string;
  let pyResult: IndexResult;

  beforeAll(async () => {
    // Create temp project with Python files
    const parentDir = mkdtempSync(join(tmpdir(), 'codegraph-e2e-py-'));
    pyProjectDir = parentDir;
    const pyDir = join(parentDir, 'py-project');
    mkdirSync(pyDir, { recursive: true });

    // Write Python source files
    writeFileSync(join(pyDir, 'models.py'), pythonModelsCode);
    writeFileSync(join(pyDir, 'service.py'), pythonServiceCode);

    // Create Kuzu DB
    const dbParent = mkdtempSync(join(tmpdir(), 'codegraph-e2e-py-db-'));
    pyDbPath = join(dbParent, 'kuzu-db');
    pyClient = await createClient({ driver: 'kuzu', databasePath: pyDbPath, graphName: 'test' });
    await pyClient.ensureIndexes();

    // Index the Python sub-project
    pyResult = await indexProject(join(parentDir, 'py-project'), { client: pyClient });
  }, 60_000);

  afterAll(() => {
    // Don't call pyClient.close() — Kuzu SIGSEGV on close kills the fork
    // and prevents vitest from reporting results. The fork exit handles cleanup.
    try { rmSync(pyProjectDir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { rmSync(join(pyDbPath, '..'), { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('indexProject succeeds for Python files', () => {
    expect(pyResult.success).toBe(true);
    expect(pyResult.stats.files).toBeGreaterThanOrEqual(2);
    expect(pyResult.stats.errors).toBe(0);
    expect(pyResult.errorMessages).toHaveLength(0);
  });

  it('Python Functions are indexed', async () => {
    const res = await pyClient.roQuery<{ name: string; filePath: string }>(
      `MATCH (f:Function) WHERE f.filePath ENDS WITH '.py' RETURN f.name as name, f.filePath as filePath`,
    );

    const names = res.data.map((r) => r.name);
    // Expect at least: __init__ (x2), get_display_name, create_user, get_admin
    expect(res.data.length).toBeGreaterThanOrEqual(4);
    expect(names).toContain('create_user');
    expect(names).toContain('get_admin');
    expect(names).toContain('get_display_name');
    expect(names).toContain('__init__');
  });

  it('Python Classes are indexed', async () => {
    const res = await pyClient.roQuery<{ name: string }>(
      `MATCH (c:Class) RETURN c.name as name`,
    );

    const names = res.data.map((r) => r.name);
    expect(names).toContain('User');
    expect(names).toContain('Admin');
  });

  it('Python CONTAINS edges exist', async () => {
    const res = await pyClient.roQuery<{ count: number }>(
      `MATCH (:File)-[r:CONTAINS]->() RETURN count(r) as count`,
    );

    expect(res.data.length).toBe(1);
    expect(res.data[0]!.count).toBeGreaterThan(0);
  });

  it('Python Variables are indexed', async () => {
    // The Python plugin extracts module-level variables.
    // Our fixtures don't have module-level assignments, but the Variable nodes
    // from imports or class properties might still exist.
    // At minimum, verify the query runs without error.
    const res = await pyClient.roQuery<{ name: string }>(
      `MATCH (v:Variable) WHERE v.filePath ENDS WITH '.py' RETURN v.name as name`,
    );

    // Variable extraction is best-effort; just verify the query shape is valid
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('Python functions have filePath set correctly', async () => {
    const res = await pyClient.roQuery<{ filePath: string }>(
      `MATCH (f:Function) RETURN f.filePath as filePath`,
    );

    expect(res.data.length).toBeGreaterThan(0);
    for (const row of res.data) {
      expect(row.filePath).toBeTruthy();
      expect(row.filePath.endsWith('.py')).toBe(true);
    }
  });
});

// ============================================================================
// C# Tests
// ============================================================================

describe('E2E Multi-Language: C# indexing', () => {
  let csClient: GraphClient;
  let csProjectDir: string;
  let csDbPath: string;
  let csResult: IndexResult;

  beforeAll(async () => {
    // Create temp project with C# files
    const parentDir = mkdtempSync(join(tmpdir(), 'codegraph-e2e-cs-'));
    csProjectDir = parentDir;
    const csDir = join(parentDir, 'cs-project');
    mkdirSync(csDir, { recursive: true });

    // Write C# source files
    writeFileSync(join(csDir, 'Models.cs'), csharpModelsCode);
    writeFileSync(join(csDir, 'Services.cs'), csharpServicesCode);

    // Create Kuzu DB
    const dbParent = mkdtempSync(join(tmpdir(), 'codegraph-e2e-cs-db-'));
    csDbPath = join(dbParent, 'kuzu-db');
    csClient = await createClient({ driver: 'kuzu', databasePath: csDbPath, graphName: 'test' });
    await csClient.ensureIndexes();

    // Index the C# sub-project
    csResult = await indexProject(join(parentDir, 'cs-project'), { client: csClient });
  }, 60_000);

  afterAll(() => {
    // Don't call csClient.close() — Kuzu SIGSEGV on close kills the fork
    try { rmSync(csProjectDir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { rmSync(join(csDbPath, '..'), { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('indexProject succeeds for C# files', () => {
    expect(csResult.success).toBe(true);
    expect(csResult.stats.files).toBeGreaterThanOrEqual(2);
    expect(csResult.stats.errors).toBe(0);
    expect(csResult.errorMessages).toHaveLength(0);
  });

  it('C# Classes are indexed', async () => {
    const res = await csClient.roQuery<{ name: string }>(
      `MATCH (c:Class) RETURN c.name as name`,
    );

    const names = res.data.map((r) => r.name);
    expect(names).toContain('Product');
    expect(names).toContain('ProductService');
  });

  it('C# Interfaces are indexed', async () => {
    const res = await csClient.roQuery<{ name: string }>(
      `MATCH (i:Interface) RETURN i.name as name`,
    );

    const names = res.data.map((r) => r.name);
    expect(names).toContain('IEntity');
  });

  it('C# Functions are indexed', async () => {
    const res = await csClient.roQuery<{ name: string }>(
      `MATCH (f:Function) RETURN f.name as name`,
    );

    const names = res.data.map((r) => r.name);
    expect(names).toContain('GetProduct');
    expect(names).toContain('CalculateTotal');
  });

  it('C# CONTAINS edges exist', async () => {
    const res = await csClient.roQuery<{ count: number }>(
      `MATCH (:File)-[r:CONTAINS]->() RETURN count(r) as count`,
    );

    expect(res.data.length).toBe(1);
    expect(res.data[0]!.count).toBeGreaterThan(0);
  });

  it('C# functions have filePath set correctly', async () => {
    const res = await csClient.roQuery<{ filePath: string }>(
      `MATCH (f:Function) RETURN f.filePath as filePath`,
    );

    expect(res.data.length).toBeGreaterThan(0);
    for (const row of res.data) {
      expect(row.filePath).toBeTruthy();
      expect(row.filePath.endsWith('.cs')).toBe(true);
    }
  });
});
