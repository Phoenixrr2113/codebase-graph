/**
 * Benchmark: parse-only timing for large codebases
 * Measures file discovery, reading, hashing, parsing, and entity extraction
 * (skips graph writes to avoid FalkorDB Docker segfaults on arm64)
 */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, basename, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { availableParallelism } from 'node:os';
import {
  registerPlugins,
  extractEntitiesForFile,
  buildParsedFileEntities,
  createFileEntityFromContent,
} from './src/pipeline/pipeline.js';
import {
  initParser,
  parseCode,
  getLanguageForExtension,
} from './src/pipeline/parser.js';

const execFileAsync = promisify(execFile);
const target = process.argv[2] || '/tmp/large-ts-repo';
const concurrency = Math.max(4, availableParallelism());

console.log(`Parse benchmark: ${target}`);
console.log(`Concurrency: ${concurrency}`);

const startAll = Date.now();

// 1. File discovery
const discoverStart = Date.now();
const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: target, maxBuffer: 50 * 1024 * 1024 });
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const files = stdout.split('\n').filter(f => f.length > 0)
  .filter(f => extensions.has(extname(f).toLowerCase()))
  .map(f => resolve(target, f));
const discoverMs = Date.now() - discoverStart;
console.log(`Discovery: ${files.length} files in ${discoverMs}ms`);

// 2. Read + hash files
const readStart = Date.now();
registerPlugins();
await initParser();

interface FileWithContent { path: string; content: string; mtime: Date; }
const filesToProcess: FileWithContent[] = [];

for (let i = 0; i < files.length; i += concurrency) {
  const batch = files.slice(i, i + concurrency);
  const results = await Promise.allSettled(
    batch.map(async (filePath) => {
      const [fileStat, content] = await Promise.all([stat(filePath), readFile(filePath, 'utf-8')]);
      return { path: filePath, content, mtime: fileStat.mtime };
    }),
  );
  for (const result of results) {
    if (result.status === 'fulfilled') filesToProcess.push(result.value);
  }
}
const readMs = Date.now() - readStart;
console.log(`Read+hash: ${filesToProcess.length} files in ${readMs}ms (${(filesToProcess.length / (readMs / 1000)).toFixed(0)} files/sec)`);

// 3. Parse + extract entities
const parseStart = Date.now();
let totalEntities = 0;
let totalEdges = 0;
let parseErrors = 0;

for (let i = 0; i < filesToProcess.length; i += concurrency) {
  const batch = filesToProcess.slice(i, i + concurrency);
  const parsed = await Promise.allSettled(
    batch.map(async (file) => {
      const ext = extname(file.path);
      const language = getLanguageForExtension(ext);
      if (!language) throw new Error(`Unsupported: ${ext}`);
      const syntaxTree = parseCode(file.content, language, ext);
      syntaxTree.filePath = file.path;
      const extracted = extractEntitiesForFile(syntaxTree.rootNode, file.path);
      const fileEntity = createFileEntityFromContent(file.path, file.content, file.mtime);
      const built = buildParsedFileEntities(fileEntity, extracted, syntaxTree.rootNode, { deepAnalysis: true, includeExternals: false }, target);
      return { extracted, built };
    }),
  );

  for (const result of parsed) {
    if (result.status === 'rejected') { parseErrors++; continue; }
    const { extracted, built } = result.value;
    totalEntities += 1 + (extracted.functions?.length ?? 0) + (extracted.classes?.length ?? 0) +
      (extracted.interfaces?.length ?? 0) + (extracted.variables?.length ?? 0) +
      (extracted.types?.length ?? 0) + (extracted.components?.length ?? 0);
    totalEdges += (built.callEdges?.length ?? 0) + (built.importsEdges?.length ?? 0) +
      (built.extendsEdges?.length ?? 0) + (built.implementsEdges?.length ?? 0) +
      (built.rendersEdges?.length ?? 0);
  }

  if ((i + concurrency) % 5000 < concurrency || i + concurrency >= filesToProcess.length) {
    const elapsed = ((Date.now() - parseStart) / 1000).toFixed(1);
    console.log(`  Parsed: ${Math.min(i + concurrency, filesToProcess.length)}/${filesToProcess.length} (${elapsed}s)`);
  }
}
const parseMs = Date.now() - parseStart;

const totalMs = Date.now() - startAll;
console.log(`\n=== Parse Benchmark Results ===`);
console.log(`Files: ${filesToProcess.length}`);
console.log(`Entities: ${totalEntities}`);
console.log(`Edges: ${totalEdges}`);
console.log(`Parse errors: ${parseErrors}`);
console.log(`Discovery: ${discoverMs}ms`);
console.log(`Read: ${readMs}ms`);
console.log(`Parse: ${parseMs}ms (${(filesToProcess.length / (parseMs / 1000)).toFixed(0)} files/sec)`);
console.log(`Total: ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`);
console.log(`\nProjected graph write time (based on 382-file baseline):`);
const writePerEntity = 1200 / 9170; // 1.2s for 9170 entities (CREATE path)
const projectedWriteMs = totalEntities * writePerEntity;
console.log(`  CREATE path: ~${(projectedWriteMs / 1000).toFixed(1)}s`);
console.log(`  Total projected: ~${((totalMs + projectedWriteMs) / 1000).toFixed(1)}s`);
