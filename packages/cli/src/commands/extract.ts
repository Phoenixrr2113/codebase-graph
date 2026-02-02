import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { createClient, createOperations } from '@codegraph/graph';
import { initParser, parseFile, extractAllEntities, disposeParser } from '@codegraph/parser';
import { glob } from 'glob';
import { resolve, relative } from 'path';
import { statSync } from 'fs';
import { createHash } from 'crypto';

const logger = createLogger({ namespace: 'cli:extract' });

export const extractCommand = new Command('extract')
  .description('Parse source files and populate the code graph')
  .argument('<path>', 'Path to parse (file or directory)')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('-h, --host <host>', 'FalkorDB host', 'localhost')
  .option('-p, --port <port>', 'FalkorDB port', '6379')
  .option('--include <patterns>', 'Include glob patterns (comma-separated)', '**/*.ts,**/*.tsx,**/*.js,**/*.jsx')
  .option('--exclude <patterns>', 'Exclude glob patterns (comma-separated)', '**/node_modules/**,**/dist/**,**/.git/**')
  .option('--dry-run', 'Parse without writing to database')
  .action(async (targetPath, options) => {
    const startTime = Date.now();
    const absPath = resolve(targetPath);
    
    logger.info(`Extracting from: ${absPath}`);
    logger.info(`Graph: ${options.graph} @ ${options.host}:${options.port}`);

    try {
      await initParser();

      const includePatterns = options.include.split(',') as string[];
      const excludePatterns = options.exclude.split(',') as string[];

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
      const parsedFiles: Array<{
        path: string;
        entities: ReturnType<typeof extractAllEntities>;
      }> = [];

      for (const file of files) {
        try {
          const result = await parseFile(file);
          
          if (result.tree) {
            const entities = extractAllEntities(result.tree.rootNode, file);
            totalEntities += 
              entities.functions.length +
              entities.classes.length +
              entities.interfaces.length +
              entities.variables.length +
              entities.types.length +
              entities.components.length +
              entities.imports.length;
            
            parsedFiles.push({ path: file, entities });
          }
        } catch (err) {
          logger.warn(`Failed to parse ${file}: ${err}`);
        }
      }

      console.log(`\nParsed ${parsedFiles.length} files`);
      console.log(`Extracted ${totalEntities} entities`);

      if (options.dryRun) {
        console.log('\n[Dry run] Skipping database write');
      } else {
        const client = await createClient({
          host: options.host,
          port: parseInt(options.port),
          graphName: options.graph,
        });

        const ops = createOperations(client);
        
        let nodesCreated = 0;

        for (const { path: filePath, entities } of parsedFiles) {
          const relPath = relative(absPath, filePath);
          const stat = statSync(filePath);
          const content = await import('fs').then(fs => fs.readFileSync(filePath, 'utf-8'));
          const hash = createHash('md5').update(content).digest('hex');
          const loc = content.split('\n').length;
          
          await ops.upsertFile({
            path: relPath,
            name: relPath.split('/').pop() ?? relPath,
            extension: relPath.split('.').pop() ?? '',
            loc,
            lastModified: stat.mtime.toISOString(),
            hash,
          });
          nodesCreated++;

          for (const fn of entities.functions) {
            await ops.upsertFunction({ ...fn, filePath: relPath });
            nodesCreated++;
          }
          for (const cls of entities.classes) {
            await ops.upsertClass({ ...cls, filePath: relPath });
            nodesCreated++;
          }
          for (const iface of entities.interfaces) {
            await ops.upsertInterface({ ...iface, filePath: relPath });
            nodesCreated++;
          }
        }

        console.log(`\nStored in graph "${options.graph}": ${nodesCreated} nodes`);

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
