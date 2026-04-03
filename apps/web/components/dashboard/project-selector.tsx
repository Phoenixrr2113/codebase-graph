'use client'

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Project {
  id: string
  name: string
  rootPath: string | null
}

interface ProjectSelectorProps {
  onProjectChange?: (project: Project | null) => void
}

export function ProjectSelector({ onProjectChange }: ProjectSelectorProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/api/projects`)
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(data => {
        const p = data.projects ?? []
        setProjects(p)
        // Auto-select last project (most recently indexed)
        if (p.length > 0 && !selected) {
          const last = p[p.length - 1]
          setSelected(last.id)
          onProjectChange?.(last)
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (projects.length === 0) return null

  if (projects.length === 1) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-sm font-medium">{projects[0]!.name}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full bg-emerald-400" />
      <select
        value={selected ?? ''}
        onChange={(e) => {
          const id = e.target.value
          setSelected(id)
          const p = projects.find(p => p.id === id) ?? null
          onProjectChange?.(p)
        }}
        className="bg-transparent text-sm font-medium border-none outline-none cursor-pointer text-foreground"
      >
        {projects.map(p => (
          <option key={p.id} value={p.id} className="bg-card text-foreground">
            {p.name}
          </option>
        ))}
      </select>
    </div>
  )
}
