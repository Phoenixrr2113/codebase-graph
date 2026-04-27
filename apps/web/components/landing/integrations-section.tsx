"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { integrations } from "./integrations-data"
export { integrations } from "./integrations-data"

interface IntegrationsSectionProps {
  highlighted: Record<string, string>
}

export function IntegrationsSection({ highlighted }: IntegrationsSectionProps) {
  const [activeId, setActiveId] = useState(integrations[0].id)
  const [copied, setCopied] = useState(false)

  const active = integrations.find((i) => i.id === activeId) ?? integrations[0]
  const activeHtml = highlighted[active.id] ?? `<pre><code>${active.snippet}</code></pre>`

  const onCopy = async () => {
    await navigator.clipboard.writeText(active.snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <section
      id="integrations"
      className="py-16 sm:py-20 md:py-24 px-4 sm:px-6"
    >
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4 text-balance">
            Drops into your existing setup.
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            MCP for hosts; middleware for AI SDKs; hook scripts for Claude Code.
          </p>
        </motion.div>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-2 justify-center mb-4">
          {integrations.map((i) => (
            <button
              key={i.id}
              onClick={() => setActiveId(i.id)}
              className={cn(
                "px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-full border transition-colors",
                activeId === i.id
                  ? "bg-accent text-accent-foreground border-accent"
                  : "bg-card text-muted-foreground border-border hover:text-foreground"
              )}
              aria-pressed={activeId === i.id}
            >
              {i.label}
            </button>
          ))}
        </div>

        {/* Snippet pane */}
        <motion.div
          key={active.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-xl border bg-card overflow-hidden shadow-lg max-w-3xl mx-auto"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              </div>
              <span className="font-mono ml-2 truncate">{active.filename}</span>
            </div>
            <button
              onClick={onCopy}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
              aria-label="Copy snippet"
            >
              {copied ? (
                <Check className="h-4 w-4 text-accent" />
              ) : (
                <Copy className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
          <div
            className="code-snippet code-snippet--wide text-xs sm:text-sm"
            dangerouslySetInnerHTML={{ __html: activeHtml }}
          />
        </motion.div>

        <p className="mt-6 text-center text-[11px] sm:text-xs text-muted-foreground">
          MCP server is not yet published to npm — paths above point at a local build of the repo.
          When <code className="font-mono">@codegraph/mcp</code> ships, these snippets will use{" "}
          <code className="font-mono">npx @codegraph/mcp</code> instead.
        </p>
      </div>
    </section>
  )
}
