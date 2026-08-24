import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { indexProject } from '@codegraph/core';
import {
  initParser,
  parseFile,
  disposeParser,
  createFileEntity,
  extractEntitiesForFile,
  buildParsedFileEntities,
  countEntities,
  countEdges,
  registerPlugins,
  getSupportedExtensions,
  DEFAULT_IGNORE_PATTERNS,
} from '@codegraph/core';
import { glob } from 'glob';
import { resolve } from 'path';
import { getGraphClient } from '@codegraph/core';

const logger = createLogger({ namespace: 'cli:extract' });
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;

function isValidIsoDateOrTimestamp(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const reconstructed = new Date(0);
  reconstructed.setUTCHours(0, 0, 0, 0);
  reconstructed.setUTCFullYear(year, month - 1, day);
  return reconstructed.getUTCFullYear() === year
    && reconstructed.getUTCMonth() === month - 1
    && reconstructed.getUTCDate() === day;
}

function parseHistorySince(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw new Error('historySince must be a valid ISO 8601 date or timestamp');
  if (!isValidIsoDateOrTimestamp(raw)) {
    throw new Error('historySince must be a valid ISO 8601 date or timestamp');
  }
  return raw;
}

function parseHistoryMaxCommits(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) {
    throw new Error('historyMaxCommits must be a safe integer between 1 and 100000');
  }
  return value;
}

export const extractCommand = new Command('extract')
  .description('Parse source files and populate the code graph')
  .argument('<path>', 'Path to parse (file or directory)')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('-h, --host <host>', 'FalkorDB host', 'localhost')
  .option('-p, --port <port>', 'FalkorDB port', '6379')
  .option('--include <patterns>', 'Include glob patterns (comma-separated)')
  .option('--exclude <patterns>', 'Exclude glob patterns (comma-separated)')
  .option('--deep', 'Enable deep analysis (call/render edges, complexity)')
  .option('--no-git', 'Skip git history sync')
  .option('--history-since <iso>', 'Inclusive ISO 8601 cutoff for the persisted git history window')
  .option('--history-max-commits <count>', 'Initial-backfill safety ceiling (1-100000)')
  .option('--dry-run', 'Parse without writing to database')
  .action(async (targetPath, options) => {
    const startTime = Date.now();
    const absPath = resolve(targetPath);

    logger.info(`Extracting from: ${absPath}`);
    logger.info(`Graph: ${options.graph} @ ${options.host}:${options.port}`);

    try {
      const historySince = parseHistorySince(options.historySince);
      const historyMaxCommits = parseHistoryMaxCommits(options.historyMaxCommits);
      // Ensure plugins are registered before querying extensions
      registerPlugins();

      // Build include/exclude patterns from CLI options
      const includePatterns = options.include
        ? (options.include as string).split(',')
        : getSupportedExtensions().map(ext => `**/*${ext}`);
      const excludePatterns = options.exclude
        ? (options.exclude as string).split(',')
        : [...DEFAULT_IGNORE_PATTERNS];

      if (options.dryRun) {
        // Dry-run: parse files without writing to database
        await initParser();

        const files: string[] = [];
        for (const pattern of includePatterns) {
          const matches = await glob(pattern, {
            cwd: absPath,
            ignore: excludePatterns,
            absolute: true,
          });
          files.push(...matches);
        }

        logger.info(`Found ${files.length} files to parse`);

        if (files.length === 0) {
          console.log('No files found matching the patterns');
          return;
        }

        console.log(`Parsing ${files.length} files...`);

        let totalEntities = 0;
        let totalEdges = 0;
        let parseErrors = 0;
        let successCount = 0;

        for (const file of files) {
          try {
            const syntaxTree = await parseFile(file);
            const extracted = extractEntitiesForFile(syntaxTree.rootNode, file);
            const fileEntity = await createFileEntity(file);
            const parsedFile = buildParsedFileEntities(
              fileEntity,
              extracted,
              syntaxTree.rootNode,
              { deepAnalysis: !!options.deep, includeExternals: false },
              absPath,
            );

            totalEntities += 1 + countEntities(extracted);
            totalEdges += countEdges(parsedFile) + countEntities(extracted);
            successCount++;
          } catch (err) {
            parseErrors++;
            logger.warn(`Failed to parse ${file}: ${err}`);
          }
        }

        console.log(`\nParsed ${successCount} files (${parseErrors} errors)`);
        console.log(`Extracted ${totalEntities} entities, ${totalEdges} edges`);
        console.log('\n[Dry run] Skipping database write');
      } else {
        // Normal mode: use core's indexProject for full pipeline
        const client = await getGraphClient();
        await client.ensureIndexes();

        const indexOpts: Parameters<typeof indexProject>[1] = {
          deepAnalysis: !!options.deep,
          ignorePatterns: excludePatterns,
          client,
          gitSync: options.git !== false,
          ...(historySince !== undefined && { historySince }),
          ...(historyMaxCommits !== undefined && { historyMaxCommits }),
        };
        if (options.include) {
          indexOpts!.includePatterns = includePatterns;
        }
        const result = await indexProject(absPath, indexOpts);

        if (result.success) {
          console.log(`\nStored in graph "${options.graph}": ${result.stats.entities} entities, ${result.stats.edges} edges`);
          console.log(`Project: ${result.projectName} (${result.projectId})`);
          if (result.stats.errors > 0) {
            console.log(`${result.stats.errors} files failed to parse`);
          }

          if (options.git !== false) {
            const commitsProcessed = result.stats.commitsProcessed ?? 0;
            const gitEdges = result.stats.gitEdges ?? 0;
            console.log(commitsProcessed > 0
              ? `Git: ${commitsProcessed} commits, ${gitEdges} file→commit edges`
              : 'Git: already up to date');
          }
        } else {
          console.error(`Indexing failed: ${result.errorMessages.join('; ')}`);
        }

      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Completed in ${elapsed}s`);

    } catch (error) {
      logger.error('Extract failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      disposeParser();
    }
  });
