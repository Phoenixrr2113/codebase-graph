import { MessageSquare, Zap, Moon } from "lucide-react"

export function SolutionSection() {
  return (
    <section id="solution" className="relative py-20 md:py-32">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary">
            Meet ControlAI
          </div>
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">An AI That Uses Your Computer For You</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Give it a goal in plain English. Watch it work across your devices. Get results while you do something else.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <div className="group rounded-2xl border border-primary/20 bg-card/50 p-6 transition-all hover:border-primary/40 hover:bg-card md:p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold">Just Tell It What You Need</h3>
            <p className="mt-2 text-muted-foreground">
              &quot;Apply to 20 remote React jobs&quot; or &quot;Find rental properties under $300K in Austin.&quot; No
              coding, no setup wizards.
            </p>
          </div>

          <div className="group rounded-2xl border border-primary/20 bg-card/50 p-6 transition-all hover:border-primary/40 hover:bg-card md:p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Zap className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold">It Actually Does the Work</h3>
            <p className="mt-2 text-muted-foreground">
              Opens apps, fills forms, clicks buttons, navigates websites—on your phone or computer. Real actions, not
              just advice.
            </p>
          </div>

          <div className="group rounded-2xl border border-primary/20 bg-card/50 p-6 transition-all hover:border-primary/40 hover:bg-card md:p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Moon className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold">Runs in the Background</h3>
            <p className="mt-2 text-muted-foreground">
              Complex tasks run for days or weeks. Get notifications on progress. Approve big decisions. Live your life
              in between.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
