"use client"

import { motion } from "framer-motion"
import { Search, Clock, FileText, Users, Layers, Boxes } from "lucide-react"

// All feature copy and snippets traced to CLAUDE.md tool reference.
const features = [
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
    snippet: `import { withCodeGraph } from\n  "@codegraph/tools/vercel"\nconst model = withCodeGraph(openai("gpt-4o"))`,
  },
]

export function FeaturesGridSection() {
  return (
    <section
      id="features"
      className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 bg-muted/20 border-y border-border"
    >
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12 sm:mb-16"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4 text-balance">
            Everything an agent needs to navigate your codebase.
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Six capabilities, one graph. Each one exposed through MCP, the AI SDK, or both.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {features.map((feature, i) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                whileHover={{ y: -4 }}
                className="group p-5 sm:p-6 rounded-xl border border-border bg-card hover:border-accent/40 transition-all flex flex-col"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/10 border border-accent/20 mb-4 group-hover:scale-110 transition-transform">
                  <Icon className="h-5 w-5 text-accent" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold mb-2">
                  {feature.title}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed mb-4 flex-1">
                  {feature.description}
                </p>
                <pre className="rounded-md border border-border bg-muted/50 p-3 text-[11px] sm:text-xs font-mono overflow-x-auto whitespace-pre">
                  <code>{feature.snippet}</code>
                </pre>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
