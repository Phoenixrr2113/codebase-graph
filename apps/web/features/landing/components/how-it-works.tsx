import { MessageCircle, Smartphone, Coffee, CheckCircle2 } from "lucide-react"

const steps = [
  {
    number: "01",
    icon: MessageCircle,
    title: "Describe Your Goal",
    description: "Tell the AI what you want to accomplish in plain language. Complex or simple—it understands.",
    example: '"Monitor competitor prices and alert me when they drop below ours"',
  },
  {
    number: "02",
    icon: Smartphone,
    title: "Connect Your Devices",
    description: "Link your phone, laptop, or desktop. The AI can see and control them from any browser.",
    example: "Android via USB, Windows/Mac via a lightweight app",
  },
  {
    number: "03",
    icon: Coffee,
    title: "Let It Work",
    description: "The AI figures out the steps, navigates apps, fills forms, and handles the tedious parts.",
    example: "Runs 24/7, updates you on progress, asks when it needs input",
  },
  {
    number: "04",
    icon: CheckCircle2,
    title: "Review & Approve",
    description: "You stay in control of important decisions. Approve purchases, review drafts, confirm submissions.",
    example: "Get results without doing the grunt work",
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">How It Works</h2>
          <p className="mt-4 text-lg text-muted-foreground">From request to results in four simple steps.</p>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <div key={step.title} className="relative">
              {index < steps.length - 1 && (
                <div className="absolute right-0 top-8 hidden h-px w-full bg-gradient-to-r from-primary/50 to-transparent lg:block" />
              )}
              <div className="rounded-2xl border border-border bg-card p-6">
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-2xl font-bold text-primary">{step.number}</span>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <step.icon className="h-5 w-5" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
                <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground italic">
                  {step.example}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
