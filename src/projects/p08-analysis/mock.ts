/**
 * P8 的模拟模型：一个“会写分析代码、但只处理它亲眼看到的问题”的数据分析模型。
 *
 * - 列名：只有数据集的全部列名出现在上下文里（预览 / 打印过数据），它才会写分析代码；否则只能“估计”一个数。
 * - 脏数据：它只清洗**看到过证据**的脏数据——地区 / 平台写法不一致（看到 east、ios 这样的写法）、
 *   千分位逗号（看到 "12,345.60"）、缺失值（看到“空值 N”/ N/A）、重复行（看到“重复 N 行”）。
 *   预览只有前几行，而前 20 行恰好都是干净的；只有被要求“检查数据质量”时，它才会先写一段探查代码。
 * - 运行错误：有一道题它第一次一定会写错（漏定义一个函数）；只有把报错交还给它，它才会改正。
 * - 工具：它按名字 / 描述认出“运行代码 / 预览数据 / 列出数据集”。没有运行代码的工具时：
 *   如果你要求它写代码，它就回复一个 ```ts 代码块，等你把运行结果发回来；否则它直接估一个数。
 * - 它写的代码最后都会打印一行 `ANSWER: 值`，回答的第一行是“答案：值”。
 */
import { L } from '../../engine/locale'
import { callTool, say } from '../../engine/llm/mock-kit'
import type { MockContext, MockModel } from '../../engine/llm/providers/mock'
import { blocksOf, type ChatRequest, type ToolSpec, type ToolUseBlock } from '../../engine/llm/types'
import { ANALYSIS_TASKS, type MockSpec } from './tasks'

type Kind = 'code' | 'preview' | 'list'
const RULES: [Kind, RegExp][] = [
  ['code', /run_?code|exec|python|javascript|sandbox|interpreter|code|运行代码|执行代码/i],
  ['preview', /preview|head|sample|peek|inspect|describe|schema|预览/i],
  ['list', /list|datasets|数据集/i],
]
function classify(t: ToolSpec): Kind | undefined {
  for (const [k, re] of RULES) if (re.test(t.name)) return k
  for (const [k, re] of RULES) if (re.test(t.description)) return k
  return undefined
}
const keysOf = (t: ToolSpec) => Object.keys(t.input_schema.properties ?? {})
const firstKey = (t: ToolSpec) => t.input_schema.required?.[0] ?? keysOf(t)[0] ?? 'input'
const keyOf = (t: ToolSpec, re: RegExp) => keysOf(t).find((k) => re.test(k))

const COLUMNS: Record<MockSpec['dataset'], string[]> = {
  sales: ['date', 'region', 'category', 'orders', 'revenue', 'refund'],
  events: ['event_id', 'user_id', 'event', 'platform', 'ts', 'duration_ms'],
  nps: ['resp_id', 'city', 'score', 'channel', 'comment', 'submitted_at'],
}

/** 什么样的文字算“看到了某种脏数据” */
const EVIDENCE = {
  comma: /["']\d{1,3}(,\d{3})+(\.\d+)?["']|千分位|thousands?[- ]separators?/i,
  missing: /(空值|缺失|missing|空白|empty|blank|null)\D{0,6}[1-9]|N\/A/i,
  dup: /(重复|duplicat\w*)\D{0,6}[1-9]/i,
  // The canonical region names differ by locale (华东 vs East), so the messy spellings that count as evidence do too
  region: L(/(^|[^A-Za-z])(east|East|south|South)([^A-Za-z]|$)|华东区|华南区/, /(^|[^A-Za-z])(east|EAST|south|SOUTH)([^A-Za-z]|$)|East Region|South Region|华东区|华南区/),
  platform: /(^|[^A-Za-z])(ios|IOS|android)([^A-Za-z]|$)/,
}
type Flags = Record<keyof typeof EVIDENCE, boolean>

/** 被要求检查数据质量时，它会先探查数据 */
const QUALITY = /数据质量|清洗|脏数据|缺失|重复|不一致|异常值|探查|profil|data quality|clean|dirty|duplicat|missing|inconsisten|outlier/i
const PROFILE_MARK = L('// 数据质量检查', '// Data quality check')
const PEEK_MARK = L('// 看看数据长什么样', '// Look at what the data looks like')

const wordIn = (text: string, w: string) => new RegExp(`(^|[^A-Za-z0-9_])${w}([^A-Za-z0-9_]|$)`).test(text)
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const codeBlock = (code: string) => `\`\`\`ts\n${code}\n\`\`\``

function profileCode(ds: string): string {
  return L(profileCodeZh(ds), profileCodeEn(ds))
}

function profileCodeEn(ds: string): string {
  return `import { load } from 'data'

${PROFILE_MARK}: row count, duplicate rows, empty values per column, category values, number formats
const rows = load('${ds}')
const seen = new Set<string>()
let dup = 0
for (const r of rows) {
  const k = JSON.stringify(r)
  if (seen.has(k)) dup++
  else seen.add(k)
}
console.log(\`${ds}: \${rows.length} rows, exact duplicates: \${dup}\`)
for (const c of Object.keys(rows[0] ?? {})) {
  const vals = rows.map((r) => r[c])
  const empty = vals.filter((v) => v.trim() === '' || /^n\\/?a$/i.test(v.trim())).length
  const counts = new Map<string, number>()
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1)
  const withCommas = vals.filter((v) => /^\\d{1,3}(,\\d{3})+(\\.\\d+)?$/.test(v.trim()))
  let line = \`- \${c}: empty \${empty}, distinct values \${counts.size}\`
  if (counts.size <= 12) line += \`: \${[...counts].map(([v, n]) => \`"\${v}"×\${n}\`).join(' ')}\`
  if (withCommas.length) line += \`; numbers with thousands separators: \${withCommas.length}, e.g. "\${withCommas[0]}"\`
  console.log(line)
}`
}

function profileCodeZh(ds: string): string {
  return `import { load } from 'data'

${PROFILE_MARK}：行数、重复行、每列的空值、类别取值、数字格式
const rows = load('${ds}')
const seen = new Set<string>()
let dup = 0
for (const r of rows) {
  const k = JSON.stringify(r)
  if (seen.has(k)) dup++
  else seen.add(k)
}
console.log(\`${ds}：\${rows.length} 行，完全重复的行 \${dup} 行\`)
for (const c of Object.keys(rows[0] ?? {})) {
  const vals = rows.map((r) => r[c])
  const empty = vals.filter((v) => v.trim() === '' || /^n\\/?a$/i.test(v.trim())).length
  const counts = new Map<string, number>()
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1)
  const withCommas = vals.filter((v) => /^\\d{1,3}(,\\d{3})+(\\.\\d+)?$/.test(v.trim()))
  let line = \`- \${c}：空值 \${empty}，不同取值 \${counts.size} 个\`
  if (counts.size <= 12) line += \`：\${[...counts].map(([v, n]) => \`"\${v}"×\${n}\`).join(' ')}\`
  if (withCommas.length) line += \`；带千分位逗号的数字 \${withCommas.length} 个，例如 "\${withCommas[0]}"\`
  console.log(line)
}`
}

const peekCode = (ds: string) => `import { load } from 'data'

${PEEK_MARK}
const rows = load('${ds}')
console.log(rows.length, ${L("'行，前 5 行：'", "'rows, first 5:'")})
console.log(rows.slice(0, 5))`

/** 分析代码：清洗工具的写法取决于它看到了哪些脏数据 */
export function analysisCode(spec: MockSpec, f: Flags, slip: boolean): string {
  let body = spec.body
  if (slip && spec.slip) body = body.replace(spec.slip.find, spec.slip.replace)
  const h = new Set(spec.helpers)
  const lines = ["import { load } from 'data'"]
  if (h.has('num')) {
    if (!f.comma && !f.missing) lines.push('const num = (s: string) => parseFloat(s) || 0')
    else
      lines.push(
        'const num = (s: string): number | null => {',
        `  const t = String(s ?? '').trim()${f.comma ? `.replace(/,/g, '') // ${L('去掉千分位逗号', 'strip thousands separators')}` : ''}`,
        ...(f.missing ? [`  if (t === '' || /^n\\/?a$/i.test(t)) return null // ${L('缺失值不参与计算', 'missing values are excluded')}`] : []),
        '  const v = parseFloat(t)',
        `  return Number.isFinite(v) ? v : ${f.missing ? 'null' : '0'}`,
        '}',
      )
  }
  if (h.has('region') && f.region)
    lines.push(
      L(
        "const REGION: Record<string, string> = { east: '华东', 华东区: '华东', south: '华南', 华南区: '华南', north: '华北', 华北区: '华北', 西南区: '西南' }",
        "const REGION: Record<string, string> = { east: 'East', 'east region': 'East', south: 'South', 'south region': 'South', north: 'North', 'north region': 'North', 'southwest region': 'Southwest' }",
      ),
      'const region = (s: string) => REGION[s.trim().toLowerCase()] ?? REGION[s.trim()] ?? s.trim()',
    )
  else body = body.replace(/region\((r\.region)\)/g, '$1')
  if (h.has('platform') && f.platform) lines.push("const platform = (s: string) => (/^ios$/i.test(s.trim()) ? 'iOS' : /^android$/i.test(s.trim()) ? 'Android' : s.trim())")
  else body = body.replace(/platform\((r\.platform)\)/g, '$1')
  if (h.has('uniq') && f.dup)
    lines.push(
      L('// 重复记录只算一次', '// count duplicate records once'),
      'function uniq<T>(rows: T[], key: (r: T) => string = (r) => JSON.stringify(r)): T[] {',
      '  const seen = new Set<string>()',
      '  return rows.filter((r) => (seen.has(key(r)) ? false : (seen.add(key(r)), true)))',
      '}',
    )
  else body = body.replace(/uniq\((load\('\w+'\))(?:, \(r\) => r\.\w+)?\)/g, '$1')
  if (body.includes('round(')) lines.push('const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d')
  return `${lines[0]}\n${lines.length > 1 ? `\n${lines.slice(1).join('\n')}\n` : ''}\n${body}`
}

// —————————————— 对话历史 ——————————————

interface Use {
  use: ToolUseBlock
  result?: string
}
function history(req: ChatRequest): Use[] {
  const uses: Use[] = []
  const byId = new Map<string, Use>()
  for (const m of req.messages)
    for (const b of blocksOf(m.content)) {
      if (b.type === 'tool_use') {
        const u: Use = { use: b }
        uses.push(u)
        byId.set(b.id, u)
      } else if (b.type === 'tool_result') {
        const u = byId.get(b.tool_use_id)
        if (u) u.result = b.content
      }
    }
  return uses
}
function envText(req: ChatRequest): string {
  const parts = [req.system ?? '']
  for (const m of req.messages)
    for (const b of blocksOf(m.content)) {
      if (b.type === 'tool_result') parts.push(b.content)
      else if (b.type === 'text' && m.role === 'user') parts.push(b.text)
    }
  return parts.join('\n')
}
const textOfMessage = (m: ChatRequest['messages'][number] | undefined) =>
  m
    ? blocksOf(m.content)
        .map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : ''))
        .join('\n')
    : ''
const answerIn = (output: string) => [...output.matchAll(/ANSWER:\s*(.+)/g)].pop()?.[1].trim()
const isError = (output: string) => /(^|\n)\s*错误：|Error:/.test(output)

export const mock: MockModel = (req, ctx) => {
  const def = ANALYSIS_TASKS.find((d) => d.id === ctx.scenario.split('#')[0])
  if (!def?.mock) return say(L('（模拟模型只会做核心任务；完整任务集请用真实模型跑基准）', '(The mock model only handles core tasks; run the full set as a benchmark with a real model)'))
  return new Session(def.mock, req, ctx).next()
}

class Session {
  private env: string
  private uses: Use[]
  private box: Partial<Record<Kind, ToolSpec>> = {}
  private ds: MockSpec['dataset']

  constructor(
    private spec: MockSpec,
    private req: ChatRequest,
    private ctx: MockContext,
  ) {
    this.env = envText(req)
    this.uses = history(req)
    this.ds = spec.dataset
    for (const t of req.tools ?? []) {
      const k = classify(t)
      if (k) this.box[k] ??= t
    }
  }

  private instructions = () => `${this.req.system ?? ''}\n${textOfMessage(this.req.messages[0])}`
  private columnsSeen = () => COLUMNS[this.ds].every((c) => wordIn(this.env, c))
  private wantsProfile = () => QUALITY.test(this.instructions())
  private flags = (): Flags => Object.fromEntries(Object.entries(EVIDENCE).map(([k, re]) => [k, re.test(this.env)])) as Flags
  private slipFixed = () => !!this.spec.slip && this.env.includes(this.spec.slip.error)
  private code = () => analysisCode(this.spec, this.flags(), !!this.spec.slip && !this.slipFixed())
  private estimate = () => say(L(`我没法直接计算，根据经验粗略估计：${this.spec.estimate}。`, `I can't compute this directly; a rough estimate from experience: ${this.spec.estimate}.`))
  private final = (output: string) => say(L(`答案：${answerIn(output)}\n\n说明：用代码${this.spec.explain}。`, `Answer: ${answerIn(output)}\n\nMethod: with code, ${this.spec.explain}.`))

  next() {
    return this.box.code ? this.toolMode(this.box.code) : this.textMode()
  }

  // —————————————— 有运行代码的工具 ——————————————
  private toolMode(run: ToolSpec) {
    const codeKey = keyOf(run, /code|source|script|program/i) ?? firstKey(run)
    const runs = this.uses.filter((u) => u.use.name === run.name)
    const ran = (src: string) => runs.filter((u) => norm((u.use.input as Record<string, unknown>)?.[codeKey]) === norm(src))
    const exec = (src: string, why: string) => callTool(this.ctx, run.name, { [codeKey]: src }, why)

    if (!this.columnsSeen()) {
      const { preview, list } = this.box
      const known = wordIn(this.env, this.ds)
      if (preview) {
        const nameKey = keyOf(preview, /name|dataset|file|table/i) ?? firstKey(preview)
        const nKey = keyOf(preview, /^n$|rows|lines|limit|count|size/i)
        const done = this.uses.some((u) => u.use.name === preview.name && norm((u.use.input as Record<string, unknown>)?.[nameKey]) === this.ds)
        const input = { [nameKey]: this.ds, ...(nKey ? { [nKey]: 5 } : {}) }
        if (known && !done) return callTool(this.ctx, preview.name, input, L(`先预览一下 ${this.ds} 的数据。`, `Previewing ${this.ds} first.`))
        if (!known && list && !this.uses.some((u) => u.use.name === list.name)) return callTool(this.ctx, list.name, {}, L('先看看有哪些数据集。', 'Checking which datasets exist first.'))
        if (!known && !list && !done) return callTool(this.ctx, preview.name, input, L(`先预览一下 ${this.ds} 的数据。`, `Previewing ${this.ds} first.`))
      }
      if (known && !ran(peekCode(this.ds)).length) return exec(peekCode(this.ds), L(`先打印几行 ${this.ds}，看看数据长什么样。`, `Printing a few rows of ${this.ds} to see what the data looks like.`))
      if (!known && this.box.list && !this.uses.some((u) => u.use.name === this.box.list!.name))
        return callTool(this.ctx, this.box.list.name, {}, L('先看看有哪些数据集。', 'Checking which datasets exist first.'))
      if (!this.columnsSeen()) return this.estimate()
    }

    if (this.wantsProfile() && !ran(profileCode(this.ds)).length) return exec(profileCode(this.ds), L(`先检查一下 ${this.ds} 的数据质量。`, `Checking the data quality of ${this.ds} first.`))

    const src = this.code()
    const mine = ran(src)
    if (!mine.length) return exec(src, L('写代码计算。', 'Writing code to compute it.'))
    const out = mine[mine.length - 1].result ?? ''
    const answer = answerIn(out)
    if (isError(out) || answer === undefined) return say(L(`代码运行出错了，我没能算出结果：${out.slice(0, 200)}`, `The code failed and I couldn't compute a result: ${out.slice(0, 200)}`))
    return this.final(out)
  }

  // —————————————— 没有工具：写代码给你运行，或者直接估计 ——————————————
  private textMode() {
    if (!/代码|\bcode\b|javascript|typescript|console\.log/i.test(this.instructions())) return this.estimate()
    if (!this.columnsSeen()) return this.estimate()
    const msgs = this.req.messages
    const lastText = textOfMessage(msgs[msgs.length - 1])
    const prevText = msgs.length >= 2 && msgs[msgs.length - 2].role === 'assistant' ? textOfMessage(msgs[msgs.length - 2]) : ''
    const wroteProfile = msgs.some((m) => m.role === 'assistant' && textOfMessage(m).includes(PROFILE_MARK))
    if (prevText.includes('```') && !prevText.includes(PROFILE_MARK) && !isError(lastText) && answerIn(lastText) !== undefined) return this.final(lastText)
    if (this.wantsProfile() && !wroteProfile) return say(`${L('先检查一下数据质量：', 'First, a data quality check:')}\n\n${codeBlock(profileCode(this.ds))}`)
    return say(codeBlock(this.code()))
  }
}
