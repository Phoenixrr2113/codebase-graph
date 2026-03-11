import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'cli:serve' });

export const serveCommand = new Command('serve')
  .description('Start the MCP server (runs the @codegraph/mcp-server package)')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('--db-host <host>', 'FalkorDB host', 'localhost')
  .option('--db-port <port>', 'FalkorDB port', '6379')
  .action(async (options) => {
    logger.info(`Starting MCP server...`);

    process.env.FALKORDB_HOST = options.dbHost;
    process.env.FALKORDB_PORT = options.dbPort;
    process.env.FALKORDB_GRAPH = options.graph;

    console.log(`\nTo run the MCP server, use:`);
    console.log(`  FALKORDB_HOST=${options.dbHost} FALKORDB_PORT=${options.dbPort} FALKORDB_GRAPH=${options.graph} pnpm --filter @codegraph/mcp-server start`);
    console.log(`\nOr add to your Claude desktop config:`);
    console.log(`  {`);
    console.log(`    "command": "node",`);
    console.log(`    "args": ["path/to/packages/mcp-server/dist/index.js"],`);
    console.log(`    "env": {`);
    console.log(`      "FALKORDB_HOST": "${options.dbHost}",`);
    console.log(`      "FALKORDB_PORT": "${options.dbPort}",`);
    console.log(`      "FALKORDB_GRAPH": "${options.graph}"`);
    console.log(`    }`);
    console.log(`  }`);
  });
