"use client"

import { useState, useRef, useEffect } from "react"
import {
  ArrowLeft,
  Send,
  Bot,
  User,
  Clock,
  Zap,
  Play,
  Check,
  Smartphone,
  Monitor,
  ChevronDown,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface AutomationCreateProps {
  onBack: () => void
  onCreated: (automationId: string) => void
}

type SetupStep = "describe" | "configure" | "confirm"

interface Message {
  id: string
  role: "user" | "agent"
  content: string
  timestamp: Date
  options?: {
    type: "trigger" | "device" | "credentials"
    choices: { id: string; label: string; description?: string; icon?: typeof Clock }[]
  }
  configPreview?: AutomationConfig
}

interface AutomationConfig {
  name: string
  description: string
  trigger: {
    type: "schedule" | "event" | "manual"
    detail: string
  }
  device: string
  credentials: string[]
  actions: string[]
}

const devices = [
  { id: "macbook", name: "MacBook Pro", type: "desktop", icon: Monitor },
  { id: "pixel", name: "Pixel 8 Pro", type: "android", icon: Smartphone },
  { id: "windows", name: "Windows Desktop", type: "desktop", icon: Monitor },
]

const triggerOptions = [
  { id: "schedule", label: "On a schedule", description: "Run at specific times", icon: Clock },
  { id: "event", label: "When something happens", description: "Trigger on events", icon: Zap },
  { id: "manual", label: "Only when I ask", description: "Run on demand", icon: Play },
]

export function AutomationCreate({ onBack, onCreated }: AutomationCreateProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "agent",
      content:
        "Let's set up a new automation. Describe what you want to happen automatically, and I'll help configure it. Be specific about what should trigger it and what actions to take.",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isAgentTyping, setIsAgentTyping] = useState(false)
  const [currentStep, setCurrentStep] = useState<SetupStep>("describe")
  const [config, setConfig] = useState<Partial<AutomationConfig>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = (text?: string) => {
    const messageText = text || input
    if (!messageText.trim()) return

    const newMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, newMessage])
    setInput("")
    setIsAgentTyping(true)

    // Simulate AI understanding the request
    setTimeout(() => {
      setIsAgentTyping(false)

      if (currentStep === "describe") {
        // Parse the description and ask about trigger
        const parsedName = messageText.length > 40 ? messageText.slice(0, 40) + "..." : messageText
        const parsedDescription = messageText

        setConfig((prev) => ({
          ...prev,
          name: parsedName,
          description: parsedDescription,
          actions: extractActions(messageText),
        }))

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content: `Got it! I'll create an automation to "${parsedName}". When should this run?`,
            timestamp: new Date(),
            options: {
              type: "trigger",
              choices: triggerOptions,
            },
          },
        ])
        setCurrentStep("configure")
      }
    }, 1000)
  }

  const handleOptionSelect = (type: string, choice: { id: string; label: string }) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        content: choice.label,
        timestamp: new Date(),
      },
    ])
    setIsAgentTyping(true)

    setTimeout(() => {
      setIsAgentTyping(false)

      if (type === "trigger") {
        let triggerDetail = ""
        if (choice.id === "schedule") {
          triggerDetail = "Daily at 9:00 AM" // Would be configurable
        } else if (choice.id === "event") {
          triggerDetail = "On trigger event"
        } else {
          triggerDetail = "Manual trigger"
        }

        setConfig((prev) => ({
          ...prev,
          trigger: {
            type: choice.id as "schedule" | "event" | "manual",
            detail: triggerDetail,
          },
        }))

        // Ask about device
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content:
              choice.id === "schedule"
                ? "Perfect, I'll run this on a schedule. Which device should I use for this automation?"
                : choice.id === "event"
                  ? "Great, event-based it is. Which device should I use to watch for triggers and execute actions?"
                  : "Manual trigger works. Which device should I use when you trigger it?",
            timestamp: new Date(),
            options: {
              type: "device",
              choices: devices.map((d) => ({
                id: d.id,
                label: d.name,
                description: d.type,
                icon: d.icon,
              })),
            },
          },
        ])
      } else if (type === "device") {
        setConfig((prev) => ({
          ...prev,
          device: choice.label,
        }))

        // Show final configuration preview
        const finalConfig: AutomationConfig = {
          name: config.name || "New Automation",
          description: config.description || "",
          trigger: config.trigger || { type: "manual", detail: "Manual trigger" },
          device: choice.label,
          credentials: [],
          actions: config.actions || [],
        }

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content: "Here's your automation configuration. Does this look right?",
            timestamp: new Date(),
            configPreview: finalConfig,
          },
        ])
        setCurrentStep("confirm")
        setConfig(finalConfig)
      }
    }, 800)
  }

  const handleConfirm = () => {
    setIsAgentTyping(true)
    setTimeout(() => {
      setIsAgentTyping(false)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "agent",
          content:
            "Your automation is now active! I'll handle everything automatically based on the configuration. You can check on it anytime in the Automations tab.",
          timestamp: new Date(),
        },
      ])

      // Redirect after a moment
      setTimeout(() => {
        onCreated(`automation-${Date.now()}`)
      }, 1500)
    }, 1000)
  }

  const handleEdit = () => {
    setMessages([
      {
        id: "1",
        role: "agent",
        content: "No problem, let's start fresh. Describe what you want to automate.",
        timestamp: new Date(),
      },
    ])
    setCurrentStep("describe")
    setConfig({})
  }

  const extractActions = (text: string): string[] => {
    // Simple extraction - in reality this would be AI-powered
    const actions: string[] = []
    if (text.toLowerCase().includes("email")) actions.push("Process emails")
    if (text.toLowerCase().includes("send")) actions.push("Send notification")
    if (text.toLowerCase().includes("summarize") || text.toLowerCase().includes("summary"))
      actions.push("Generate summary")
    if (text.toLowerCase().includes("monitor") || text.toLowerCase().includes("check")) actions.push("Monitor changes")
    if (text.toLowerCase().includes("report")) actions.push("Create report")
    if (text.toLowerCase().includes("download")) actions.push("Download files")
    if (text.toLowerCase().includes("upload")) actions.push("Upload files")

    if (actions.length === 0) {
      actions.push("Execute task", "Report results")
    }
    return actions
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <div className="flex h-full flex-col pt-12 md:pt-0">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">Create Automation</h1>
          <p className="text-sm text-muted-foreground">Describe what you want to automate</p>
        </div>

        {/* Progress indicator */}
        <div className="hidden items-center gap-2 sm:flex">
          {(["describe", "configure", "confirm"] as const).map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                  currentStep === step
                    ? "bg-primary text-primary-foreground"
                    : i < ["describe", "configure", "confirm"].indexOf(currentStep)
                      ? "bg-primary/20 text-primary"
                      : "bg-secondary text-muted-foreground",
                )}
              >
                {i < ["describe", "configure", "confirm"].indexOf(currentStep) ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              {i < 2 && <div className="h-px w-6 bg-border" />}
            </div>
          ))}
        </div>
      </div>

      {/* Chat Interface */}
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card">
        {/* Agent header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-green-500" />
          </div>
          <div>
            <h2 className="font-medium text-foreground">Automation Setup</h2>
            <p className="text-xs text-muted-foreground">Configure your smart RPA</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto w-full max-w-2xl flex-1">
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn("flex gap-3", message.role === "user" ? "flex-row-reverse" : "flex-row")}
                >
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                      message.role === "user" ? "bg-secondary" : "bg-primary/20",
                    )}
                  >
                    {message.role === "user" ? (
                      <User className="h-3.5 w-3.5 text-foreground" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    )}
                  </div>

                  <div className={cn("max-w-[85%] space-y-2", message.role === "user" ? "text-right" : "text-left")}>
                    <div
                      className={cn(
                        "inline-block rounded-2xl px-4 py-2.5",
                        message.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary",
                      )}
                    >
                      <p className="text-sm">{message.content}</p>
                    </div>

                    {/* Options */}
                    {message.options && (
                      <div className="space-y-2 pt-1">
                        {message.options.choices.map((choice) => {
                          const Icon = choice.icon || ChevronDown
                          return (
                            <button
                              key={choice.id}
                              onClick={() => handleOptionSelect(message.options!.type, choice)}
                              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-secondary/50"
                            >
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                <Icon className="h-4 w-4 text-primary" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground">{choice.label}</p>
                                {choice.description && (
                                  <p className="text-xs text-muted-foreground">{choice.description}</p>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Config Preview */}
                    {message.configPreview && (
                      <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium text-primary">Automation Preview</span>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Name</p>
                            <p className="font-medium text-foreground">{message.configPreview.name}</p>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Trigger</p>
                              <div className="mt-1 flex items-center gap-1.5">
                                {message.configPreview.trigger.type === "schedule" && (
                                  <Clock className="h-3.5 w-3.5 text-primary" />
                                )}
                                {message.configPreview.trigger.type === "event" && (
                                  <Zap className="h-3.5 w-3.5 text-primary" />
                                )}
                                {message.configPreview.trigger.type === "manual" && (
                                  <Play className="h-3.5 w-3.5 text-primary" />
                                )}
                                <span className="text-sm text-foreground">{message.configPreview.trigger.detail}</span>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Device</p>
                              <p className="mt-1 text-sm text-foreground">{message.configPreview.device}</p>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-muted-foreground">Actions</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {message.configPreview.actions.map((action, i) => (
                                <span key={i} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground">
                                  {action}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex gap-2">
                          <button
                            onClick={handleConfirm}
                            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                          >
                            <Check className="h-4 w-4" />
                            Create Automation
                          </button>
                          <button
                            onClick={handleEdit}
                            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            Start Over
                          </button>
                        </div>
                      </div>
                    )}

                    <p className="px-1 text-xs text-muted-foreground">{formatTime(message.timestamp)}</p>
                  </div>
                </div>
              ))}

              {isAgentTyping && (
                <div className="flex gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex items-center gap-1 rounded-2xl bg-secondary px-4 py-2.5">
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {/* Suggestions for first step */}
        {currentStep === "describe" && messages.length <= 1 && (
          <div className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
            <p className="mb-2 text-xs text-muted-foreground">Examples:</p>
            <div className="flex flex-wrap gap-2">
              {[
                "Summarize my important emails every morning",
                "Monitor competitor prices and alert me on drops",
                "Research new leads and draft outreach emails",
                "Generate a weekly activity report every Friday",
              ].map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(prompt)}
                  className="rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input - only show during describe step */}
        {currentStep === "describe" && (
          <div className="shrink-0 border-t border-border p-4">
            <div className="mx-auto max-w-2xl">
              <div className="flex items-end gap-2 rounded-xl border border-border bg-secondary/30 p-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Describe what you want to automate..."
                  className="max-h-28 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  rows={1}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className="shrink-0 rounded-lg bg-primary p-2 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
