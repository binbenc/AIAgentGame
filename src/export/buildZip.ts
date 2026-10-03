/**
 * 毕业导出：把玩家自己的代码 + 运行时 + 判题场景 + 文档打包成一个可运行的 Node 工程。
 * 运行时和判题代码是“原样拷贝”的游戏源码——你在游戏里跑的，就是导出后跑的。
 */
import JSZip from 'jszip'
import { LEVELS } from '../content/levels'
import type { LevelProgress } from '../state/progress'

const template = import.meta.glob('./template/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
export const engine = import.meta.glob(['../engine/**/*.ts', '!../engine/sandbox/worker.ts', '!../engine/sandbox/host.ts', '!../engine/sandbox/protocol.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const content = import.meta.glob(['../content/levels/*/*.ts', '!../content/levels/*/index.ts', '!../content/levels/index.ts', '../content/shared/**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const RENAME: Record<string, string> = { 'env.example': '.env.example', gitignore: '.gitignore' }

export interface ExportInput {
  files: Record<string, string>
  levels: Record<string, LevelProgress>
  borrowed: string[]
}

/** 引擎源码（不含浏览器专用的 Worker / 宿主代码），按导出路径组织 */
export function engineFiles(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(engine)) out[`aq/engine/${k.replace('../engine/', '')}`] = v
  return out
}

export const nodeRuntime = template['./template/aq/node-runtime.ts']

export function exportFileList(input: ExportInput): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(template)) {
    const rel = k.replace('./template/', '')
    out[RENAME[rel] ?? rel] = v
  }
  for (const [k, v] of Object.entries(engine)) out[`aq/engine/${k.replace('../engine/', '')}`] = v
  for (const [k, v] of Object.entries(content)) out[`aq/content/${k.replace('../content/', '')}`] = v
  for (const [k, v] of Object.entries(input.files)) out[`src/${k}`] = v
  out['PROGRESS.md'] = progressReport(input)
  return out
}

function progressReport({ levels, borrowed }: ExportInput): string {
  const rows = LEVELS.map((l) => {
    const p = levels[l.id]
    return `| ${l.number} | ${l.title} | ${p?.passed ? '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars) : '未通关'} | ${p?.realBadge ? '🏅' : ''} | ${l.concepts.join('、')} |`
  })
  const stars = Object.values(levels).reduce((n, l) => n + l.stars, 0)
  return [
    '# 闯关记录',
    '',
    `导出时间：${new Date().toLocaleString('zh-CN')} · 总星数：${stars} / ${LEVELS.length * 3}`,
    '',
    '| 关卡 | 主题 | 星级 | 实战徽章 | 知识点 |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    borrowed.length
      ? `> 以下文件来自参考实现（跳关时自动补齐），不是你亲手写的：${borrowed.map((b) => `\`src/${b}\``).join('、')}`
      : '> `src/` 下的所有代码都是你亲手写的。',
    '',
  ].join('\n')
}

export async function buildZip(input: ExportInput): Promise<Blob> {
  const zip = new JSZip()
  const root = zip.folder('my-nova-agent')!
  for (const [path, text] of Object.entries(exportFileList(input))) root.file(path, text)
  return zip.generateAsync({ type: 'blob' })
}
