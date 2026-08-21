import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface StatCardProps {
  title: string
  value?: string | number
  description?: string
  icon?: React.ReactNode
  loading?: boolean
  error?: string
  onRetry?: () => void
}

export function StatCard({
  title,
  value,
  description,
  loading = false,
  error,
  onRetry,
}: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <div role="alert" className="space-y-2">
            <p className="text-xs text-red-400">{error}</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry} className="h-7 text-xs">
                Retry
              </Button>
            )}
          </div>
        ) : loading ? (
          <p role="status" className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        {description && !error && !loading && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}
