import { Smartphone, Monitor, Globe } from "lucide-react"

export function PlatformCapabilities() {
  return (
    <section id="platforms" className="relative py-20 md:py-32">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-accent/5 to-transparent" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Works on Your Devices</h2>
          <p className="mt-4 text-lg text-muted-foreground">Control from any browser. No complicated setup.</p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 text-primary">
              <Smartphone className="h-8 w-8" />
            </div>
            <h3 className="mt-6 text-xl font-semibold">Android</h3>
            <p className="mt-2 text-muted-foreground">
              Connect via USB. No app to install. Full control of any Android device.
            </p>
            <p className="mt-4 text-sm text-primary">Just enable USB debugging</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 text-primary">
              <Monitor className="h-8 w-8" />
            </div>
            <h3 className="mt-6 text-xl font-semibold">Windows, Mac, Linux</h3>
            <p className="mt-2 text-muted-foreground">
              Lightweight agent runs in the background. Low latency, smooth control.
            </p>
            <p className="mt-4 text-sm text-primary">One-click install</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 text-primary">
              <Globe className="h-8 w-8" />
            </div>
            <h3 className="mt-6 text-xl font-semibold">Control From Anywhere</h3>
            <p className="mt-2 text-muted-foreground">
              Access everything from any web browser. Phone, tablet, or computer.
            </p>
            <p className="mt-4 text-sm text-primary">No software on the controller</p>
          </div>
        </div>
      </div>
    </section>
  )
}
