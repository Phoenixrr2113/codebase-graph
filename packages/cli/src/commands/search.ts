import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { codeGraphService } from '@codegraph/core';

const logger = createLogger({ namespace: 'cli:search' });

export const searchCommand = new Command('search')
  .description('Search the code graph')
  .argument('<query>', 'Search query')
  .option('-l, --limit <n>', 'Max results', '20')
  .option('-s, --scope <path>', 'Scope to path prefix')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    logger.info(`Searching: "${query}"`);

    try {
      const limit = parseInt(options.limit);
      const result = await codeGraphService.search(query, { limit, scope: options.scope });

      if (options.json) {
        console.log(JSON.stringify(result.hits, null, 2));
      } else {
        if (result.hits.length === 0) {
          console.log('No results found');
        } else {
          console.log(`\nFound ${result.hits.length} results (${result.meta.durationMs}ms):\n`);
          for (const h of result.hits) {
            const loc = h.startLine ? `:${h.startLine}` : '';
            console.log(`  [${h.nodeType.padEnd(10)}] ${h.name} (${h.score.toFixed(3)})`);
            if (h.filePath) {
              console.log(`              ${h.filePath}${loc}`);
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
