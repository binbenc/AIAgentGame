import type { ChapterDef, LevelDef } from '../types'

const modules = import.meta.glob<{ level: LevelDef }>('./l*/index.ts', { eager: true })

export const LEVELS: LevelDef[] = Object.values(modules)
  .map((m) => m.level)
  .sort((a, b) => a.number - b.number)

export const CHAPTERS: ChapterDef[] = [
  { number: 1, title: '第一章 · 地基', subtitle: '模型调用、工具与 Agent 循环' },
  { number: 2, title: '第二章 · 上下文', subtitle: '窗口、记忆与检索' },
  { number: 3, title: '第三章 · 控制', subtitle: '规划、工作流、人在回路与流式' },
  { number: 4, title: '第四章 · 协作', subtitle: '多 Agent 模式' },
  { number: 5, title: '第五章 · 生产', subtitle: '评测、安全、可观测性与 MCP' },
  { number: 6, title: '毕业', subtitle: '综合项目与导出' },
]

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id)
}
