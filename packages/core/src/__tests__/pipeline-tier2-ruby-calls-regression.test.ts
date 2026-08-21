/**
 * Tier-2 regression check for the batch-three generic-calls fix.
 *
 * genericExtractCalls (packages/plugin-generic/src/index.ts) now accepts an
 * optional CallExtractionContext and pipeline.ts's generic call-extraction
 * call site now always passes one (the file's already-extracted imports).
 * Every tier-2 language built on createLanguagePlugin() flows through that
 * same call site. This test locks that a config language whose import
 * extraction does NOT resolve real file paths (Ruby's `require` extraction
 * never sets ImportEntity.resolvedPath, see plugin-languages/src/configs/
 * ruby.ts) keeps extracting exactly the same same-file CALLS edges it did
 * before this fix: passing a context with no resolvable imports must be a
 * no-op, not a behavior change.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  registerTier2Languages,
  parseCode,
  extractEntitiesForFile,
  createFileEntityFromContent,
  buildParsedFileEntities,
  languageRegistry,
} from '../pipeline';
import {
  buildProjectSymbolCatalog,
  resolveProjectSymbolEdges,
} from '../pipeline/pipeline';

describe('buildParsedFileEntities: tier-2 (Ruby) same-file calls unaffected by the context change', () => {
  let dir: string;
  let rubyAvailable = false;

  beforeAll(async () => {
    const { registered } = await registerTier2Languages();
    rubyAvailable = registered.includes('ruby') || languageRegistry.getForExtension('.rb') !== undefined;
    dir = mkdtempSync(join(tmpdir(), 'tier2-ruby-calls-'));
    writeFileSync(
      join(dir, 'greeter.rb'),
      ['def helper()', "  'hi'", 'end', '', 'def caller()', '  helper()', 'end', ''].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('(f) still extracts a same-file CALLS edge for a plain Ruby method call, with no context-related regression', () => {
    if (!rubyAvailable) {
      // Grammar not installed in this environment: skip rather than fail,
      // matching the optionalDependencies pattern the tier-2 loader itself
      // uses (see registerTier2Languages's skipped-language handling).
      return;
    }

    const filePath = join(dir, 'greeter.rb');
    const content = readFileSync(filePath, 'utf-8');
    const syntaxTree = parseCode(content, 'ruby', '.rb');
    const extracted = extractEntitiesForFile(syntaxTree.rootNode, filePath);
    const fileEntity = createFileEntityFromContent(filePath, content, new Date());

    const built = buildParsedFileEntities(
      fileEntity,
      extracted,
      syntaxTree.rootNode,
      { deepAnalysis: true, includeExternals: false },
      dir,
    );
    resolveProjectSymbolEdges([built], buildProjectSymbolCatalog([built]));

    const callerId = built.functions.find((fn) => fn.name === 'caller')?.id;
    const calleeId = built.functions.find((fn) => fn.name === 'helper')?.id;
    const call = built.callEdges.find((e) => e.callerId === callerId);
    expect(call).toBeDefined();
    expect(call!.calleeId).toBe(calleeId);
  });
});
