/**
 * CLI Command: codegraph link
 *
 * Links knowledge graph entities to code graph nodes via ABOUT edges.
 * Two modes:
 *   1. Name matching (default): fast, exact/case-insensitive/contained text matching
 *   2. Embedding similarity (--embedding): uses vector search for semantic matching
 *
 * Usage:
 *   codegraph link                      # name-match all unlinked entities
 *   codegraph link --embedding          # use embedding similarity
 *   codegraph link --threshold 0.75     # custom similarity threshold
 *   codegraph link --force              # re-link everything (ignore existing ABOUT edges)
 */

import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { createKnowledgeOperations } from '@codegraph/graph';
import { linkEntitiesToCode, linkByEmbedding } from '@codegraph/plugin-nlp';
import { getGraphClient } from '@codegraph/core';

const logger = createLogger({ namespace: 'cli:link' });

export const linkCommand = new Command('link')
  .description('Link knowledge graph entities to code graph nodes via ABOUT edges')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('-h, --host <host>', 'FalkorDB host', 'localhost')
  .option('-p, --port <port>', 'FalkorDB port', '6379')
  .option('--embedding', 'Use embedding similarity instead of name matching')
  .option('--threshold <number>', 'Similarity threshold for embedding mode (0.0-1.0)', '0.8')
  .option('--force', 'Re-link all entities (ignore existing ABOUT edges)')
  .action(async (options) => {
    const startTime = Date.now();

    try {
      const client = await getGraphClient();
      await client.ensureIndexes();
      const kgOps = createKnowledgeOperations(client);

      if (options.embedding) {
        // Embedding similarity mode
        const threshold = parseFloat(options.threshold as string);
        if (isNaN(threshold) || threshold < 0 || threshold > 1) {
          console.error('Invalid threshold. Must be between 0.0 and 1.0');
          process.exit(1);
        }

        console.log(`Linking entities by embedding similarity (threshold: ${threshold})...`);
        if (options.force) {
          console.log('Force mode: re-linking all entities');
        }

        const result = await linkByEmbedding(client, kgOps, {
          threshold,
          force: !!options.force,
          onProgress: (current, total) => {
            process.stdout.write(`\r  Processing ${current}/${total} entities...`);
          },
        });

        // Clear progress line
        process.stdout.write('\r' + ' '.repeat(60) + '\r');

        console.log(`\nLinked ${result.linked} entities to code nodes`);
        console.log(`  Skipped: ${result.skipped} (below threshold or no embedding)`);
        console.log(`  Already linked: ${result.alreadyLinked}`);
        console.log(`  Total: ${result.total}`);

        if (result.links.length > 0) {
          console.log('\nLinks created:');
          for (const link of result.links.slice(0, 20)) {
            console.log(
              `  "${link.entityText}" (${link.entityType}) → ${link.targetLabel}:${link.targetValue} [${link.confidence.toFixed(3)}]`,
            );
          }
          if (result.links.length > 20) {
            console.log(`  ... and ${result.links.length - 20} more`);
          }
        }
      } else {
        // Name matching mode
        console.log('Linking entities by name matching...');

        // Get all entities
        const allEntities = await kgOps.searchEntities({ limit: 10000 });
        if (allEntities.length === 0) {
          console.log('No entities in knowledge graph — nothing to link');
          return;
        }

        const inputs = allEntities.map((e) => ({ text: e.text, type: e.type }));

        const result = await linkEntitiesToCode(inputs, client, kgOps, {
          minConfidence: 0.85,
        });

        console.log(`\nLinked ${result.linked} entities to code nodes`);
        console.log(`  Skipped: ${result.skipped} (no match or non-code type)`);
        console.log(`  Total: ${result.total}`);

        if (result.links.length > 0) {
          console.log('\nLinks created:');
          for (const link of result.links.slice(0, 20)) {
            console.log(
              `  "${link.entityText}" (${link.entityType}) → ${link.targetLabel}:${link.targetValue} [${link.confidence}]`,
            );
          }
          if (result.links.length > 20) {
            console.log(`  ... and ${result.links.length - 20} more`);
          }
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Completed in ${elapsed}s`);
    } catch (error) {
      logger.error('Link failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
