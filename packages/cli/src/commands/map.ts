import { Command } from 'commander';
import { createLogger } from '@codegraph/logger';
import { createClient, createQueries } from '@codegraph/graph';
import { writeFileSync } from 'fs';

const logger = createLogger({ namespace: 'cli:map' });

export const mapCommand = new Command('map')
  .description('Generate a repository map showing file structure')
  .argument('[path]', 'Path prefix to filter', '')
  .option('-g, --graph <name>', 'Graph name', 'codegraph')
  .option('-h, --host <host>', 'FalkorDB host', 'localhost')
  .option('-p, --port <port>', 'FalkorDB port', '6379')
  .option('-l, --limit <n>', 'Max nodes to include', '100')
  .option('-o, --output <file>', 'Output file (defaults to stdout)')
  .option('--json', 'Output as JSON')
  .action(async (pathPrefix, options) => {
    logger.info(`Generating map for: ${pathPrefix || '(all)'}`);

    try {
      const client = await createClient({
        host: options.host,
        port: parseInt(options.port),
        graphName: options.graph,
      });

      const queries = createQueries(client);
      const result = await queries.getFullGraph(parseInt(options.limit), pathPrefix || undefined);

      let output: string;

      if (options.json) {
        output = JSON.stringify(result, null, 2);
      } else {
        const lines: string[] = [];
        lines.push(`Repository Map (${result.nodes.length} nodes, ${result.edges.length} edges)`);
        lines.push('');
        
        const files = result.nodes.filter(n => n.label === 'File');
        const byDir: Record<string, typeof files> = {};
        
        for (const file of files) {
          const path = file.data.path;
          const parts = path.split('/');
          const dir = parts.slice(0, -1).join('/') || '.';
          if (!byDir[dir]) byDir[dir] = [];
          byDir[dir].push(file);
        }
        
        for (const [dir, dirFiles] of Object.entries(byDir).sort()) {
          lines.push(`${dir}/`);
          for (const f of dirFiles) {
            const fileName = f.data.path.split('/').pop();
            lines.push(`  ${fileName}`);
            
            const children = result.nodes.filter(n => 
              n.label !== 'File' && 
              result.edges.some(e => e.source === f.id && e.target === n.id && e.label === 'CONTAINS')
            );
            for (const child of children.slice(0, 5)) {
              lines.push(`    - ${child.label}: ${child.displayName}`);
            }
            if (children.length > 5) {
              lines.push(`    ... and ${children.length - 5} more`);
            }
          }
          lines.push('');
        }
        
        output = lines.join('\n');
      }

      if (options.output) {
        writeFileSync(options.output, output);
        console.log(`Map written to: ${options.output}`);
      } else {
        console.log(output);
      }

      await client.close();

    } catch (error) {
      logger.error('Map generation failed', error);
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
