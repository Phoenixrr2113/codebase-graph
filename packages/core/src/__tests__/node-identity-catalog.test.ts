import { describe, expect, it } from 'vitest';
import {
  buildParsedFileEntities,
  createFileEntityFromContent,
  extractEntitiesForFile,
  parseCode,
  registerPlugins,
} from '../pipeline';
import { buildProjectSymbolCatalog, resolveProjectSymbolEdges } from '../pipeline/pipeline';

describe('project symbol catalog', () => {
  it('resolves a cross-file call to both persisted symbol ids before graph writes', () => {
    registerPlugins();
    const targetPath = '/project/target.ts';
    const callerPath = '/project/caller.ts';
    const targetContent = 'export function target(): number {\n  return 1;\n}\n';
    const callerContent = [
      "import { target } from './target';",
      'export function caller(): number {',
      '  return target();',
      '}',
      '',
    ].join('\n');

    const parse = (filePath: string, content: string) => {
      const tree = parseCode(content, 'typescript', '.ts');
      const extracted = extractEntitiesForFile(tree.rootNode, filePath);
      if (filePath === callerPath && extracted.imports[0]) {
        extracted.imports[0].resolvedPath = targetPath;
      }
      const file = createFileEntityFromContent(filePath, content, new Date(0));
      return {
        extracted,
        parsed: buildParsedFileEntities(file, extracted, tree.rootNode, { deepAnalysis: true }),
      };
    };

    const target = parse(targetPath, targetContent);
    const caller = parse(callerPath, callerContent);
    const catalog = buildProjectSymbolCatalog([target.parsed, caller.parsed]);

    resolveProjectSymbolEdges([target.parsed, caller.parsed], catalog);

    const edge = caller.parsed.callEdges[0];
    expect(edge?.callerId).toBe(caller.extracted.functions.find(fn => fn.name === 'caller')?.id);
    expect(edge?.calleeId).toBe(target.extracted.functions.find(fn => fn.name === 'target')?.id);
    expect(edge?.callerId).toMatch(/^sym:v1:[a-f0-9]{64}$/);
    expect(edge?.calleeId).toMatch(/^sym:v1:[a-f0-9]{64}$/);
  });
});
