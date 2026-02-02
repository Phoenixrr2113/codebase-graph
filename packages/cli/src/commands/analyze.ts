import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { createClient, createQueries } from '@codegraph/graph';

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
      const client = await createClient({
        host: options.host,
        port: parseInt(options.port),
        graphName: options.graph,
      });

      const queries = createQueries(client);
      let result: unknown;

      switch (type) {
        case 'callers': {
          const callers = await queries.getFunctionCallers(target);
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

      await client.close();

    } catch (error) {
      logger.error('Analysis failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
