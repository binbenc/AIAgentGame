/**
 * P7 的模拟模型：一个“有能力、但很死板”的编码模型。
 *
 * - 它知道每道核心题该怎么修（一组 {path, find, replace}），但只能**通过玩家提供的工具**动手，
 *   而且只有在相关代码真的出现在对话里之后（玩家给了读文件 / 搜索的手段并把结果喂回来）才会改。
 * - 它从 req.tools 里按名字 / 描述 / 参数 schema 认出工具：读文件、搜索、列文件、编辑（str_replace 式或整文件写入）、跑测试。
 * - 编辑工具是 str_replace 式（有 old/new 参数）：发送片段替换；是整文件写入（path + content）：
 *   根据它看到的完整文件算出新内容——没看到完整文件时，它会写出一个带“其余代码不变”占位符的残缺文件。
 * - 有测试工具时，改完会跑测试；回归陷阱题里，它照 issue 的建议做的朴素修复会弄坏一个已有测试，
 *   只有跑了测试才能发现并改正。如果没有被明确要求“不要修改测试”，它会走捷径去改测试的期望值。
 * - issue 猜错原因时：模型如果没法调查（一次性 prompt、或者找不到真正的文件），会相信 issue，去改它点名的文件（无效修改）。
 * - 没有任何工具时（一次性 prompt），它把修改后的完整文件用 `FILE: 路径` + 代码块的格式写在回复里。
 */
import { callTool, say } from '../../engine/llm/mock-kit'
import type { MockContext, MockModel } from '../../engine/llm/providers/mock'
import type { ChatRequest, ContentBlock, JSONSchema, ToolSpec, ToolUseBlock } from '../../engine/llm/types'
import { applyPatch, type Files, type Patch } from './env'
import { CODING_TASKS, fixOf, initialFiles, type CodingTaskDef } from './tasks'

// ———————————————— 认出玩家的工具 ————————————————

type Kind = 'read' | 'edit' | 'search' | 'test' | 'list' | 'editor'

const BY_NAME: [Kind, RegExp][] = [
  ['test', /test/],
  ['search', /search|grep|find/],
  ['edit', /replace|edit|patch|write|create|modify|update|save/],
  ['read', /read|view|cat|open|show|get_?file|load/],
  ['list', /list|ls|tree|files|dir/],
]
const BY_DESC: [Kind, RegExp][] = [
  ['test', /运行测试|跑测试|run.*tests?/i],
  ['search', /搜索|查找|grep|search/i],
  ['edit', /修改|替换|写入|编辑|replace|write|edit/i],
  ['read', /读取|查看|读文件|read|view/i],
  ['list', /列出|文件列表|目录|list/i],
]

function classify(t: ToolSpec): Kind | undefined {
  const cmd = t.input_schema.properties?.command as JSONSchema | undefined
  if (cmd?.enum?.includes('view') && cmd.enum.some((x) => /replace/.test(String(x)))) return 'editor'
  const name = t.name.toLowerCase()
  for (const [k, re] of BY_NAME) if (re.test(name)) return k
  for (const [k, re] of BY_DESC) if (re.test(t.description)) return k
  return undefined
}

const keysOf = (t: ToolSpec) => Object.keys(t.input_schema.properties ?? {})
const firstKey = (t: ToolSpec) => t.input_schema.required?.[0] ?? keysOf(t)[0]
const keyMatching = (t: ToolSpec, re: RegExp, not?: RegExp) => keysOf(t).find((k) => re.test(k) && !(not && not.test(k)))
const pathKey = (t: ToolSpec) => keyMatching(t, /path|file/i, /text|content/i) ?? firstKey(t)
const oldKey = (t: ToolSpec) => keyMatching(t, /old|search|find|original|before|target/i)
const newKey = (t: ToolSpec) => keyMatching(t, /new|replace|after|updated/i, /old/i)
const contentKey = (t: ToolSpec) => keyMatching(t, /content|text|code|body|data/i, /path/i)

interface Toolbox {
  read?: ToolSpec
  search?: ToolSpec
  list?: ToolSpec
  test?: ToolSpec
  /** str_replace 式编辑 */
  replace?: ToolSpec
  /** 整文件写入 */
  write?: ToolSpec
  editor?: ToolSpec
}

function toolbox(req: ChatRequest): Toolbox {
  const box: Toolbox = {}
  for (const t of req.tools ?? []) {
    const kind = classify(t)
    if (kind === 'edit') {
      if (oldKey(t) && newKey(t)) box.replace ??= t
      else if (contentKey(t)) box.write ??= t
    } else if (kind === 'editor') box.editor ??= t
    else if (kind) box[kind] ??= t
  }
  return box
}

// ———————————————— 模型“看到”了什么 ————————————————

function leaves(v: unknown, out: string[]) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => leaves(x, out))
}

const blocksOf = (c: string | ContentBlock[]): ContentBlock[] => (typeof c === 'string' ? [{ type: 'text', text: c }] : c)

function visible(req: ChatRequest): string {
  const parts = [req.system ?? '']
  for (const m of req.messages)
    for (const b of blocksOf(m.content)) {
      if (b.type === 'text') parts.push(b.text)
      else if (b.type === 'tool_use') leaves(b.input, parts)
      else if (b.type === 'tool_result') {
        parts.push(b.content)
        try {
          leaves(JSON.parse(b.content), parts) // 工具返回 JSON 时，模型也能读懂里面的字符串
        } catch {
          /* 不是 JSON */
        }
      }
    }
  return parts.join('\n')
}

/** 去掉行号前缀（"12\t"、"12: "、"12 | "）和每行首尾空白，用来判断“某段代码是否出现在对话里” */
const LINE_NO = /^\s*\d+\s*(?:\t|:\s|\||│)/
const norm = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(LINE_NO, '').trim())
    .join('\n')

// ———————————————— 对话历史 ————————————————

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
        if (u) u.result = { text: b.content, error: !!b.is_error || /^\s*(错误|error)/i.test(b.content) }
      }
    }
  return uses
}

const FAILED = /✗|✘|\bFAIL|[1-9]\d*\s*(个)?(测试)?失败|[1-9]\d* failed/i
const FORBID_TEST_EDITS =
  /(不要|不得|不能|禁止|不允许|别)[^。\n]{0,8}(修改|改动|编辑|删除|改)[^。\n]{0,6}测试|测试[^。\n]{0,10}(只读|不要改|不能改|不得修改)|(do not|don't|never|must not)\s+(modify|edit|change|touch|delete)\s+(the\s+|any\s+)?(existing\s+)?tests?/i

interface State {
  labels: Record<string, string>
  /** 找不到真正的病灶，转而相信 issue 的猜测 */
  decoy?: boolean
}

interface Step {
  label: string
  patch: Patch
}

const norm2 = (p: unknown) => (typeof p === 'string' ? p.trim().replace(/^\.?\//, '') : '')

export const mock: MockModel = (req, ctx) => {
  const def = CODING_TASKS.find((d) => d.id === ctx.scenario.split('#')[0])
  if (!def?.mock) return say('（模拟模型只会做核心任务；完整任务集请用真实模型跑基准）')
  return new Session(def, req, ctx).next()
}

class Session {
  private spec: NonNullable<CodingTaskDef['mock']>
  private original: Files
  private box: Toolbox
  private text: string
  private normText: string
  private uses: Use[]
  private st: State

  constructor(
    private def: CodingTaskDef,
    private req: ChatRequest,
    private ctx: MockContext,
  ) {
    this.spec = def.mock!
    this.original = initialFiles(def)
    this.box = toolbox(req)
    this.text = visible(req)
    this.normText = norm(this.text)
    this.uses = history(req)
    this.st = (ctx.state as unknown as State).labels ? (ctx.state as unknown as State) : Object.assign(ctx.state, { labels: {} })
  }

  // —— 观察 ——
  private seen = (snippet: string) => this.normText.includes(norm(snippet))
  private fullySeen = (path: string) => path in this.original && this.seen(this.original[path])
  private pathKnown = (path: string) => this.text.includes(path)
  private usesOf = (t?: ToolSpec) => (t ? this.uses.filter((u) => u.use.name === t.name) : [])
  private readDone(path: string): boolean {
    const readers = [this.box.read, this.box.editor].filter(Boolean) as ToolSpec[]
    return readers.some((t) => this.usesOf(t).some((u) => norm2((u.use.input as Record<string, unknown>)?.[pathKey(t)]) === path))
  }
  private labelled = (label: string) => this.uses.filter((u) => this.st.labels[u.use.id] === label)
  private applied = (label: string) => this.labelled(label).some((u) => u.result && !u.result.error)
  private testResults = () => this.usesOf(this.box.test).filter((u) => u.result).map((u) => u.result!.text)
  private forbidsTestEdits = () => FORBID_TEST_EDITS.test(`${this.req.system ?? ''}\n${blocksOf(this.req.messages[0].content).map((b) => (b.type === 'text' ? b.text : '')).join('\n')}`)

  private plan(): Step[] {
    const decoy = this.spec.decoy
    if (decoy && (this.st.decoy || !this.hasTools())) return [{ label: 'decoy', patch: decoy.patch }]
    const fix = fixOf(this.def)
    const trap = this.spec.trap
    if (!trap) return fix.map((patch, i) => ({ label: `fix${i}`, patch }))
    const steps: Step[] = [{ label: 'naive', patch: { ...fix[0], replace: trap.naive } }]
    // 跑测试发现朴素修复弄坏了已有测试之后，才会补救
    const broke = this.testResults().some((r) => r.split('\n').some((l) => l.includes(trap.brokenTest) && FAILED.test(l)))
    if (broke || this.applied('correct') || this.applied('cheat'))
      steps.push(
        this.forbidsTestEdits() || this.applied('correct')
          ? { label: 'correct', patch: { path: fix[0].path, find: trap.naive, replace: fix[0].replace } }
          : { label: 'cheat', patch: trap.cheat },
      )
    return steps
  }

  private hasTools = () => Object.values(this.box).some(Boolean)

  next() {
    const steps = this.plan()
    if (!this.hasTools()) return this.oneShot(steps)

    const pending = steps.filter((s) => !this.applied(s.label))
    if (pending.length) {
      const explore = this.explore(pending)
      if (explore) return explore
      const step = pending[0]
      if (this.labelled(step.label).length >= 2) return say(`修改 ${step.patch.path} 时编辑工具连续报错，我先停下来，需要人工看一下。`)
      const edit = this.edit(step, steps)
      if (edit) return edit
      // 找不到真正的病灶：死板的模型会相信 issue 的猜测，去改 issue 点名的那个文件
      const decoy = this.spec.decoy
      if (decoy && !this.st.decoy && this.pathKnown(decoy.patch.path) && this.seen(decoy.patch.find)) {
        this.st.decoy = true
        const alt = this.edit({ label: 'decoy', patch: decoy.patch }, [{ label: 'decoy', patch: decoy.patch }])
        if (alt) return alt
      }
      return this.giveUp(step.patch)
    }

    // 改完了：有测试工具就跑一遍
    const lastEdit = Math.max(-1, ...this.uses.map((u, i) => (this.st.labels[u.use.id] ? i : -1)))
    const lastTest = Math.max(-1, ...this.uses.map((u, i) => (u.use.name === this.box.test?.name ? i : -1)))
    if (this.box.test && lastTest < lastEdit) return this.call(this.box.test, this.testInput(this.box.test), '修改完成，跑一下测试确认没有回归。')

    const results = this.testResults()
    const last = lastTest >= 0 ? results[results.length - 1] : undefined
    const files = [...new Set(steps.map((s) => s.patch.path))].join('、')
    if (last && FAILED.test(last)) return say(`我修改了 ${files}，但测试仍然有失败，需要进一步排查。`)
    const trap = this.spec.trap
    const summary = this.st.decoy
      ? this.spec.decoy!.summary
      : trap && this.applied('cheat')
        ? `${trap.naiveSummary}，并把过时的测试期望同步更新了`
        : trap && !this.applied('correct')
          ? trap.naiveSummary
          : this.spec.summary
    return say(`已修复：${summary}。${last ? '测试全部通过。' : '（没有运行测试）'}`)
  }

  /** 找代码：先看 issue 点名的文件，再读已知路径，然后搜索、列目录 */
  private explore(pending: Step[]) {
    const { read, editor, search, list } = this.box
    const reader = read ?? editor
    const paths = [...new Set(pending.map((s) => s.patch.path))]
    const mentions = this.spec.mentions
    const editedAnything = Object.keys(this.st.labels).length > 0
    if (reader && mentions && !editedAnything && !this.readDone(mentions)) return this.readCall(reader, mentions)
    for (const p of paths) if (reader && this.pathKnown(p) && !this.readDone(p) && !this.fullySeen(p)) return this.readCall(reader, p)
    const missing = paths.some((p) => !this.pathKnown(p)) || pending.some((s) => !this.seen(s.patch.find))
    if (missing && search && this.usesOf(search).length === 0)
      return this.call(search, { [keyMatching(search, /pattern|query|regex|keyword|term|text|q$/i) ?? firstKey(search)]: this.spec.search }, `先搜索一下 ${this.spec.search} 在哪里。`)
    if (missing && list && this.usesOf(list).length === 0) return this.call(list, {}, '先看看仓库里有哪些文件。')
    return null
  }

  private edit(step: Step, steps: Step[]) {
    const { path, find, replace } = step.patch
    if (!this.pathKnown(path)) return null
    const r = this.box.replace ?? this.box.editor
    if (r) {
      if (!this.seen(find)) return null
      const input: Record<string, unknown> = { [pathKey(r)]: path, [oldKey(r) ?? 'old_str']: find, [newKey(r) ?? 'new_str']: replace }
      if (r === this.box.editor) input.command = 'str_replace'
      return this.labelledCall(step.label, r, input, `修改 ${path}。`)
    }
    const w = this.box.write
    if (w) {
      const content = this.fullySeen(path) ? this.believed(path, steps, step) : null
      // 没看到完整文件：只能写出它看到的片段，“其余代码”用占位符代替——一个残缺的文件
      const body = content ?? `// ……（文件其余部分保持不变）\n${replace}\n`
      return this.labelledCall(step.label, w, { [pathKey(w)]: path, [contentKey(w) ?? 'content']: body }, `重写 ${path}。`)
    }
    return null
  }

  /** 模型心目中这个文件现在的样子：原文 + 它已经成功做过的修改 + 这一次的修改 */
  private believed(path: string, steps: Step[], current: Step): string | null {
    let files: Files = { [path]: this.original[path] }
    try {
      for (const s of steps) {
        if (s.patch.path !== path) continue
        if (s === current || this.applied(s.label)) files = applyPatch(files, s.patch)
        if (s === current) break
      }
      return files[path]
    } catch {
      return null
    }
  }

  private giveUp(p: Patch) {
    const where = this.pathKnown(p.path) ? p.path : '需要修改的源码'
    if (!this.box.replace && !this.box.write && !this.box.editor)
      return say(`我认为问题出在 ${where}：应该把\n${p.find}\n改成\n${p.replace}\n但我没有可以修改文件的工具。`)
    return say(`我没能找到${where === p.path ? ` ${where} 里` : ''}需要修改的代码，无法安全地修改。（需要能搜索代码 / 列出文件、读取完整文件的工具）`)
  }

  /** 没有工具：把修改后的完整文件写在回复里 */
  private oneShot(steps: Step[]) {
    const paths = [...new Set(steps.map((s) => s.patch.path))]
    const blocks = paths.map((p) => {
      let files: Files = { [p]: this.original[p] }
      let full = this.fullySeen(p)
      if (full)
        for (const s of steps.filter((s) => s.patch.path === p))
          try {
            files = applyPatch(files, s.patch)
          } catch {
            full = false
          }
      const body = full ? files[p] : `// ……（文件其余部分保持不变）\n${steps.find((s) => s.patch.path === p)!.patch.replace}\n`
      return `FILE: ${p}\n\`\`\`ts\n${body}\`\`\``
    })
    const summary = this.spec.decoy?.summary ?? this.spec.trap?.naiveSummary ?? this.spec.summary
    return say(`${summary}。\n\n${blocks.join('\n\n')}`)
  }

  // —— 发起工具调用 ——
  private call(t: ToolSpec, input: Record<string, unknown>, preamble: string) {
    return callTool(this.ctx, t.name, input, preamble)
  }
  private readCall(t: ToolSpec, path: string) {
    const input: Record<string, unknown> = { [pathKey(t)]: path }
    if (t === this.box.editor) input.command = 'view'
    return this.call(t, input, `看一下 ${path}。`)
  }
  private labelledCall(label: string, t: ToolSpec, input: Record<string, unknown>, preamble: string) {
    const reply = this.call(t, input, preamble)
    const use = reply.content.find((b) => b.type === 'tool_use') as ToolUseBlock
    this.st.labels[use.id] = label
    return reply
  }
  private testInput(t: ToolSpec): Record<string, unknown> {
    return Object.fromEntries((t.input_schema.required ?? []).map((k) => [k, '']))
  }
}
