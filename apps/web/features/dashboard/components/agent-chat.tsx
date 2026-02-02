"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Paperclip, Bot, User, Sparkles, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  role: "user" | "agent"
  content: string
  timestamp: Date
  missionCreated?: {
    id: string
    title: string
  }
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "agent",
    content:
      "Hey! I'm your ControlAI agent. I can handle complex tasks autonomously across your connected devices. Give me a mission and I'll work on it in the background - just check in whenever you want.",
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
  },
]

const suggestionPrompts = [
  "Find rental properties in Austin under $300K",
  "Apply to 20 remote React developer jobs",
  "Monitor competitor pricing changes",
  "Research AI trends and draft a report",
]

interface AgentChatProps {
  onMissionCreated?: (missionId: string) => void
}

export function AgentChat({ onMissionCreated }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState("")
  const [isAgentTyping, setIsAgentTyping] = useState(false)
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

    const isComplexTask =
      messageText.length > 50 ||
      messageText.toLowerCase().includes("find") ||
      messageText.toLowerCase().includes("monitor") ||
      messageText.toLowerCase().includes("apply") ||
      messageText.toLowerCase().includes("research")

    setTimeout(() => {
      setIsAgentTyping(false)

      if (isComplexTask) {
        const missionTitle = messageText.slice(0, 50) + (messageText.length > 50 ? "..." : "")
        const missionId = `mission-${Date.now()}`
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content:
              "Got it! I've created a mission for this. I'll work on it autonomously and notify you when I need input or have results. Track progress in the Missions tab anytime.",
            timestamp: new Date(),
            missionCreated: {
              id: missionId,
              title: missionTitle,
            },
          },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content:
              "I can help with that! Want me to turn this into a mission I work on in the background, or is this just a quick question?",
            timestamp: new Date(),
          },
        ])
      }
    }, 1200)
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const handleViewMission = (missionId: string) => {
    onMissionCreated?.(missionId)
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <div className="relative">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-green-500" />
        </div>
        <div>
          <h2 className="font-medium text-foreground">ControlAI Agent</h2>
          <p className="text-xs text-muted-foreground">Online</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
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

                <div className={cn("max-w-[80%] space-y-1.5", message.role === "user" ? "text-right" : "text-left")}>
                  <div
                    className={cn(
                      "inline-block rounded-2xl px-4 py-2.5",
                      message.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary",
                    )}
                  >
                    <p className="text-sm">{message.content}</p>
                  </div>

                  {message.missionCreated && (
                    <div className="inline-block rounded-xl border border-primary/30 bg-primary/5 p-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
                        <Sparkles className="h-3 w-3" />
                        Mission Created
                      </div>
                      <p className="mb-2 text-sm font-medium text-foreground">{message.missionCreated.title}</p>
                      <button
                        onClick={() => handleViewMission(message.missionCreated!.id)}
                        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        View Mission <ArrowRight className="h-3 w-3" />
                      </button>
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

      {/* Suggestions */}
      {messages.length <= 2 && (
        <div className="shrink-0 border-t border-border px-6 py-3">
          <p className="mb-2 text-xs text-muted-foreground">Try a mission:</p>
          <div className="flex flex-wrap gap-2">
            {suggestionPrompts.map((prompt, i) => (
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

      {/* Input */}
      <div className="shrink-0 border-t border-border p-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-secondary/30 p-2">
            <button className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Chat or start a new mission..."
              className="max-h-28 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
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
    </div>
  )
}
