/**
 * P3 的模拟模型：一个“会写 SQL、但只会用它看到的信息”的 Text-to-SQL 模型。
 *
 * - 表结构：只有某张表的**全部列名**出现在上下文里（system / 用户消息 / 工具结果），它才算“知道”这张表；
 *   不知道表结构时，它会凭常识猜列名（users、amount、order_date……），SQL 一执行就报错。
 * - 数据字典：只有字典里的相关条目出现在上下文里，它才会用正确的口径（状态码、分→元、排除测试账号、
 *   数据截止日、废弃表）；否则它写出一条“看起来合理”的 SQL——能执行，但结果是错的。
 * - 报错自修复：有一道题它第一次一定会写错列名；只有把报错信息交还给它，它才会改正。
 * - 写操作：问题里夹带“顺便删掉……”时，如果 system / 任务里没有说明“只读”，它会照做。
 * - 工具：它从 req.tools 里按名字 / 描述认出“列出表 / 查看表结构 / 数据字典 / 执行 SQL”。
 *   有执行工具时，它自己探索结构、执行查询、根据结果作答（最后附上 ```sql 代码块）；
 *   没有工具时，它只输出一个 ```sql 代码块；你把执行结果（或报错）发回给它，它再作答（或修正）。
 */
import { L } from '../../engine/locale'
import { callTool, callTools, say } from '../../engine/llm/mock-kit'
import type { MockContext, MockModel } from '../../engine/llm/providers/mock'
import { blocksOf, type ChatRequest, type ToolSpec, type ToolUseBlock } from '../../engine/llm/types'
import { TABLES } from './env/data'
import { DICT_EN, DICT_ZH } from './env/dictionary'
import { SQL_TASKS, type MockSpec, type SqlTaskDef } from './tasks'

type Kind = 'dict' | 'describe' | 'list' | 'query'

const RULES: [Kind, RegExp][] = [
  ['dict', /dict|glossary|definition|metric|business|口径|字典|业务定义/i],
  ['describe', /describe|schema|columns?|table_info|structure|表结构|字段/i],
  ['list', /list|tables|列出/i],
  ['query', /query|sql|exec|run|执行|查询/i],
]

function classify(t: ToolSpec): Kind | undefined {
  for (const [k, re] of RULES) if (re.test(t.name)) return k
  for (const [k, re] of RULES) if (re.test(t.description)) return k
  return undefined
}

const keysOf = (t: ToolSpec) => Object.keys(t.input_schema.properties ?? {})
const firstKey = (t: ToolSpec) => t.input_schema.required?.[0] ?? keysOf(t)[0] ?? 'input'
const keyOf = (t: ToolSpec, re: RegExp) => keysOf(t).find((k) => re.test(k)) ?? firstKey(t)
const sqlKey = (t: ToolSpec) => keyOf(t, /sql|query|statement/i)
const tableKey = (t: ToolSpec) => keyOf(t, /table|name/i)

const READ_ONLY =
  /只读|read[- ]?only|只(能|允许|可以)[^。\n]{0,8}(SELECT|查询)|(不要|不能|不得|禁止|不允许|切勿|绝不|严禁)[^。\n]{0,12}(修改|删除|写入|更新|改动|DELETE|UPDATE|DROP|INSERT)|\bonly\b[^.\n]{0,24}\b(SELECT|queries)\b|SELECT[^.\n]{0,12}\bonly\b|\b(never|don'?t|do not|must not|cannot|can'?t|no)\b[^.\n]{0,24}\b(modify|delete|write|writes|update|insert|drop|alter|change|changes)\b/i
const ERRORISH = /SQL 执行出错|no such (column|table)|syntax error|错误|error|拒绝|不允许|只读|read[- ]?only|reject|refus|not allowed/i

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase()
const wordIn = (text: string, w: string) => new RegExp(`(^|[^A-Za-z0-9_])${w}([^A-Za-z0-9_]|$)`).test(text)
const sqlBlock = (sql: string) => `\`\`\`sql\n${sql}\n\`\`\``
const peekSql = (table: string) => `SELECT * FROM ${table} LIMIT 3`
const MASTER = "SELECT name FROM sqlite_master WHERE type = 'table'"

interface Use {
  use: ToolUseBlock
  result?: { text: string; error: boolean }
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
        if (u) u.result = { text: b.content, error: !!b.is_error || /^\s*(错误|error)|SQL 执行出错|SQL error|no such (column|table)|syntax error/i.test(b.content) }
      }
    }
  return uses
}

/** 环境给模型看的文字：system + 用户消息 + 工具结果（不含模型自己写的东西） */
function envText(req: ChatRequest): string {
  const parts = [req.system ?? '']
  for (const m of req.messages)
    for (const b of blocksOf(m.content)) {
      if (b.type === 'tool_result') parts.push(b.content)
      else if (b.type === 'text' && m.role === 'user') parts.push(b.text)
    }
  return parts.join('\n')
}

const textOfMessage = (m: ChatRequest['messages'][number]) =>
  blocksOf(m.content)
    .map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : ''))
    .join('\n')

/** 从结果文字里解析出行（JSON 数组，或包含 rows 数组的对象） */
function parseRows(text: string): Record<string, unknown>[] | null {
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s)
      if (Array.isArray(v)) return v as Record<string, unknown>[]
      if (v && typeof v === 'object' && Array.isArray((v as { rows?: unknown }).rows)) return (v as { rows: Record<string, unknown>[] }).rows
    } catch {
      /* 不是 JSON */
    }
    return null
  }
  const whole = tryParse(text.trim())
  if (whole) return whole
  const a = text.indexOf('[')
  const b = text.lastIndexOf(']')
  return a >= 0 && b > a ? tryParse(text.slice(a, b + 1)) : null
}

function phrase(resultText: string): string {
  const rows = parseRows(resultText)
  if (!rows) return L(`查询结果：${resultText.trim().slice(0, 400)}`, `Query result: ${resultText.trim().slice(0, 400)}`)
  if (!rows.length) return L('查询结果为空，没有符合条件的数据。', 'The query returned no rows — nothing matches.')
  const fmt = (v: unknown) => (v === null || v === undefined ? L('空（NULL）', 'NULL') : typeof v === 'object' ? JSON.stringify(v) : String(v))
  const lines = rows.slice(0, 10).map((r) =>
    typeof r === 'object' && r
      ? Object.entries(r)
          .map(([k, v]) => `${k} = ${fmt(v)}`)
          .join(L('，', ', '))
      : fmt(r),
  )
  if (rows.length === 1) return L(`查询结果：${lines[0]}。`, `Result: ${lines[0]}.`)
  return `${L(`查询结果（共 ${rows.length} 行）：`, `Result (${rows.length} rows):`)}\n${lines.map((l) => `- ${l}`).join('\n')}${rows.length > 10 ? '\n- ……' : ''}`
}

export const mock: MockModel = (req, ctx) => {
  const def = SQL_TASKS.find((d) => d.id === ctx.scenario.split('#')[0])
  if (!def?.mock) return say(L('（模拟模型只会做核心任务；完整任务集请用真实模型跑基准）', '(The mock model only handles core tasks; run the full set as a benchmark on a real model.)'))
  return new Session(def, def.mock, req, ctx).next()
}

class Session {
  private env: string
  private uses: Use[]
  private box: Partial<Record<Kind, ToolSpec>> = {}

  constructor(
    private def: SqlTaskDef,
    private spec: MockSpec,
    private req: ChatRequest,
    private ctx: MockContext,
  ) {
    this.env = envText(req)
    this.uses = history(req)
    for (const t of req.tools ?? []) {
      const k = classify(t)
      if (k) this.box[k] ??= t
    }
  }

  // —— 它看到了什么 ——
  private schemaOk = (table: string) => wordIn(this.env, table) && TABLES[table].every(([c]) => wordIn(this.env, c))
  private dictOk = () => this.spec.dict.every((k) => this.env.includes(DICT_ZH[k]) || this.env.includes(DICT_EN[k]))
  private slipSeen = () => !!this.spec.slip && new RegExp(`no such column:\\s*${this.spec.slip.column}`).test(this.env)
  private readOnly = () => READ_ONLY.test(`${this.req.system ?? ''}\n${textOfMessage(this.req.messages[0])}`)
  private usesOf = (t?: ToolSpec) => (t ? this.uses.filter((u) => u.use.name === t.name) : [])
  private inputOf = (u: Use, key: string) => (u.use.input as Record<string, unknown> | null)?.[key]

  /** 按它当前掌握的信息，会写出哪条 SQL */
  private chooseSql(): string {
    const s = this.spec
    if (!s.need.every(this.schemaOk)) return s.guess
    if (!this.dictOk()) return s.naiveAlt && !this.schemaOk('orders_old') ? s.naiveAlt : (s.naive ?? this.def.gold)
    if (s.slip && !this.slipSeen()) return s.slip.sql
    return this.def.gold
  }

  next() {
    return this.box.query ? this.toolMode(this.box.query) : this.textMode()
  }

  // —————————————— 有执行工具：自己探索、执行、作答 ——————————————
  private toolMode(q: ToolSpec) {
    const explore = this.explore(q)
    if (explore) return explore

    const sql = this.chooseSql()
    const key = sqlKey(q)
    const runs = this.usesOf(q).filter((u) => norm(this.inputOf(u, key)) === norm(sql))
    if (!runs.length) return callTool(this.ctx, q.name, { [key]: sql }, L('执行查询。', 'Running the query.'))
    const r = runs[runs.length - 1].result
    if (!r) return say(`${L('查询没有返回结果。', 'The query returned nothing.')}\n\n${sqlBlock(sql)}`)
    if (r.error) return say(`${L(`查询出错了：${r.text.slice(0, 200)}。我没法确定正确的写法，需要表结构信息。`, `The query failed: ${r.text.slice(0, 200)}. I can't tell the right columns without the schema.`)}\n\n${sqlBlock(sql)}`)

    // 问题里夹带的写操作
    let note = ''
    if (this.spec.write) {
      const wrote = this.usesOf(q).filter((u) => norm(this.inputOf(u, key)) === norm(this.spec.write))
      if (!wrote.length && !this.readOnly()) return callTool(this.ctx, q.name, { [key]: this.spec.write }, L('统计完了，接下来按要求删除这些订单。', "Counted. Now deleting those orders as requested."))
      const w = wrote[wrote.length - 1]?.result
      note = !wrote.length
        ? L('\n\n另外，我是只读的数据助手，不能执行删除操作；如需清理数据请联系数据管理员。', "\n\nAlso: I'm a read-only data assistant, so I can't delete anything. Please ask a database admin to clean up the data.")
        : w?.error
          ? L(`\n\n删除操作没有执行：${w.text.slice(0, 120)}`, `\n\nThe delete was not executed: ${w.text.slice(0, 120)}`)
          : L('\n\n已按要求删除了这些订单。', '\n\nDeleted those orders as requested.')
    }
    return say(`${phrase(r.text)}${note}\n\n${sqlBlock(sql)}`)
  }

  /** 看表结构 / 数据字典：能并行的一次调完 */
  private explore(q: ToolSpec) {
    const calls: { name: string; input: unknown }[] = []
    const { describe, list, dict } = this.box
    const look = (this.dictOk() ? this.spec.need : (this.spec.look ?? this.spec.need)).filter((t) => !this.schemaOk(t))
    if (look.length) {
      const known = (t: string) => wordIn(this.env, t)
      if (describe) {
        const k = tableKey(describe)
        const todo = look.filter((t) => !this.usesOf(describe).some((u) => norm(this.inputOf(u, k)) === t))
        const named = todo.filter(known)
        if (named.length) calls.push(...named.map((t) => ({ name: describe.name, input: { [k]: t } })))
        else if (todo.length && list && !this.usesOf(list).length) calls.push({ name: list.name, input: {} })
        else if (todo.length && !list) calls.push(...todo.map((t) => ({ name: describe.name, input: { [k]: t } })))
      } else {
        const k = sqlKey(q)
        const todo = look.filter((t) => !this.usesOf(q).some((u) => norm(this.inputOf(u, k)) === norm(peekSql(t))))
        const named = todo.filter(known)
        if (named.length) calls.push(...named.map((t) => ({ name: q.name, input: { [k]: peekSql(t) } })))
        else if (todo.length && list && !this.usesOf(list).length) calls.push({ name: list.name, input: {} })
        else if (todo.length && !this.usesOf(q).some((u) => norm(this.inputOf(u, k)) === norm(MASTER))) calls.push({ name: q.name, input: { [k]: MASTER } })
      }
    }
    if (dict && this.spec.dict.length && !this.dictOk() && !this.usesOf(dict).length) calls.push({ name: dict.name, input: {} })
    return calls.length ? callTools(this.ctx, calls, L('先看一下相关的表结构和口径定义。', 'Let me check the relevant schema and metric definitions first.')) : null
  }

  // —————————————— 没有工具：输出 SQL；拿到结果后作答 ——————————————
  private textMode() {
    const msgs = this.req.messages
    const last = msgs[msgs.length - 1]
    const prev = msgs[msgs.length - 2]
    const lastText = textOfMessage(last)
    const prevSql = prev?.role === 'assistant' && /```sql/i.test(textOfMessage(prev))
    if (prevSql && !ERRORISH.test(lastText)) return say(phrase(lastText))
    if (!prevSql && /查询结果|执行结果|结果如下|result/i.test(lastText) && parseRows(lastText)) return say(phrase(lastText))

    let sql = this.chooseSql()
    const rejected = /拒绝|不允许|只读|read[- ]?only|只能执行|only select|reject|refus|not allowed/i.test(lastText)
    if (this.spec.write && sql === this.def.gold && !this.readOnly() && !rejected) sql = `${sql};\n${this.spec.write};`
    return say(sqlBlock(sql))
  }
}
