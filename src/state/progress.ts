import { get as idbGet, set as idbSet } from 'idb-keyval'
import { create } from 'zustand'
import { LEVELS } from '../content/levels'
import { baselineBefore, prepareWorkspace, type Files } from '../content/workspace'
import type { LevelDef } from '../content/types'

export interface LevelProgress {
  stars: number
  passed: boolean
  realBadge: boolean
  attempts: number
  hintsShown: number
  bestTokens?: number
}

export interface SaveData {
  version: 1
  files: Files
  levels: Record<string, LevelProgress>
  /** 哪些文件是用参考实现自动补上的（跳关时） */
  borrowed: string[]
}

const KEY = 'agent-quest:save'

const empty = (): SaveData => ({ version: 1, files: {}, levels: {}, borrowed: [] })

interface ProgressStore extends SaveData {
  loaded: boolean
  load(): Promise<void>
  enterLevel(level: LevelDef): string[]
  setFile(path: string, content: string): void
  resetFile(level: LevelDef, path: string): void
  record(levelId: string, patch: Partial<LevelProgress>): void
  importSave(data: SaveData): void
  resetAll(): void
}

let timer: ReturnType<typeof setTimeout> | undefined
function persist(data: SaveData) {
  clearTimeout(timer)
  timer = setTimeout(() => {
    idbSet(KEY, data).catch(() => {
      /* IndexedDB 不可用时只在内存中保存 */
    })
  }, 300)
}

export const useProgress = create<ProgressStore>((set, get) => {
  const commit = (patch: Partial<SaveData>) => {
    set(patch)
    const { version, files, levels, borrowed } = get()
    persist({ version, files, levels, borrowed })
  }
  return {
    ...empty(),
    loaded: false,
    async load() {
      try {
        const data = (await idbGet(KEY)) as SaveData | undefined
        if (data?.version === 1) set({ ...data })
      } catch {
        /* ignore */
      }
      set({ loaded: true })
    },
    enterLevel(level) {
      // 跳关时，用之前关卡的参考实现补齐缺失的文件
      const base = baselineBefore(LEVELS, level.number)
      const files = { ...get().files }
      const borrowed = new Set(get().borrowed)
      for (const [p, c] of Object.entries(base))
        if (!(p in files)) {
          files[p] = c
          borrowed.add(p)
        }
      const r = prepareWorkspace(files, level)
      commit({ files: r.files, borrowed: [...borrowed] })
      return r.added
    },
    setFile(path, content) {
      const borrowed = get().borrowed.filter((p) => p !== path)
      commit({ files: { ...get().files, [path]: content }, borrowed })
    },
    resetFile(level, path) {
      const base = baselineBefore(LEVELS, level.number)
      const starter = level.files.find((f) => f.path === path)?.starter
      const content = path in base ? base[path] : starter
      if (content === undefined) return
      commit({ files: { ...get().files, [path]: content } })
    },
    record(levelId, patch) {
      const prev = get().levels[levelId] ?? { stars: 0, passed: false, realBadge: false, attempts: 0, hintsShown: 0 }
      const next = { ...prev, ...patch }
      if (patch.stars !== undefined) next.stars = Math.max(prev.stars, patch.stars)
      if (patch.passed !== undefined) next.passed = prev.passed || patch.passed
      if (patch.realBadge !== undefined) next.realBadge = prev.realBadge || patch.realBadge
      commit({ levels: { ...get().levels, [levelId]: next } })
    },
    importSave(data) {
      commit({ files: data.files ?? {}, levels: data.levels ?? {}, borrowed: data.borrowed ?? [] })
    },
    resetAll() {
      commit(empty())
    },
  }
})

export function isUnlocked(level: LevelDef, levels: Record<string, LevelProgress>, freeMode: boolean): boolean {
  if (freeMode || level.number === 1) return true
  const prev = LEVELS.find((l) => l.number === level.number - 1)
  return !prev || !!levels[prev.id]?.passed
}
