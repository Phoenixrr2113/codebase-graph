import { createClient } from '../../../index';

interface WorkerCommand {
  type: 'close' | 'count';
}

const dataPath = process.env['OWNERSHIP_DATA_PATH'];
const graphName = process.env['OWNERSHIP_GRAPH_NAME'] ?? 'ownership';
const createMarker = process.env['OWNERSHIP_CREATE_MARKER'] === '1';

if (!dataPath) throw new Error('OWNERSHIP_DATA_PATH is required');

const client = await createClient({
  driver: 'falkordblite',
  databasePath: dataPath,
  graphName,
});

if (createMarker) {
  await client.query('CREATE (:OwnershipMarker {value: 1})');
}

process.send?.({ type: 'ready', pid: process.pid });

process.on('message', (value: unknown) => {
  void (async (): Promise<void> => {
    const command = value as WorkerCommand;
    if (command.type === 'count') {
      const result = await client.roQuery<{ count: number }>(
        'MATCH (n:OwnershipMarker) RETURN count(n) AS count',
      );
      process.send?.({ type: 'count', count: result.data[0]?.count ?? 0 });
      return;
    }

    if (command.type === 'close') {
      await client.close();
      process.send?.({ type: 'closed' });
      process.exit(0);
    }
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.send?.({ type: 'error', message });
    process.exit(1);
  });
});
