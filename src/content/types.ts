import type { LevelSuite } from '../engine/judge/types'
import { L } from '../engine/locale'

export interface LevelFile {
  /** 工作区内路径，例如 "agent.ts" */
  path: string
  /** 文件不存在时用它初始化；已存在则保留玩家自己的代码 */
  starter?: string
}

export interface LevelDef {
  id: string
  number: number
  chapter: number
  title: string
  tagline: string
  concepts: string[]
  /** 剧情（Markdown） */
  story: string
  /** 任务说明与接口约定（Markdown） */
  task: string
  /** 生产落地要点（Markdown） */
  knowledge: string
  hints: string[]
  /** 本关新增或需要修改的文件，第一个默认打开 */
  files: LevelFile[]
  /** 本关结束时这些文件的参考实现 */
  solution: Record<string, string>
  suite: LevelSuite
}

export interface ChapterDef {
  number: number
  title: string
  subtitle: string
}

/** 把 import.meta.glob 的结果整理成 { 相对路径: 内容 } */
export function rawFiles(glob: Record<string, unknown>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(glob)) out[k.slice(k.indexOf(prefix) + prefix.length)] = v as string
  return out
}

/**
 * Bilingual code files: `starter/` + `solution/` are Chinese, `starter.en/` + `solution.en/` hold the English version of
 * every file that contains Chinese (comments, strings). In English, files missing from the .en dir fall back to the Chinese one.
 */
export function localizedFiles(zh: Record<string, string>, en: Record<string, string>): Record<string, string> {
  return L(zh, { ...zh, ...en })
}
