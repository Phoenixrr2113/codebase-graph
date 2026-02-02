import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { createClient, createQueries } from '@codegraph/graph';
import type { SearchResult, NodeLabel } from '@codegraph/types';

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
      const client = await createClient({
        host: options.host,
        port: parseInt(options.port),
        graphName: options.graph,
      });

      const queries = createQueries(client);
      const limit = parseInt(options.limit);
      
      const types: NodeLabel[] | undefined = options.type 
        ? options.type.split(',') as NodeLabel[]
        : undefined;
      
      const results: SearchResult[] = await queries.search(query, types, limit);

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log('No results found');
        } else {
          console.log(`\nFound ${results.length} results:\n`);
          for (const r of results) {
            const loc = r.line ? `:${r.line}` : '';
            console.log(`  [${r.type.padEnd(10)}] ${r.name}`);
            if (r.filePath) {
              console.log(`              ${r.filePath}${loc}`);
            }
            console.log();
          }
        }
      }

      await client.close();

    } catch (error) {
      logger.error('Search failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
