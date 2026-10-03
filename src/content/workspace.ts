import type { LevelDef } from './types'

export type Files = Record<string, string>

/** 前 n 关（不含第 n 关）参考实现叠加后的工作区：用于“重置文件”和完整性测试 */
export function baselineBefore(levels: LevelDef[], number: number): Files {
  const out: Files = {}
  for (const l of levels) if (l.number < number) Object.assign(out, l.solution)
  return out
}

/** 截至第 n 关（含）参考实现叠加后的工作区 */
export function solutionThrough(levels: LevelDef[], number: number): Files {
  const out: Files = {}
  for (const l of levels) if (l.number <= number) Object.assign(out, l.solution)
  return out
}

/** 进入一关时：缺失的文件用 starter 补齐，已有文件保留玩家自己的版本 */
export function prepareWorkspace(existing: Files, level: LevelDef): { files: Files; added: string[] } {
  const files = { ...existing }
  const added: string[] = []
  for (const f of level.files)
    if (!(f.path in files) && f.starter !== undefined) {
      files[f.path] = f.starter
      added.push(f.path)
    }
  return { files, added }
}
