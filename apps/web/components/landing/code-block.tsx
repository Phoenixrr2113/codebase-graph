"use client"

import { useState } from "react"
import { Check, Copy, Terminal } from "lucide-react"
import { cn } from "@/lib/utils"

interface CodeBlockProps {
  code: string
  language?: string
  filename?: string
  showLineNumbers?: boolean
  className?: string
}

export function CodeBlock({ 
  code, 
  language = "bash", 
  filename,
  showLineNumbers = false,
  className 
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const lines = code.split("\n")

  return (
    <div className={cn("rounded-lg border bg-card overflow-hidden", className)}>
      {filename && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Terminal className="h-4 w-4" />
            <span className="font-mono">{filename}</span>
          </div>
          <button
            onClick={copyToClipboard}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="h-4 w-4 text-accent" />
            ) : (
              <Copy className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </div>
      )}
      <div className="relative">
        {!filename && (
          <button
            onClick={copyToClipboard}
            className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-muted transition-colors"
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="h-4 w-4 text-accent" />
            ) : (
              <Copy className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        )}
        <pre className="p-3 sm:p-4 overflow-x-auto no-visible-scrollbar">
          <code className="font-mono text-xs sm:text-sm">
            {lines.map((line, i) => (
              <div key={i} className="flex">
                {showLineNumbers && (
                  <span className="select-none text-muted-foreground/50 w-8 pr-4 text-right">
                    {i + 1}
                  </span>
                )}
                <span>
                  <SyntaxHighlight line={line} language={language} />
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
}

function SyntaxHighlight({ line, language }: { line: string; language: string }) {
  if (language === "json") {
    return <JsonHighlight line={line} />
  }
  if (language === "bash") {
    return <BashHighlight line={line} />
  }
  return <span>{line}</span>
}

function JsonHighlight({ line }: { line: string }) {
  // Simple JSON syntax highlighting
  const parts = line.split(/("(?:[^"\\]|\\.)*")/g)
  
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('"') && part.endsWith('"')) {
          // Check if it's a key (followed by colon in original line)
          const isKey = line.includes(`${part}:`)
          return (
            <span key={i} className={isKey ? "text-[var(--syntax-function)]" : "text-[var(--syntax-string)]"}>
              {part}
            </span>
          )
        }
        // Highlight keywords
        return (
          <span key={i}>
            {part.split(/\b(true|false|null)\b/).map((subpart, j) => {
              if (["true", "false", "null"].includes(subpart)) {
                return <span key={j} className="text-[var(--syntax-keyword)]">{subpart}</span>
              }
              return <span key={j}>{subpart}</span>
            })}
          </span>
        )
      })}
    </>
  )
}

function BashHighlight({ line }: { line: string }) {
  // Simple bash syntax highlighting
  if (line.startsWith("#")) {
    return <span className="text-[var(--syntax-comment)]">{line}</span>
  }
  if (line.startsWith("$")) {
    return (
      <>
        <span className="text-[var(--syntax-variable)]">$</span>
        <span>{line.slice(1)}</span>
      </>
    )
  }
  
  const parts = line.split(/(\s+)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (i === 0 && !part.match(/^\s+$/)) {
          return <span key={i} className="text-[var(--syntax-function)]">{part}</span>
        }
        if (part.startsWith("--") || part.startsWith("-")) {
          return <span key={i} className="text-[var(--syntax-keyword)]">{part}</span>
        }
        if (part.startsWith('"') || part.startsWith("'")) {
          return <span key={i} className="text-[var(--syntax-string)]">{part}</span>
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// Terminal block with animated typing cursor
export function TerminalBlock({ 
  children, 
  title = "Terminal",
  className 
}: { 
  children: React.ReactNode
  title?: string
  className?: string 
}) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden shadow-lg", className)}>
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b bg-muted/50">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-destructive/80" />
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-yellow-500/80" />
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-accent/80" />
        </div>
        <span className="text-xs sm:text-sm text-muted-foreground font-mono ml-1">{title}</span>
      </div>
      <div className="p-3 sm:p-4 font-mono text-xs sm:text-sm overflow-x-auto no-visible-scrollbar">
        {children}
      </div>
    </div>
  )
}
