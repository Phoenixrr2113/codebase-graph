import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CodeGraph | Local-first code intelligence for AI agents',
  description: 'CodeGraph indexes supported code structure, relationships, git history, and project knowledge into a local-first graph for AI agents and developers.',
  keywords: ['CodeGraph', 'MCP', 'AI agent', 'codebase', 'knowledge graph', 'tree-sitter', 'FalkorDB', 'developer tools'],
  authors: [{ name: 'CodeGraph' }],
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
    ],
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'CodeGraph | Local-first code intelligence for AI agents',
    description: 'Index supported code structure, relationships, git history, and project knowledge into a graph your tools can query.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CodeGraph | Local-first code intelligence for AI agents',
    description: 'Index supported code structure, relationships, git history, and project knowledge into a graph your tools can query.',
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
        {process.env.VERCEL === '1' ? <Analytics /> : null}
      </body>
    </html>
  )
}
