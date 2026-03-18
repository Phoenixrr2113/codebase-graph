"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"

const tier1Languages = [
  { name: "TypeScript", abbr: "TS", color: "#3178C6" },
  { name: "Python", abbr: "PY", color: "#3776AB" },
  { name: "C#", abbr: "C#", color: "#68217A" },
  { name: "Go", abbr: "GO", color: "#00ADD8" },
  { name: "Java", abbr: "JV", color: "#ED8B00" },
  { name: "Rust", abbr: "RS", color: "#CE422B" },
  { name: "PHP", abbr: "HP", color: "#777BB4" },
  { name: "Markdown", abbr: "MD", color: "#083FA1" },
]

const additionalLanguages = [
  "Ruby", "Kotlin", "Swift", "Scala", "Dart", "C", "C++", "Lua", 
  "Elixir", "Erlang", "R", "Haskell", "Bash", "SQL", "YAML", "HTML", "CSS"
]

const capabilities = [
  "Functions & methods",
  "Classes & interfaces", 
  "Import relationships",
  "Call graphs",
]

export function LanguageSupportSection() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [hoveredLang, setHoveredLang] = useState<string | null>(null)

  return (
    <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
            Works with your stack
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Deep understanding for popular languages. Basic support for dozens more.
          </p>
        </motion.div>

        {/* Tier 1 Languages */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-6 sm:mb-8"
        >
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3">
            {tier1Languages.map((lang, i) => (
              <motion.div
                key={lang.name}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                onMouseEnter={() => setHoveredLang(lang.name)}
                onMouseLeave={() => setHoveredLang(null)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "relative flex flex-col items-center gap-1.5 sm:gap-2 p-2 sm:p-3 rounded-lg border transition-all cursor-pointer",
                  hoveredLang === lang.name 
                    ? "bg-card border-accent shadow-lg shadow-accent/10" 
                    : "bg-card border-border hover:border-accent/30"
                )}
              >
                <motion.div
                  animate={{ 
                    scale: hoveredLang === lang.name ? 1.1 : 1,
                  }}
                  transition={{ duration: 0.2 }}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center font-mono text-xs sm:text-sm font-bold"
                  style={{ backgroundColor: `${lang.color}20`, color: lang.color }}
                >
                  {lang.abbr}
                </motion.div>
                <span className="text-[10px] sm:text-xs text-muted-foreground text-center truncate w-full">{lang.name}</span>
                
                {/* Hover tooltip */}
                <AnimatePresence>
                  {hoveredLang === lang.name && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.9 }}
                      className="hidden md:block absolute -bottom-2 left-1/2 -translate-x-1/2 translate-y-full z-10 w-40 p-3 rounded-lg bg-popover border border-border shadow-xl"
                    >
                      <div className="text-xs font-semibold mb-2 text-foreground">Full support:</div>
                      <div className="space-y-1">
                        {capabilities.map((cap) => (
                          <div key={cap} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Check className="h-3 w-3 text-accent shrink-0" />
                            <span className="truncate">{cap}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
          <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-muted-foreground text-center">
            <span className="text-accent font-semibold">Full support</span> — deep extraction and relationship mapping
          </p>
        </motion.div>

        {/* Additional Languages (Collapsible) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-center gap-2 py-2 sm:py-3 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors group"
          >
            <span>Plus 30+ more languages</span>
            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </motion.div>
          </button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="pt-3 sm:pt-4">
                  <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
                    {additionalLanguages.map((lang, i) => (
                      <motion.span
                        key={lang}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.2, delay: i * 0.02 }}
                        className="px-2 sm:px-2.5 py-0.5 sm:py-1 text-[10px] sm:text-xs font-mono rounded bg-muted text-muted-foreground hover:bg-accent/10 hover:text-accent transition-colors cursor-default"
                      >
                        {lang}
                      </motion.span>
                    ))}
                  </div>
                  <p className="mt-3 sm:mt-4 text-[10px] sm:text-xs text-muted-foreground text-center">
                    Basic syntax support with extensible plugin system
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  )
}
