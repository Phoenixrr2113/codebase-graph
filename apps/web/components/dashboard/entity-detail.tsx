'use client'

import type { GraphNode } from './graph-canvas'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface EntityDetailProps {
  node: GraphNode | null
}

/** Properties to display with nice labels */
const DISPLAY_PROPS: Record<string, string> = {
  filePath: 'File',
  startLine: 'Start Line',
  endLine: 'End Line',
  isExported: 'Exported',
  isAsync: 'Async',
  params: 'Parameters',
  returnType: 'Return Type',
  signature: 'Signature',
  complexity: 'Complexity',
  cognitiveComplexity: 'Cognitive Complexity',
  loc: 'Lines of Code',
  callerCount: 'Called By',
  importerCount: 'Imported By',
  confidence: 'Confidence',
  relevanceScore: 'Relevance',
}

export function EntityDetail({ node }: EntityDetailProps) {
  if (!node) {
    return (
      <div className="entity-detail flex h-full items-center justify-center bg-card p-4" data-testid="entity-detail">
        <p className="text-sm text-muted-foreground">Select a node to view details</p>
      </div>
    )
  }

  const displayableProps = Object.entries(node.properties)
    .filter(([key]) => key !== 'id' && key !== 'label' && key !== 'type' && DISPLAY_PROPS[key])
    .map(([key, value]) => ({ key, label: DISPLAY_PROPS[key]!, value }))

  const otherProps = Object.entries(node.properties)
    .filter(([key]) => key !== 'id' && key !== 'label' && key !== 'type' && !DISPLAY_PROPS[key])
    .filter(([, value]) => value != null && value !== '' && value !== '{}')

  return (
    <div className="entity-detail flex h-full flex-col overflow-y-auto border-l border-border bg-card" data-testid="entity-detail">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{node.type}</Badge>
        </div>
        <h2 className="mt-2 text-lg font-semibold leading-tight">{node.label}</h2>
      </div>

      <div className="flex-1 space-y-1 p-4">
        {displayableProps.map(({ key, label, value }) => (
          <div key={key} className="flex items-baseline justify-between gap-2 py-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="truncate text-right text-sm font-mono">
              {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
            </span>
          </div>
        ))}

        {otherProps.length > 0 && (
          <>
            <Separator className="my-3" />
            <div className="text-xs font-medium text-muted-foreground">Other Properties</div>
            {otherProps.map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-2 py-1">
                <span className="text-xs text-muted-foreground">{key}</span>
                <span className="max-w-[60%] truncate text-right text-xs font-mono">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
