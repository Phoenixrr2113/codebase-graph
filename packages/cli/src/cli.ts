import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { extractCommand } from './commands/extract';
import { statusCommand } from './commands/status';
import { analyzeCommand } from './commands/analyze';
import { queryCommand } from './commands/query';
import { searchCommand } from './commands/search';
import { serveCommand } from './commands/serve';
import { mapCommand } from './commands/map';
import { embedCommand } from './commands/embed';
import { linkCommand } from './commands/link';

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
cli.addCommand(embedCommand);
cli.addCommand(linkCommand);
