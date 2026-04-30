/**
 * Snapshot tests for the call-attribution rewrite (Task 5 of TS CALLS plan).
 *
 * Each fixture under __fixtures__/calls/ is parsed, fed through extractFunctions
 * + extractImports + extractCalls (with includeExternals=true so unresolved
 * callees still produce attribution rows), and the resulting CallReference[]
 * is matched against a vitest snapshot.
 *
 * Absolute paths in callerFilePath / calleeFilePath are stripped to '<fixture>'
 * so the snapshot is portable across machines.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { extractCalls } from '../src/extractors/calls';
import { extractFunctions } from '../src/extractors/functions';
import { extractImports } from '../src/extractors/imports';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '__fixtures__/calls');

const parser = new Parser();
// Cast workaround mirrors complexity.test.ts / findEnclosingNamedEntity.test.ts —
// tree-sitter-typescript's language object isn't directly assignable to
// Parser.Language under the installed @types/tree-sitter version.
parser.setLanguage(TypeScript.typescript as Parser.Language);
const tsxParser = new Parser();
tsxParser.setLanguage(TypeScript.tsx as Parser.Language);

interface Fixture {
  filename: string;
  parserToUse: Parser;
}

const FIXTURES: Fixture[] = [
  { filename: 'zod-style-factory.ts', parserToUse: parser },
  { filename: 'redux-reducer.ts', parserToUse: parser },
  { filename: 'class-arrow-property.ts', parserToUse: parser },
  { filename: 'jsx-event-handler.tsx', parserToUse: tsxParser },
  { filename: 'nested-callbacks.ts', parserToUse: parser },
];

describe('extractCalls — attribution snapshots', () => {
  for (const { filename, parserToUse } of FIXTURES) {
    it(filename, () => {
      const filePath = join(FIXTURE_DIR, filename);
      const source = readFileSync(filePath, 'utf-8');
      const tree = parserToUse.parse(source);
      const root = tree.rootNode;

      const functions = extractFunctions(root, filePath);
      const imports = extractImports(root, filePath);

      const calls = extractCalls(root, filePath, functions, imports, /* includeExternals */ true);

      // Strip absolute paths to make snapshots portable across machines.
      const portable = calls.map((c) => ({
        ...c,
        callerFilePath: c.callerFilePath.replace(filePath, '<fixture>'),
        calleeFilePath: c.calleeFilePath?.replace(filePath, '<fixture>'),
      }));

      expect(portable).toMatchSnapshot();
    });
  }
});
