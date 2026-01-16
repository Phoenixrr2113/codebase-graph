import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CodeGraph - Visual Codebase Knowledge Graph',
  description: 'Visualize your codebase as an interactive knowledge graph',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
