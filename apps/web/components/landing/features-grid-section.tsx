"use client"

import { motion } from "framer-motion"
import { features } from "./features-data"
export { features } from "./features-data"

interface FeaturesGridSectionProps {
  highlighted: string[]
}

export function FeaturesGridSection({ highlighted }: FeaturesGridSectionProps) {
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
                <div
                  className="code-snippet rounded-md border border-border bg-muted/30 overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: highlighted[i] ?? `<pre><code>${feature.snippet}</code></pre>` }}
                />
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
