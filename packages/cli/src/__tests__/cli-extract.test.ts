/**
 * Integration Tests: CLI extract command (dry-run mode)
 *
 * Tests the extract command's --dry-run mode which parses TypeScript files
 * using tree-sitter without requiring a database connection.
 * Validates argument parsing and the full parse → extract pipeline.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Test Source Files
// ============================================================================

const sampleTypeScript = `\
export interface User {
  id: string;
  name: string;
  email: string;
}

export function createUser(name: string, email: string): User {
  return { id: crypto.randomUUID(), name, email };
}

export class UserService {
  private users: User[] = [];

  add(user: User): void {
    this.users.push(user);
  }

  findByEmail(email: string): User | undefined {
    return this.users.find(u => u.email === email);
  }
}
`;

const sampleHelper = `\
import { createUser, type User } from './user';

export function bulkCreate(entries: Array<{ name: string; email: string }>): User[] {
  return entries.map(e => createUser(e.name, e.email));
}
`;

// ============================================================================
// Setup / Teardown
// ============================================================================

let projectDir: string;

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'codegraph-cli-test-'));
  const srcDir = join(projectDir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'user.ts'), sampleTypeScript);
  writeFileSync(join(srcDir, 'helper.ts'), sampleHelper);
});

afterAll(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true });
  } catch { /* best effort */ }
});

// ============================================================================
// Tests: CLI argument parsing
// ============================================================================

describe('CLI structure', () => {
  it('registers all expected commands', async () => {
    const { cli } = await import('../cli.js');
    const commandNames = cli.commands.map((c: { name: () => string }) => c.name());
    expect(commandNames).toContain('extract');
    expect(commandNames).toContain('search');
    expect(commandNames).toContain('analyze');
    expect(commandNames).toContain('query');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('map');
    expect(commandNames).toContain('serve');
    expect(commandNames.length).toBe(7);
  });

  it('extract command has expected options', async () => {
    const { extractCommand } = await import('../commands/extract.js');
    const optionFlags = extractCommand.options.map((o: { flags: string }) => o.flags);
    expect(optionFlags).toContainEqual(expect.stringContaining('--dry-run'));
    expect(optionFlags).toContainEqual(expect.stringContaining('--deep'));
    expect(optionFlags).toContainEqual(expect.stringContaining('--include'));
    expect(optionFlags).toContainEqual(expect.stringContaining('--exclude'));
  });
});

// ============================================================================
// Tests: extract --dry-run
// ============================================================================

describe('extract --dry-run', () => {
  it('parses TypeScript files and reports entities without writing to DB', async () => {
    // Capture console output
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      const { extractCommand } = await import('../commands/extract.js');

      // Parse the command with dry-run mode
      await extractCommand.parseAsync([
        'node', 'codegraph', projectDir,
        '--dry-run',
      ]);

      const output = logs.join('\n');
      // Should mention parsing files
      expect(output).toMatch(/Pars(ed|ing) \d+ files/);
      // Should extract entities
      expect(output).toMatch(/Extracted \d+ entities/);
      // Should mention dry run
      expect(output).toContain('Dry run');
    } finally {
      console.log = originalLog;
    }
  });

  it('handles empty directory gracefully in dry-run', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'codegraph-cli-empty-'));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      const { extractCommand } = await import('../commands/extract.js');

      await extractCommand.parseAsync([
        'node', 'codegraph', emptyDir,
        '--dry-run',
      ]);

      const output = logs.join('\n');
      expect(output).toContain('No files found');
    } finally {
      console.log = originalLog;
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
