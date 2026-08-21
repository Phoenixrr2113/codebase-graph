/**
 * Go CALLS: documenting and locking the honest cross-file verdict
 * (batch-three-lang-extraction).
 *
 * Go calls are addressed by PACKAGE (`pkg.Fn()`), and a package is a
 * DIRECTORY that can span many files. CodeGraph's Function ids are
 * file-keyed (`Function:<filePath>:<name>`), so even a fully resolved
 * package directory is not enough to build a correct CALLS edge: picking
 * a file inside that directory without actually knowing which one
 * declares `Fn` would be a guess, and a wrong guess silently corrupts the
 * graph. Per-file extraction also has no visibility into sibling files in
 * its own package, so even a same-package, cross-file call cannot be
 * resolved here either.
 *
 * These tests lock in that verdict: cross-package and same-package
 * cross-file Go calls must never produce a CallReference (let alone one
 * with a guessed `calleeFilePath`), both before and after the cross-file
 * work landed for Rust. See the comments on extractCalls and
 * resolveGoImport in src/index.ts for the full reasoning and what a
 * future project-wide package symbol table would need.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Parser from 'tree-sitter';
import Go from 'tree-sitter-go';
import { extractCalls } from '../src';

let parser: Parser;
let dir: string;

function parseCode(code: string): Parser.SyntaxNode {
  return parser.parse(code).rootNode;
}

describe('Go extractCalls: no cross-file resolution', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Go as any);
    dir = mkdtempSync(join(tmpdir(), 'go-calls-no-cross-file-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not resolve a cross-package call, even when the package directory exists on disk', () => {
    // A real, resolvable-directory scenario: myproject/internal/utils really
    // exists next to this file, but WHICH .go file in it declares Helper is
    // not knowable from this file alone.
    mkdirSync(join(dir, 'internal', 'utils'), { recursive: true });
    writeFileSync(join(dir, 'internal', 'utils', 'helper.go'), 'package utils\n\nfunc Helper() {}\n');

    const filePath = join(dir, 'main.go');
    const code = `
      package main

      import "myproject/internal/utils"

      func process() {
          utils.Helper()
      }
    `;
    const calls = extractCalls(parseCode(code), filePath);

    expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
    expect(calls.some((c) => 'calleeFilePath' in c)).toBe(false);
  });

  it('does not resolve a same-package, cross-file call to a sibling file', () => {
    // sibling.go and main.go share `package main` (idiomatic Go: files in
    // one directory calling each other's unqualified functions), but
    // extractCalls only ever sees the AST of the one file it's given.
    writeFileSync(join(dir, 'sibling.go'), 'package main\n\nfunc SharedHelper() {}\n');

    const filePath = join(dir, 'main.go');
    const code = `
      package main

      func process() {
          SharedHelper()
      }
    `;
    const calls = extractCalls(parseCode(code), filePath);

    expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
  });

  it('still resolves a genuine same-file call, unaffected by unrelated sibling files', () => {
    writeFileSync(join(dir, 'sibling.go'), 'package main\n\nfunc SharedHelper() {}\n');

    const filePath = join(dir, 'main.go');
    const code = `
      package main

      func process() {
          validate()
      }
      func validate() {}
    `;
    const calls = extractCalls(parseCode(code), filePath);

    const call = calls.find((c) => c.callerName === 'process' && c.calleeName === 'validate');
    expect(call).toBeDefined();
    expect(call?.calleeFilePath).toBeUndefined();
  });
});
