import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { createClient } from '@codegraph/graph';

const logger = createLogger({ namespace: 'cli:query' });

export const queryCommand = new Command('query')
  .description('Execute a Cypher query against the graph')
  .argument('<cypher>', 'Cypher query to execute')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('-h, --host <host>', 'FalkorDB host', 'localhost')
  .option('-p, --port <port>', 'FalkorDB port', '6379')
  .option('--params <json>', 'Query parameters as JSON')
  .option('--format <type>', 'Output format: json, table, csv', 'json')
  .action(async (cypher, options) => {
    logger.info(`Executing query: ${cypher.slice(0, 100)}`);

    try {
      const client = await createClient({
        host: options.host,
        port: parseInt(options.port),
        graphName: options.graph,
      });

      const params = options.params ? JSON.parse(options.params) : {};
      const result = await client.roQuery<Record<string, unknown>>(cypher, { params });

      switch (options.format) {
        case 'json':
          console.log(JSON.stringify(result.data, null, 2));
          break;
          
        case 'csv': {
          if (result.data.length === 0) {
            console.log('No results');
            break;
          }
          const first = result.data[0];
          if (!first) break;
          const headers = Object.keys(first);
          console.log(headers.join(','));
          for (const row of result.data) {
            console.log(headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
          }
          break;
        }
        
        case 'table': {
          if (result.data.length === 0) {
            console.log('No results');
            break;
          }
          const first = result.data[0];
          if (!first) break;
          const headers = Object.keys(first);
          const widths = headers.map(h => 
            Math.max(h.length, ...result.data.map(r => String(r[h] ?? '').length))
          );
          
          const sep = widths.map(w => '-'.repeat(w + 2)).join('+');
          console.log('+' + sep + '+');
          console.log('| ' + headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join(' | ') + ' |');
          console.log('+' + sep + '+');
          for (const row of result.data) {
            console.log('| ' + headers.map((h, i) => String(row[h] ?? '').padEnd(widths[i] ?? 0)).join(' | ') + ' |');
          }
          console.log('+' + sep + '+');
          break;
        }
      }

      console.error(`\n${result.data.length} rows returned`);
      await client.close();

    } catch (error) {
      logger.error('Query failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
