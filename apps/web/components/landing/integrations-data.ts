export interface Integration {
  id: string
  label: string
  filename: string
  lang: "json" | "ts" | "bash"
  snippet: string
}

export const integrations: Integration[] = [
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    filename: "claude_desktop_config.json",
    lang: "json",
    snippet: `{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": ["~/codebase-graph/packages/mcp-server/dist/index.js"],
      "env": { "CODEGRAPH_DRIVER": "embedded" }
    }
  }
}`,
  },
  {
    id: "cursor",
    label: "Cursor",
    filename: ".cursor/mcp.json",
    lang: "json",
    snippet: `{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": ["~/codebase-graph/packages/mcp-server/dist/index.js"]
    }
  }
}`,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    filename: "Terminal",
    lang: "bash",
    snippet: `# Add the MCP server (after building)
claude mcp add codegraph \\
  node ~/codebase-graph/packages/mcp-server/dist/index.js`,
  },
  {
    id: "vercel-ai-sdk",
    label: "Vercel AI SDK",
    filename: "agent.ts",
    lang: "ts",
    snippet: `import { openai } from "@ai-sdk/openai"
import { withCodeGraph } from "@codegraph/tools/vercel"

const model = withCodeGraph(openai("gpt-4o"))
// Now every generateText call gets graph-aware context tools.`,
  },
  {
    id: "mastra",
    label: "Mastra",
    filename: "mastra.config.ts",
    lang: "ts",
    snippet: `import { Mastra } from "@mastra/core"
import { createCodeGraphProcessor } from "@codegraph/tools/mastra"

export const mastra = new Mastra({
  processors: [createCodeGraphProcessor()],
})`,
  },
  {
    id: "claude-code-hooks",
    label: "Claude Code Hooks",
    filename: ".claude-plugin/hooks/post-tool-use.sh",
    lang: "bash",
    snippet: `#!/usr/bin/env bash
# Re-extract after file edits so the graph stays fresh.
exec node ~/codebase-graph/packages/cli/dist/index.js \\
  extract .`,
  },
]
