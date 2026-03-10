import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { embedAllNodes, type EmbeddableNodeType } from '@codegraph/core';
import { connectGraph } from '../graphConnection';

const logger = createLogger({ namespace: 'cli:embed' });

const VALID_TYPES: EmbeddableNodeType[] = [
  'File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component',
];

export const embedCommand = new Command('embed')
  .description('Generate embeddings for graph nodes (retroactive or refresh)')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('-h, --host <host>', 'FalkorDB host', 'localhost')
  .option('-p, --port <port>', 'FalkorDB port', '6379')
  .option('--force', 'Re-embed all nodes (not just those with null embedding)')
  .option('--type <type>', 'Only embed nodes of this type (Function, Class, etc.)')
  .option('--batch-size <size>', 'Batch size for embedding generation', '100')
  .action(async (options) => {
    const startTime = Date.now();

    // Validate --type if provided
    if (options.type && !VALID_TYPES.includes(options.type as EmbeddableNodeType)) {
      console.error(`Invalid type: ${options.type}. Valid types: ${VALID_TYPES.join(', ')}`);
      process.exit(1);
    }

    try {
      const client = await connectGraph(options);
      await client.ensureIndexes();

      console.log(`Generating embeddings${options.force ? ' (force re-embed)' : ''}...`);
      if (options.type) {
        console.log(`Filtering to type: ${options.type}`);
      }

      const embedOpts: Parameters<typeof embedAllNodes>[0] = {
        force: !!options.force,
        client,
        batchSize: parseInt(options.batchSize as string),
        onProgress: (current, total, type) => {
          process.stdout.write(`\r  Embedded ${current}/${total} nodes (${type})...`);
        },
      };
      if (options.type) {
        embedOpts.nodeType = options.type as EmbeddableNodeType;
      }
      const result = await embedAllNodes(embedOpts);

      // Clear progress line
      process.stdout.write('\r' + ' '.repeat(60) + '\r');

      // Report results
      console.log(`\nEmbedded ${result.embedded} nodes (${result.skipped} skipped, ${result.errors} errors)`);

      // Per-type breakdown
      const types = Object.entries(result.byType).filter(([, count]) => count > 0);
      if (types.length > 0) {
        console.log('By type:');
        for (const [type, count] of types) {
          console.log(`  ${type}: ${count}`);
        }
      }

      await client.close();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Completed in ${elapsed}s`);
    } catch (error) {
      logger.error('Embed failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
