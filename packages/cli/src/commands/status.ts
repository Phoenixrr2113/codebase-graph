import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { createClient, createQueries } from '@codegraph/graph';
import type { GraphStats } from '@codegraph/types';

const logger = createLogger({ namespace: 'cli:status' });

export const statusCommand = new Command('status')
  .description('Show graph database status and statistics')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('-h, --host <host>', 'FalkorDB host', 'localhost')
  .option('-p, --port <port>', 'FalkorDB port', '6379')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    logger.info(`Checking status: ${options.graph} @ ${options.host}:${options.port}`);

    try {
      const client = await createClient({
        host: options.host,
        port: parseInt(options.port),
        graphName: options.graph,
      });

      const queries = createQueries(client);
      const stats: GraphStats = await queries.getStats();

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`\nGraph: ${options.graph}`);
        console.log(`Host: ${options.host}:${options.port}`);
        console.log(`\nTotal Nodes: ${stats.totalNodes}`);
        console.log(`Total Edges: ${stats.totalEdges}`);
        
        if (Object.keys(stats.nodesByType).length > 0) {
          console.log('\n--- Nodes by Type ---');
          for (const [type, count] of Object.entries(stats.nodesByType)) {
            console.log(`  ${type.padEnd(12)}: ${count}`);
          }
        }
        
        if (Object.keys(stats.edgesByType).length > 0) {
          console.log('\n--- Edges by Type ---');
          for (const [type, count] of Object.entries(stats.edgesByType)) {
            console.log(`  ${type.padEnd(12)}: ${count}`);
          }
        }
        
        if (stats.largestFiles && stats.largestFiles.length > 0) {
          console.log('\n--- Largest Files ---');
          for (const f of stats.largestFiles.slice(0, 5)) {
            console.log(`  ${f.path}: ${f.entityCount} entities`);
          }
        }
      }

      await client.close();

    } catch (error) {
      logger.error('Status check failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
