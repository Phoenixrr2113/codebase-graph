import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { extractCommand } from './commands/extract.js';
import { statusCommand } from './commands/status.js';
import { analyzeCommand } from './commands/analyze.js';
import { queryCommand } from './commands/query.js';
import { searchCommand } from './commands/search.js';
import { serveCommand } from './commands/serve.js';
import { mapCommand } from './commands/map.js';

createLogger({ namespace: 'cli' });

export const cli = new Command()
  .name('codegraph')
  .description('CodeGraph CLI - parse, analyze, and query code knowledge graphs')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose logging');

cli.addCommand(extractCommand);
cli.addCommand(statusCommand);
cli.addCommand(analyzeCommand);
cli.addCommand(queryCommand);
cli.addCommand(searchCommand);
cli.addCommand(serveCommand);
cli.addCommand(mapCommand);
