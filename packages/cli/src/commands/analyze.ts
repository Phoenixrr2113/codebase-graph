import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { createQueries } from '@codegraph/graph';
import { codeGraphService, getGraphClient } from '@codegraph/core';

const logger = createLogger({ namespace: 'cli:analyze' });

export const analyzeCommand = new Command('analyze')
  .description('Run analysis on the code graph')
  .argument('<type>', 'Analysis type: callers, deps')
  .argument('<target>', 'Target function name or file path')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('-h, --host <host>', 'FalkorDB host', 'localhost')
  .option('-p, --port <port>', 'FalkorDB port', '6379')
  .option('--depth <n>', 'Analysis depth', '3')
  .option('--json', 'Output as JSON')
  .action(async (type, target, options) => {
    logger.info(`Analyzing: ${type} ${target}`);

    try {
      let result: unknown;

      switch (type) {
        case 'callers': {
          const callers = await codeGraphService.getFunctionCallers(target);
          result = {
            function: target,
            callers: callers.map(c => ({
              name: c.name,
              file: c.filePath,
              line: c.startLine,
            })),
            count: callers.length,
          };
          break;
        }

        case 'deps': {
          // getDependencyTree is a visualization-oriented query that stays in @codegraph/graph
          const client = await getGraphClient();
          const queries = createQueries(client);
          const deps = await queries.getDependencyTree(target, parseInt(options.depth));
          result = deps;
          break;
        }

        default:
          console.error(`Unknown analysis type: ${type}`);
          console.error('Valid types: callers, deps');
          process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n--- ${type.toUpperCase()} Analysis: ${target} ---\n`);
        console.log(JSON.stringify(result, null, 2));
      }

    } catch (error) {
      logger.error('Analysis failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
