import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { createClient, createOperations } from '@codegraph/graph';
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
} from '@codegraph/parser';
import type { ProjectEntity } from '@codegraph/types';
import { glob } from 'glob';
import { resolve, basename } from 'path';
import { randomUUID } from 'crypto';

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
  .option('--dry-run', 'Parse without writing to database')
  .action(async (targetPath, options) => {
    const startTime = Date.now();
    const absPath = resolve(targetPath);

    logger.info(`Extracting from: ${absPath}`);
    logger.info(`Graph: ${options.graph} @ ${options.host}:${options.port}`);

    try {
      await initParser();

      // Use parser's supported extensions if user didn't specify custom patterns
      const includePatterns = options.include
        ? (options.include as string).split(',')
        : SUPPORTED_EXTENSIONS.map(ext => `**/*${ext}`);
      const excludePatterns = options.exclude
        ? (options.exclude as string).split(',')
        : [...DEFAULT_IGNORE_PATTERNS];

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

      // Parse and extract all files
      const parsed: Array<{
        filePath: string;
        result: Awaited<ReturnType<typeof buildParsedFileEntities>>;
        entityCount: number;
        edgeCount: number;
      }> = [];

      let totalEntities = 0;
      let totalEdges = 0;
      let parseErrors = 0;

      for (const file of files) {
        try {
          const syntaxTree = await parseFile(file);
          const extracted = extractEntitiesForFile(syntaxTree.rootNode, file);
          const fileEntity = await createFileEntity(file);

          const pipelineOptions = {
            deepAnalysis: !!options.deep,
            includeExternals: false,
          };

          const parsedFile = buildParsedFileEntities(
            fileEntity,
            extracted,
            syntaxTree.rootNode,
            pipelineOptions,
            absPath, // project root for Python import resolution
          );

          const entityCount = 1 + countEntities(extracted); // +1 for file
          const edgeCount = countEdges(parsedFile) + countEntities(extracted); // CONTAINS edges

          totalEntities += entityCount;
          totalEdges += edgeCount;

          parsed.push({ filePath: file, result: parsedFile, entityCount, edgeCount });
        } catch (err) {
          parseErrors++;
          logger.warn(`Failed to parse ${file}: ${err}`);
        }
      }

      console.log(`\nParsed ${parsed.length} files (${parseErrors} errors)`);
      console.log(`Extracted ${totalEntities} entities, ${totalEdges} edges`);

      if (options.dryRun) {
        console.log('\n[Dry run] Skipping database write');
      } else {
        const client = await createClient({
          host: options.host,
          port: parseInt(options.port),
          graphName: options.graph,
        });

        await client.ensureIndexes();
        const ops = createOperations(client);

        // Create Project node
        const now = new Date().toISOString();
        const existingProject = await ops.getProjectByRoot(absPath);
        const project: ProjectEntity = existingProject ?? {
          id: randomUUID(),
          name: basename(absPath),
          rootPath: absPath,
          createdAt: now,
          lastParsed: now,
          fileCount: parsed.length,
        };
        project.lastParsed = now;
        project.fileCount = parsed.length;
        await ops.upsertProject(project);

        // Batch upsert all parsed files + link to project
        let nodesCreated = 0;
        for (const { filePath, result } of parsed) {
          await ops.batchUpsert(result);
          await ops.linkProjectFile(project.id, filePath);
          nodesCreated += result.functions.length +
            result.classes.length +
            result.interfaces.length +
            result.variables.length +
            result.types.length +
            result.components.length +
            result.imports.length + 1; // +1 for file
        }

        console.log(`\nStored in graph "${options.graph}": ${nodesCreated} nodes, ${totalEdges} edges`);
        console.log(`Project: ${project.name} (${project.id})`);

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
