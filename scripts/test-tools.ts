#!/usr/bin/env npx tsx
/**
 * Quick tool tester — call any MCP tool and see results
 */
process.env.CODEGRAPH_RAW_TOOLS = 'true';

const { handleToolCall } = await import('../packages/mcp-server/dist/tools/consolidated.js');

const toolName = process.argv[2];
const argsJson = process.argv[3] || '{}';

if (!toolName) {
  console.log('Usage: npx tsx scripts/test-tools.ts <tool_name> [args_json]');
  console.log('  npx tsx scripts/test-tools.ts search \'{"query":"handleToolCall"}\'');
  console.log('  npx tsx scripts/test-tools.ts find_symbol \'{"name":"handleToolCall"}\'');
  console.log('  npx tsx scripts/test-tools.ts get_stats');
  process.exit(0);
}

const args = JSON.parse(argsJson);
console.log(`Tool: ${toolName}`);
console.log(`Args: ${JSON.stringify(args)}`);
console.log('---');

try {
  const result = await handleToolCall(toolName, args);
  const text = result.content?.[0]?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(text);
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
} catch (e: any) {
  console.error('ERROR:', e.message);
}
