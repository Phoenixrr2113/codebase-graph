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

const DEBUG_MCP = process.env['CGBENCH_DEBUG_MCP'] === '1';

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      parts.push(`${k}="${v.length > 60 ? v.slice(0, 57) + '...' : v}"`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      parts.push(`${k}=${v}`);
    } else if (Array.isArray(v)) {
      parts.push(`${k}=[${v.length}]`);
    } else {
      parts.push(`${k}=<obj>`);
    }
  }
  return parts.join(' ');
}

export async function callMCPTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T> {
  const t0 = Date.now();
  if (DEBUG_MCP) {
    console.error(`[mcp] -> ${name} ${summarizeArgs(args)}`);
  }
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    timeoutMs !== undefined ? { timeout: timeoutMs } : undefined,
  );
  if (result.isError) {
    if (DEBUG_MCP) {
      console.error(`[mcp] !! ${name} (${Date.now() - t0}ms) ERROR`);
    }
    throw new Error(`MCP tool ${name} failed: ${JSON.stringify(result.content)}`);
  }
  if (DEBUG_MCP) {
    console.error(`[mcp] <- ${name} (${Date.now() - t0}ms)`);
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
