import type { ProjectDef } from './types'

const modules = import.meta.glob<{ project: ProjectDef }>('./p*/index.ts', { eager: true })

export const PROJECTS: ProjectDef[] = Object.values(modules)
  .map((m) => m.project)
  .sort((a, b) => a.number - b.number)

export function projectById(id: string): ProjectDef | undefined {
  return PROJECTS.find((p) => p.id === id)
}
