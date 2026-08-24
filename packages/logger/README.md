# @codegraph/logger

Structured logging and function tracing for CodeGraph. Zero external dependencies.

This is a private workspace package consumed by the CodeGraph services.

## Usage

### Basic Logging

```ts
import { createLogger, logger } from '@codegraph/logger';

// Use the default root logger
logger.info('Server started');
logger.error('Connection failed', { host, port });

// Create a namespaced logger
const log = createLogger({ namespace: 'indexer' });
log.info('Parsing files...');
log.debug('Processing file', filePath);

// Create child loggers (namespaces chain with ":")
const childLog = log.child('parser');
// Logs as [indexer:parser]
childLog.warn('Skipping unsupported file');
```

### Configuration

```ts
const log = createLogger({
  level: 'debug',        // Minimum level: 'debug' | 'info' | 'warn' | 'error'
  namespace: 'myModule', // Prefix shown in log output
  colors: true,          // ANSI colored output (default: true in Node.js)
  timestamps: true,      // ISO 8601 timestamps (default: true)
  stderr: false,         // Force all output to stderr (for MCP stdio transport)
});
```

### Environment Variables

- `LOG_LEVEL`: set minimum log level (e.g., `debug`, `info`, `warn`, `error`)
- `CODEGRAPH_LOG_STDERR`: set to `true` or `1` to route all log output to stderr (required when running as an MCP server over stdio, to keep stdout clean for JSON-RPC)

### Function Tracing

Three tracing utilities for measuring function execution time, inputs, and outputs:

```ts
import { trace, traced, withTrace } from '@codegraph/logger';

// Method decorator
class MyService {
  @trace()
  async doWork(input: string): Promise<Result> {
    // ...
  }
}

// Wrap a standalone function
const myFn = traced('myFunction', (x: number) => x * 2);

// Inline trace block
const result = await withTrace('loadData', async () => {
  return await fetchData();
});
```

Tracing is controlled by environment variables:

- `TRACE_ENABLED`: set to `true` to enable tracing
- `TRACE_LEVEL`: `verbose` (args + result + duration), `minimal` (name + duration), or `off`
- `TRACE_INCLUDE`: comma-separated glob patterns to include (e.g., `API:*,DB:*`)
- `TRACE_EXCLUDE`: comma-separated glob patterns to exclude

### Error Utilities

```ts
import { toErrorMessage } from '@codegraph/logger';

try {
  await riskyOperation();
} catch (err) {
  // Safely extracts a string message from Error, string, or unknown
  console.error(toErrorMessage(err));
}
```
