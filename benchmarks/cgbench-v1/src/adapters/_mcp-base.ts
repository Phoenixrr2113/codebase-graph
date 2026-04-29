import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface MCPSpawnConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export async function spawnMCPClient(cfg: MCPSpawnConfig): Promise<Client> {
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args,
    env: cfg.env ?? (process.env as Record<string, string>),
  });
  const client = new Client(
    { name: 'cgbench-v1', version: '0.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

export async function callMCPTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`MCP tool ${name} failed: ${JSON.stringify(result.content)}`);
  }
  // MCP tool results carry their payload as a JSON-serialized string in
  // content[0].text (CodeGraph's server wraps every return value with
  // JSON.stringify). Parse it here so callers get the actual data shape.
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (first && typeof first === 'object' && 'text' in first && typeof first.text === 'string') {
    try {
      return JSON.parse(first.text) as T;
    } catch {
      // Not valid JSON (plain string response) — return text directly
      return first.text as unknown as T;
    }
  }
  return result.content as T;
}

export async function closeMCPClient(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // best-effort cleanup; some clients log shutdown noise
  }
}
