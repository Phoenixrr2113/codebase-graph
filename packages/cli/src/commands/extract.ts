import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { indexProject, syncGitHistory } from '@codegraph/core';
import {
  initParser,
  parseFile,
  disposeParser,
  createFileEntity,
  extractEntitiesForFile,
  buildParsedFileEntities,
  countEntities,
  countEdges,
  SUPPORTED_EXTENSIONS,
  DEFAULT_IGNORE_PATTERNS,
} from '@codegraph/core';
import { glob } from 'glob';
import { resolve } from 'path';
import { connectGraph } from '../graphConnection';

const logger = createLogger({ namespace: 'cli:extract' });

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
  .option('--dry-run', 'Parse without writing to database')
  .action(async (targetPath, options) => {
    const startTime = Date.now();
    const absPath = resolve(targetPath);

    logger.info(`Extracting from: ${absPath}`);
    logger.info(`Graph: ${options.graph} @ ${options.host}:${options.port}`);

    try {
      // Build include/exclude patterns from CLI options
      const includePatterns = options.include
        ? (options.include as string).split(',')
        : SUPPORTED_EXTENSIONS.map(ext => `**/*${ext}`);
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
        const client = await connectGraph(options);
        await client.ensureIndexes();

        const indexOpts: Parameters<typeof indexProject>[1] = {
          deepAnalysis: !!options.deep,
          ignorePatterns: excludePatterns,
          client,
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

          // Sync git history (unless --no-git)
          if (options.git !== false) {
            console.log('\nSyncing git history...');
            const gitResult = await syncGitHistory(absPath, client);
            if (gitResult.commitsProcessed > 0) {
              console.log(`Git: ${gitResult.commitsProcessed} commits, ${gitResult.edgesCreated} file→commit edges`);
            } else if (gitResult.errors.length > 0) {
              console.log(`Git: ${gitResult.errors[0]}`);
            } else {
              console.log('Git: already up to date');
            }
          }
        } else {
          console.error(`Indexing failed: ${result.errorMessages.join('; ')}`);
        }

        await client.close();
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
