#!/usr/bin/env node
/**
 * Post-install script — prints setup instructions after npm install.
 */

const message = `
╔══════════════════════════════════════════════════════════════╗
║                    CodeGraph MCP Server                      ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. Get a license key at https://polar.sh/codegraph          ║
║  2. Get API keys:                                            ║
║     - Voyage AI: https://dash.voyageai.com (embeddings)      ║
║     - Jina AI:   https://jina.ai (reranking)                 ║
║  3. Add to your .mcp.json:                                   ║
║                                                              ║
║     {                                                        ║
║       "mcpServers": {                                        ║
║         "codegraph": {                                       ║
║           "command": "codegraph-mcp",                        ║
║           "env": {                                           ║
║             "CODEGRAPH_LICENSE": "your-key",                 ║
║             "VOYAGE_API_KEY": "your-key",                    ║
║             "JINA_API_KEY": "your-key"                       ║
║           }                                                  ║
║         }                                                    ║
║       }                                                      ║
║     }                                                        ║
║                                                              ║
║  Docs: https://codegraph.dev/docs                            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

console.log(message);
