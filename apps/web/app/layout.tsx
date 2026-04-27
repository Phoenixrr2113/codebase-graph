import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CodeGraph — Deep Codebase Understanding for AI Agents',
  description: 'CodeGraph builds a queryable knowledge graph of every function, class, and relationship in your codebase — then gives your AI assistant the tools to search, analyze, and navigate it.',
  keywords: ['CodeGraph', 'MCP', 'AI agent', 'codebase', 'knowledge graph', 'tree-sitter', 'FalkorDB', 'developer tools'],
  authors: [{ name: 'CodeGraph' }],
  openGraph: {
    title: 'CodeGraph — Deep Codebase Understanding for AI Agents',
    description: 'Your AI agent doesn\'t understand your codebase. CodeGraph fixes that.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CodeGraph — Deep Codebase Understanding for AI Agents',
    description: 'Your AI agent doesn\'t understand your codebase. CodeGraph fixes that.',
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
