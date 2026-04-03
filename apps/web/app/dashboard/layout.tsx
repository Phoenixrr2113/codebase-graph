export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div style={{ height: '100dvh', width: '100vw' }} className="overflow-hidden bg-background text-foreground">
      {children}
    </div>
  )
}
