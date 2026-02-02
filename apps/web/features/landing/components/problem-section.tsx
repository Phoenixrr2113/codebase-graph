import { Clock, RefreshCw, AlertCircle } from "lucide-react"

export function ProblemSection() {
  return (
    <section id="problem" className="py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">You Have Better Things to Do</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            How much of your day is spent on repetitive digital tasks?
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card/50 p-6 md:p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <Clock className="h-6 w-6 text-destructive" />
            </div>
            <h3 className="mt-4 text-xl font-semibold">Hours Lost Daily</h3>
            <p className="mt-2 text-muted-foreground">
              Copy-pasting between apps. Filling out forms. Following up on emails. The same clicks, every single day.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card/50 p-6 md:p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/10">
              <RefreshCw className="h-6 w-6 text-warning" />
            </div>
            <h3 className="mt-4 text-xl font-semibold">Endless Repetition</h3>
            <p className="mt-2 text-muted-foreground">
              Applying to jobs. Researching leads. Checking prices. Tasks that should be automated but never quite are.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card/50 p-6 md:p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <AlertCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-xl font-semibold">AI That Just Talks</h3>
            <p className="mt-2 text-muted-foreground">
              ChatGPT can write the email, but you still have to send it. Current AI assistants advise—they don&apos;t
              act.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
