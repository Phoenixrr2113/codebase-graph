import { Search, Clock, FileText, Users, Layers, Boxes } from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface Feature {
  icon: LucideIcon
  title: string
  description: string
  snippet: string
}

// All feature copy and snippets traced to CLAUDE.md tool reference.
export const features: Feature[] = [
  {
    icon: Search,
    title: "Search pipeline",
    description:
      "Vector embeddings → cross-encoder reranking → graph enrichment. Returns symbols with their callers, callees, complexity, and linked knowledge.",
    snippet: `search({\n  action: "find",\n  query: "authentication"\n})`,
  },
  {
    icon: Clock,
    title: "Bitemporal knowledge",
    description:
      "Every fact carries valid_at and invalid_at. Query the graph as it existed on a past date, see full timelines, watch supersession happen.",
    snippet: `knowledge({\n  action: "recall",\n  text: "AuthModule",\n  at: "2026-03-01T00:00:00Z"\n})`,
  },
  {
    icon: FileText,
    title: "Document ingestion",
    description:
      "Drop a PDF, DOCX, HTML, CSV, or URL into knowledge.add(). It chunks, embeds, extracts entities, and links them into the same graph as the code.",
    snippet: `knowledge({\n  action: "add",\n  input: "/path/to/spec.pdf"\n})`,
  },
  {
    icon: Users,
    title: "Speaker entities",
    description:
      "Ingest a multi-turn conversation; CodeGraph creates Person nodes with SAID edges to facts. Ask 'what has Alice said about retries?' and get an answer.",
    snippet: `knowledge({\n  action: "ingest_conversation",\n  text: "Alice: let's use Redis...",\n  source: "standup"\n})`,
  },
  {
    icon: Layers,
    title: "MCP App UI panel",
    description:
      "The graph_explorer MCP tool ships as an App UI panel that renders the Graph Explorer canvas inside Claude Desktop or Cursor — interactive, in-conversation.",
    snippet: `// Surfaced automatically when CodeGraph\n// is configured as an MCP server`,
  },
  {
    icon: Boxes,
    title: "Drop-in middleware",
    description:
      "Wrap any Vercel AI SDK model with withCodeGraph(); register a Mastra processor with createCodeGraphProcessor(). Your existing agent gets graph-aware context.",
    snippet: `import { withCodeGraph }\n  from "@codegraph/tools/vercel"\n\nconst model = withCodeGraph(\n  openai("gpt-4o")\n)`,
  },
]
