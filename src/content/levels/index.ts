import { L } from '../../engine/locale'
import type { ChapterDef, LevelDef } from '../types'

const modules = import.meta.glob<{ level: LevelDef }>('./l*/index.ts', { eager: true })

export const LEVELS: LevelDef[] = Object.values(modules)
  .map((m) => m.level)
  .sort((a, b) => a.number - b.number)

export const CHAPTERS: ChapterDef[] = [
  { number: 1, title: L('第一章 · 地基', 'Chapter 1 · Foundations'), subtitle: L('模型调用、工具与 Agent 循环', 'Model calls, tools and the agent loop') },
  { number: 2, title: L('第二章 · 上下文', 'Chapter 2 · Context'), subtitle: L('窗口、记忆与检索', 'Windows, memory and retrieval') },
  { number: 3, title: L('第三章 · 控制', 'Chapter 3 · Control'), subtitle: L('规划、工作流、人在回路与流式', 'Planning, workflows, human-in-the-loop and streaming') },
  { number: 4, title: L('第四章 · 协作', 'Chapter 4 · Collaboration'), subtitle: L('多 Agent 模式', 'Multi-agent patterns') },
  { number: 5, title: L('第五章 · 生产', 'Chapter 5 · Production'), subtitle: L('评测、安全、可观测性与 MCP', 'Evals, safety, observability and MCP') },
  { number: 6, title: L('毕业', 'Graduation'), subtitle: L('综合项目与导出', 'Capstone project and export') },
]

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id)
}
