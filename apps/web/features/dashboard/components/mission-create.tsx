"use client"

import { useState, useRef, useEffect } from "react"
import {
  ArrowLeft,
  Send,
  User,
  Target,
  Calendar,
  Bell,
  Shield,
  Check,
  Smartphone,
  Monitor,
  DollarSign,
  Clock,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface MissionCreateProps {
  onBack: () => void
  onCreated: (missionId: string) => void
}

type SetupStep = "goal" | "constraints" | "devices" | "updates" | "confirm"

interface Message {
  id: string
  role: "user" | "agent"
  content: string
  timestamp: Date
  options?: {
    type: "timeline" | "budget" | "device" | "updates" | "approval"
    choices: { id: string; label: string; description?: string; icon?: typeof Clock }[]
    multiSelect?: boolean
  }
  configPreview?: MissionConfig
}

interface MissionConfig {
  name: string
  goal: string
  timeline: string
  budget?: string
  devices: string[]
  updateFrequency: string
  approvalRequired: string[]
}

const devices = [
  { id: "macbook", name: "MacBook Pro", type: "desktop", icon: Monitor },
  { id: "pixel", name: "Pixel 8 Pro", type: "android", icon: Smartphone },
  { id: "windows", name: "Windows Desktop", type: "desktop", icon: Monitor },
]

const timelineOptions = [
  { id: "asap", label: "As soon as possible", description: "I need results quickly", icon: Clock },
  { id: "week", label: "Within a week", description: "No rush, but soon", icon: Calendar },
  { id: "month", label: "Within a month", description: "Take your time", icon: Calendar },
  { id: "ongoing", label: "Ongoing / No deadline", description: "Continuous monitoring", icon: Target },
]

const updateOptions = [
  { id: "realtime", label: "Real-time updates", description: "Notify me immediately on progress", icon: Bell },
  { id: "daily", label: "Daily summary", description: "One update per day", icon: Calendar },
  { id: "milestones", label: "Milestones only", description: "Only major developments", icon: Target },
  { id: "completion", label: "On completion", description: "Just tell me when it's done", icon: Check },
]

const approvalOptions = [
  { id: "purchases", label: "Purchases & Payments", description: "Before spending money", icon: DollarSign },
  { id: "communications", label: "External Communications", description: "Before sending emails/messages", icon: Send },
  { id: "submissions", label: "Form Submissions", description: "Before submitting applications", icon: Target },
  { id: "none", label: "No approval needed", description: "Full autonomy", icon: Shield },
]

export function MissionCreate({ onBack, onCreated }: MissionCreateProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "agent",
      content:
        "Let's set up a new mission. Tell me your goal - what do you want to achieve? Be as specific as possible about what success looks like.",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isAgentTyping, setIsAgentTyping] = useState(false)
  const [currentStep, setCurrentStep] = useState<SetupStep>("goal")
  const [config, setConfig] = useState<Partial<MissionConfig>>({
    devices: [],
    approvalRequired: [],
  })
  const [selectedDevices, setSelectedDevices] = useState<string[]>([])
  const [selectedApprovals, setSelectedApprovals] = useState<string[]>([])
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

    setTimeout(() => {
      setIsAgentTyping(false)

      if (currentStep === "goal") {
        const parsedName =
          messageText.length > 50 ? messageText.slice(0, 50).split(" ").slice(0, -1).join(" ") + "..." : messageText

        setConfig((prev) => ({
          ...prev,
          name: parsedName,
          goal: messageText,
        }))

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content: `Got it - "${parsedName}". What's your timeline for this? This helps me prioritize and plan my approach.`,
            timestamp: new Date(),
            options: {
              type: "timeline",
              choices: timelineOptions,
            },
          },
        ])
        setCurrentStep("constraints")
      }
    }, 1000)
  }

  const handleOptionSelect = (type: string, choice: { id: string; label: string }) => {
    if (type === "device") {
      const newSelection = selectedDevices.includes(choice.id)
        ? selectedDevices.filter((d) => d !== choice.id)
        : [...selectedDevices, choice.id]
      setSelectedDevices(newSelection)
      return
    }

    if (type === "approval") {
      if (choice.id === "none") {
        setSelectedApprovals([])
      } else {
        const newSelection = selectedApprovals.includes(choice.id)
          ? selectedApprovals.filter((a) => a !== choice.id)
          : [...selectedApprovals.filter((a) => a !== "none"), choice.id]
        setSelectedApprovals(newSelection)
      }
      return
    }

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

      if (type === "timeline") {
        setConfig((prev) => ({
          ...prev,
          timeline: choice.label,
        }))

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content: "Which devices can I use for this mission? Select all that apply, then click Continue.",
            timestamp: new Date(),
            options: {
              type: "device",
              choices: devices.map((d) => ({
                id: d.id,
                label: d.name,
                description: d.type,
                icon: d.icon,
              })),
              multiSelect: true,
            },
          },
        ])
        setCurrentStep("devices")
      } else if (type === "updates") {
        setConfig((prev) => ({
          ...prev,
          updateFrequency: choice.label,
        }))

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content:
              "What actions should I get your approval for before proceeding? Select all that apply, or choose 'No approval needed' for full autonomy.",
            timestamp: new Date(),
            options: {
              type: "approval",
              choices: approvalOptions,
              multiSelect: true,
            },
          },
        ])
        setCurrentStep("updates")
      }
    }, 800)
  }

  const handleDeviceContinue = () => {
    if (selectedDevices.length === 0) return

    const deviceNames = selectedDevices.map((id) => devices.find((d) => d.id === id)?.name || id)

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        content: deviceNames.join(", "),
        timestamp: new Date(),
      },
    ])

    setConfig((prev) => ({
      ...prev,
      devices: deviceNames,
    }))

    setIsAgentTyping(true)

    setTimeout(() => {
      setIsAgentTyping(false)
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "agent",
          content: "How often would you like me to update you on progress?",
          timestamp: new Date(),
          options: {
            type: "updates",
            choices: updateOptions,
          },
        },
      ])
    }, 800)
  }

  const handleApprovalContinue = () => {
    const approvalLabels =
      selectedApprovals.length === 0
        ? ["Full autonomy"]
        : selectedApprovals.map((id) => approvalOptions.find((a) => a.id === id)?.label || id)

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        content: approvalLabels.join(", "),
        timestamp: new Date(),
      },
    ])

    setConfig((prev) => ({
      ...prev,
      approvalRequired: selectedApprovals,
    }))

    setIsAgentTyping(true)

    setTimeout(() => {
      setIsAgentTyping(false)

      const finalConfig: MissionConfig = {
        name: config.name || "New Mission",
        goal: config.goal || "",
        timeline: config.timeline || "As soon as possible",
        devices: config.devices || [],
        updateFrequency: config.updateFrequency || "Daily summary",
        approvalRequired: selectedApprovals,
      }

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "agent",
          content: "Here's your mission configuration. Ready to launch?",
          timestamp: new Date(),
          configPreview: finalConfig,
        },
      ])
      setCurrentStep("confirm")
      setConfig(finalConfig)
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
            "Mission launched! I'm starting work now. You'll find updates in the Missions tab, and I'll notify you based on your preferences. Good luck!",
          timestamp: new Date(),
        },
      ])

      setTimeout(() => {
        onCreated(`mission-${Date.now()}`)
      }, 1500)
    }, 1000)
  }

  const handleStartOver = () => {
    setMessages([
      {
        id: "1",
        role: "agent",
        content: "No problem, let's start fresh. Tell me your goal - what do you want to achieve?",
        timestamp: new Date(),
      },
    ])
    setCurrentStep("goal")
    setConfig({ devices: [], approvalRequired: [] })
    setSelectedDevices([])
    setSelectedApprovals([])
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const steps: SetupStep[] = ["goal", "constraints", "devices", "updates", "confirm"]
  const currentStepIndex = steps.indexOf(currentStep)

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
          <h1 className="text-xl font-semibold text-foreground">New Mission</h1>
          <p className="text-sm text-muted-foreground">Define your goal and preferences</p>
        </div>

        {/* Progress indicator */}
        <div className="hidden items-center gap-1.5 sm:flex">
          {steps.map((step, i) => (
            <div key={step} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex h-2 w-2 items-center justify-center rounded-full",
                  i <= currentStepIndex ? "bg-primary" : "bg-secondary",
                )}
              />
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
              <Target className="h-4 w-4 text-primary" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-green-500" />
          </div>
          <div>
            <h2 className="font-medium text-foreground">Mission Setup</h2>
            <p className="text-xs text-muted-foreground">Define your autonomous goal</p>
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
                      <Target className="h-3.5 w-3.5 text-primary" />
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
                          const Icon = choice.icon || Target
                          const isSelected =
                            message.options?.type === "device"
                              ? selectedDevices.includes(choice.id)
                              : message.options?.type === "approval"
                                ? selectedApprovals.includes(choice.id) ||
                                  (choice.id === "none" && selectedApprovals.length === 0)
                                : false

                          return (
                            <button
                              key={choice.id}
                              onClick={() => handleOptionSelect(message.options!.type, choice)}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                                isSelected
                                  ? "border-primary bg-primary/10"
                                  : "border-border bg-card hover:border-primary/50 hover:bg-secondary/50",
                              )}
                            >
                              <div
                                className={cn(
                                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                                  isSelected ? "bg-primary/20" : "bg-primary/10",
                                )}
                              >
                                <Icon className="h-4 w-4 text-primary" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground">{choice.label}</p>
                                {choice.description && (
                                  <p className="text-xs text-muted-foreground">{choice.description}</p>
                                )}
                              </div>
                              {message.options?.multiSelect && isSelected && <Check className="h-4 w-4 text-primary" />}
                            </button>
                          )
                        })}

                        {/* Continue button for multi-select */}
                        {message.options.multiSelect && (
                          <button
                            onClick={message.options.type === "device" ? handleDeviceContinue : handleApprovalContinue}
                            disabled={message.options.type === "device" && selectedDevices.length === 0}
                            className={cn(
                              "mt-2 w-full rounded-lg py-2.5 text-sm font-medium transition-colors",
                              message.options.type === "device" && selectedDevices.length === 0
                                ? "bg-secondary text-muted-foreground cursor-not-allowed"
                                : "bg-primary text-primary-foreground hover:opacity-90",
                            )}
                          >
                            Continue
                          </button>
                        )}
                      </div>
                    )}

                    {/* Config Preview */}
                    {message.configPreview && (
                      <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium text-primary">Mission Preview</span>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Goal</p>
                            <p className="text-sm text-foreground">{message.configPreview.goal}</p>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Timeline</p>
                              <div className="mt-1 flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-primary" />
                                <span className="text-sm text-foreground">{message.configPreview.timeline}</span>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Updates</p>
                              <div className="mt-1 flex items-center gap-1.5">
                                <Bell className="h-3.5 w-3.5 text-primary" />
                                <span className="text-sm text-foreground">{message.configPreview.updateFrequency}</span>
                              </div>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-muted-foreground">Devices</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {message.configPreview.devices.map((device, i) => (
                                <span key={i} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground">
                                  {device}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-muted-foreground">Approval Required For</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {message.configPreview.approvalRequired.length === 0 ? (
                                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground">
                                  Full autonomy
                                </span>
                              ) : (
                                message.configPreview.approvalRequired.map((item, i) => (
                                  <span
                                    key={i}
                                    className="rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground"
                                  >
                                    {approvalOptions.find((a) => a.id === item)?.label || item}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex gap-2">
                          <button
                            onClick={handleConfirm}
                            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                          >
                            <Target className="h-4 w-4" />
                            Launch Mission
                          </button>
                          <button
                            onClick={handleStartOver}
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
                    <Target className="h-3.5 w-3.5 text-primary" />
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
        {currentStep === "goal" && messages.length <= 1 && (
          <div className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
            <p className="mb-2 text-xs text-muted-foreground">Examples:</p>
            <div className="flex flex-wrap gap-2">
              {[
                "Find rental properties in Austin under $300K",
                "Apply to 20 remote React developer jobs",
                "Research competitors and create analysis report",
                "Plan a trip to Japan for 2 weeks in April",
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

        {/* Input - only show during goal step */}
        {currentStep === "goal" && (
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
                  placeholder="Describe your goal in detail..."
                  className="max-h-24 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  rows={1}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                    input.trim()
                      ? "bg-primary text-primary-foreground hover:opacity-90"
                      : "bg-secondary text-muted-foreground",
                  )}
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
