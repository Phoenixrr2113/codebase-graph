import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { codeGraphService } from '@codegraph/core';

const logger = createLogger({ namespace: 'cli:search' });

export const searchCommand = new Command('search')
  .description('Search the code graph')
  .argument('<query>', 'Search query')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('-h, --host <host>', 'FalkorDB host', 'localhost')
  .option('-p, --port <port>', 'FalkorDB port', '6379')
  .option('-t, --type <types>', 'Entity types (comma-separated): Function,Class,Interface,Component,Variable,Type')
  .option('-l, --limit <n>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    logger.info(`Searching: "${query}"`);

    try {
      const limit = parseInt(options.limit);

      // Use multi-type support in core: pass types array directly
      const types = options.type
        ? (options.type.split(',') as string[]).map((t: string) => t.trim())
        : undefined;

      const result = await codeGraphService.search(query, types ? { types, limit } : { limit });
      const filtered = result.results;

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        if (filtered.length === 0) {
          console.log('No results found');
        } else {
          console.log(`\nFound ${filtered.length} results:\n`);
          for (const r of filtered) {
            const loc = r.line ? `:${r.line}` : '';
            console.log(`  [${r.type.padEnd(10)}] ${r.name}`);
            if (r.filePath) {
              console.log(`              ${r.filePath}${loc}`);
            }
            console.log();
          }
        }
      }

    } catch (error) {
      logger.error('Search failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
