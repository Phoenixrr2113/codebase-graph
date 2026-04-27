"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Github, FileText, GitGraph, Mail, ArrowRight, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

const techStats = [
  "5 first-class languages + 30 more via tree-sitter",
  "Local-first architecture",
  "Knowledge graph powered",
  "AI-powered reranking",
  "Incremental indexing",
  "Zero cloud required",
]


const footerLinks = [
  { label: "Docs", href: "https://github.com/Phoenixrr2113/codebase-graph#readme", icon: FileText },
  { label: "GitHub", href: "https://github.com/Phoenixrr2113/codebase-graph", icon: Github },
]

export function TechCredibilityBar() {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="py-4 sm:py-6 px-4 sm:px-6 border-y border-border bg-muted/30 overflow-hidden"
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-4 gap-y-1.5 sm:gap-y-2 text-[10px] sm:text-xs font-mono text-muted-foreground">
          {techStats.map((stat, i) => (
            <span key={stat} className="flex items-center gap-1.5 sm:gap-2">
              {i > 0 && <span className="hidden sm:inline text-border">|</span>}
              {stat}
            </span>
          ))}
        </div>
      </div>
    </motion.section>
  )
}

export function NewsletterSection() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setStatus("loading")
    // Buttondown API integration placeholder
    // Replace with your Buttondown username when ready
    try {
      const res = await fetch("https://api.buttondown.com/v1/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_address: email }),
      })
      if (res.ok || res.status === 201) {
        setStatus("success")
        setEmail("")
      } else {
        setStatus("error")
      }
    } catch {
      // Graceful fallback - open mailto as backup
      setStatus("error")
    }
  }

  return (
    <section className="py-12 sm:py-16 px-4 sm:px-6">
      <div className="max-w-xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-accent/10 border border-accent/20 mx-auto mb-4">
            <Mail className="h-5 w-5 sm:h-6 sm:w-6 text-accent" />
          </div>
          <h3 className="text-lg sm:text-xl md:text-2xl font-bold mb-2">
            Stay in the loop
          </h3>
          <p className="text-sm sm:text-base text-muted-foreground mb-6">
            Get notified about new features, language support, and launch updates. No spam.
          </p>

          {status === "success" ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-center gap-2 text-accent font-medium"
            >
              <Check className="h-5 w-5" />
              <span>You&apos;re on the list!</span>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 sm:gap-3 max-w-md mx-auto">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
              <Button
                type="submit"
                disabled={status === "loading"}
                className="bg-accent text-accent-foreground hover:bg-accent/90 group"
              >
                {status === "loading" ? "Subscribing..." : "Subscribe"}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </form>
          )}
          {status === "error" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Something went wrong. Try again or email us directly.
            </p>
          )}
        </motion.div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="py-8 sm:py-12 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
          {/* Logo */}
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="flex items-center gap-2 sm:gap-2.5"
          >
            <div className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-accent/10 border border-accent/20">
              <GitGraph className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
            </div>
            <span className="font-semibold text-sm sm:text-base">CodeGraph</span>
          </motion.div>

          {/* Links */}
          <nav className="flex items-center gap-3 sm:gap-5" aria-label="Footer links">
            {footerLinks.map((link) => (
              <motion.a
                key={link.label}
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                whileHover={{ scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md p-1 -m-1"
                aria-label={link.label}
              >
                <link.icon className="h-4 w-4 sm:h-4 sm:w-4" />
                <span className="sr-only sm:not-sr-only">{link.label}</span>
              </motion.a>
            ))}
          </nav>
        </div>

        <div className="mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-border text-center">
          <p className="text-xs sm:text-sm text-muted-foreground">
            Built by a developer, for developers.
          </p>
          <p className="mt-1.5 sm:mt-2 text-[10px] sm:text-xs text-muted-foreground/70">
            2026 CodeGraph. MIT licensed.
          </p>
        </div>
      </div>
    </footer>
  )
}
