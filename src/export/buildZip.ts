/**
 * 毕业导出：把玩家自己的代码 + 运行时 + 判题场景 + 文档打包成一个可运行的 Node 工程。
 * 运行时和判题代码是“原样拷贝”的游戏源码——你在游戏里跑的，就是导出后跑的。
 */
import JSZip from 'jszip'
import { LEVELS } from '../content/levels'
import type { LevelProgress } from '../state/progress'
import { L, LOCALE } from '../engine/locale'

const templateZh = import.meta.glob('./template/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const templateEn = import.meta.glob('./template.en/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
/** template.en/ holds the English version of every template file that contains Chinese; others fall back to template/ */
const template: Record<string, string> = L(
  templateZh,
  { ...templateZh, ...Object.fromEntries(Object.entries(templateEn).map(([k, v]) => [k.replace('./template.en/', './template/'), v])) },
)
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
  for (const [k, v] of Object.entries(engine)) out[`aq/engine/${k.replace('../engine/', '')}`] = withExportLocale(k, v)
  return out
}

/** The exported project runs in the language the player exported in (AQ_LOCALE still overrides it) */
function withExportLocale(path: string, text: string): string {
  if (!path.endsWith('/locale.ts')) return text
  const out = text.replace(/const DEFAULT_LOCALE: Locale = '(en|zh)'/, `const DEFAULT_LOCALE: Locale = '${LOCALE}'`)
  if (out === text && LOCALE !== 'en') throw new Error('locale.ts: DEFAULT_LOCALE line not found')
  return out
}

export const nodeRuntime = template['./template/aq/node-runtime.ts']

export function exportFileList(input: ExportInput): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(template)) {
    const rel = k.replace('./template/', '')
    out[RENAME[rel] ?? rel] = v
  }
  Object.assign(out, engineFiles())
  for (const [k, v] of Object.entries(content)) out[`aq/content/${k.replace('../content/', '')}`] = v
  for (const [k, v] of Object.entries(input.files)) out[`src/${k}`] = v
  out['PROGRESS.md'] = progressReport(input)
  return out
}

function progressReport({ levels, borrowed }: ExportInput): string {
  const rows = LEVELS.map((l) => {
    const p = levels[l.id]
    return `| ${l.number} | ${l.title} | ${p?.passed ? '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars) : L('未通关', 'not passed')} | ${p?.realBadge ? '🏅' : ''} | ${l.concepts.join(L('、', ', '))} |`
  })
  const stars = Object.values(levels).reduce((n, l) => n + l.stars, 0)
  return [
    L('# 闯关记录', '# Level record'),
    '',
    L(
      `导出时间：${new Date().toLocaleString('zh-CN')} · 总星数：${stars} / ${LEVELS.length * 3}`,
      `Exported: ${new Date().toLocaleString('en-US')} · Total stars: ${stars} / ${LEVELS.length * 3}`,
    ),
    '',
    L('| 关卡 | 主题 | 星级 | 实战徽章 | 知识点 |', '| Level | Topic | Stars | Real-model badge | Concepts |'),
    '|---|---|---|---|---|',
    ...rows,
    '',
    borrowed.length
      ? L(
          `> 以下文件来自参考实现（跳关时自动补齐），不是你亲手写的：${borrowed.map((b) => `\`src/${b}\``).join('、')}`,
          `> These files came from the reference solutions (filled in when you skipped levels) — you didn't write them: ${borrowed.map((b) => `\`src/${b}\``).join(', ')}`,
        )
      : L('> `src/` 下的所有代码都是你亲手写的。', '> Every file under `src/` was written by you.'),
    '',
  ].join('\n')
}

export async function buildZip(input: ExportInput): Promise<Blob> {
  const zip = new JSZip()
  const root = zip.folder('my-nova-agent')!
  for (const [path, text] of Object.entries(exportFileList(input))) root.file(path, text)
  return zip.generateAsync({ type: 'blob' })
}
