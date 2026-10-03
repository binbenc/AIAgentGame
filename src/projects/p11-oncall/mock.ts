/**
 * P11 的模拟模型：一个“有经验、但只相信它亲眼看到的证据”的 on-call 工程师。
 *
 * - 它从 req.tools 里按名字 / 描述认出玩家给的工具：拓扑、服务列表、指标、日志、变更历史、手册、审批、各种处置
 *   （也支持一个带 action 枚举参数的“组合处置工具”）。
 * - 它知道每道核心题该沿着哪条线索查（调查计划），但**只有证据真的出现在对话里**（对应的工具调用有结果，
 *   而且结果里有关键原文）才往下走。没有拓扑工具，它就只能怪罪告警服务；工具输出被截断、丢了关键日志，也一样。
 * - 处置：
 *   · 有独立的审批工具：先申请审批，批准后再执行；处置工具自带 reason 参数：把理由写进去；都没有：直接执行。
 *   · system 里要求“审批理由要有证据”，它的理由才会写明根因服务和指标 / 日志；否则只写一句“恢复服务”。
 *   · system 里没有“最小处置”“误报不操作”“第三方故障要升级”“变更必须早于异常”这些规矩时，它会按直觉行事
 *     （顺手重启受影响的服务、重启告警服务、怪罪最近发过版的那个服务）。
 *   · 手册里的步骤（例如先关开关再重启）只有拿到手册才知道。审批被驳回就停下来。
 * - 最终回答：system 要求 JSON 才输出 JSON；要求复盘格式才写【影响】【根因】【证据】【处置】。
 */
import { callTool, callTools, say } from '../../engine/llm/mock-kit'
import { L } from '../../engine/locale'
import type { MockContext, MockModel } from '../../engine/llm/providers/mock'
import { blocksOf, type ChatRequest, type JSONSchema, type ToolSpec } from '../../engine/llm/types'
import { ONCALL_TASKS, RULES, type Ev, type MockAct, type MockPlan, type OncallOutput } from './tasks'

// ———————————————— 认出玩家的工具 ————————————————

type Kind = 'approval' | 'runbook' | 'topology' | 'services' | 'metrics' | 'deploys' | 'logs' | 'rollback' | 'restart' | 'scale' | 'toggleFlag' | 'failover'
const KINDS: [Kind, RegExp][] = [
  ['approval', /approv|审批/i],
  ['runbook', /runbook|playbook|手册|sop/i],
  ['topology', /topolog|拓扑|dependenc|依赖关系/i],
  ['services', /list_?services|服务列表/i],
  ['metrics', /metric|指标/i],
  ['deploys', /deploy|release|change|发布|变更/i],
  ['logs', /log|日志/i],
  ['rollback', /rollback|roll_back|回滚/i],
  ['restart', /restart|重启/i],
  ['scale', /scale|扩容|缩容|replica/i],
  ['toggleFlag', /flag|开关/i],
  ['failover', /failover|主从切换|故障切换/i],
]
const REMEDIES = new Set<Kind>(['rollback', 'restart', 'scale', 'toggleFlag', 'failover'])

interface Handle {
  tool: ToolSpec
  action?: [string, string]
}
type Box = Partial<Record<Kind, Handle>>

function toolbox(req: ChatRequest): Box {
  const box: Box = {}
  for (const t of req.tools ?? []) {
    const props = (t.input_schema.properties ?? {}) as Record<string, JSONSchema>
    const actKey = Object.keys(props).find((k) => /^(action|command|op|operation)$/i.test(k) && Array.isArray(props[k].enum))
    if (actKey && !/approv|审批/i.test(t.name)) {
      for (const v of props[actKey].enum as unknown[]) {
        const kind = KINDS.find(([k, re]) => REMEDIES.has(k) && (re.test(String(v)) || String(v).toLowerCase() === k.toLowerCase()))?.[0]
        if (kind && !box[kind]) box[kind] = { tool: t, action: [actKey, String(v)] }
      }
      continue
    }
    const kind = KINDS.find(([, re]) => re.test(t.name))?.[0] ?? KINDS.find(([, re]) => re.test(t.description))?.[0]
    if (kind && !box[kind]) box[kind] = { tool: t }
  }
  return box
}

const propsOf = (t: ToolSpec) => (t.input_schema.properties ?? {}) as Record<string, JSONSchema>
const keyOf = (t: ToolSpec, re: RegExp, not?: RegExp) => Object.keys(propsOf(t)).find((k) => re.test(k) && !(not && not.test(k)))
const numeric = (t: ToolSpec, k: string) => ['integer', 'number'].includes(String(propsOf(t)[k]?.type))

function readInput(h: Handle, ev: Ev): Record<string, unknown> {
  const t = h.tool
  const input: Record<string, unknown> = {}
  if (ev.service) input[keyOf(t, /service|name|target|component/i) ?? 'service'] = ev.service
  if (ev.metric) input[keyOf(t, /metric/i) ?? 'metric'] = ev.metric
  if (ev.kind === 'logs') input[keyOf(t, /query|keyword|pattern|filter|search|^q$/i) ?? 'query'] = ev.query ?? ''
  const w = keyOf(t, /window|minutes|range|duration/i)
  if (w && (ev.kind === 'metrics' || ev.kind === 'logs')) input[w] = numeric(t, w) ? 60 : '60'
  return input
}

function actInput(h: Handle, a: MockAct, reason?: string): Record<string, unknown> {
  const t = h.tool
  const input: Record<string, unknown> = {}
  if (h.action) input[h.action[0]] = h.action[1]
  if (a.action === 'toggleFlag') input[keyOf(t, /^name$|flag/i) ?? 'name'] = a.target
  else if (a.action === 'failover') input[keyOf(t, /cluster|db|service|target|name/i) ?? 'cluster'] = a.target
  else input[keyOf(t, /service|target|name|component/i) ?? 'service'] = a.target
  if (a.version !== undefined) input[keyOf(t, /version/i) ?? 'version'] = a.version
  if (a.replicas !== undefined) {
    const k = keyOf(t, /replica|count|^n$|num/i) ?? 'replicas'
    input[k] = numeric(t, k) || !propsOf(t)[k] ? a.replicas : String(a.replicas)
  }
  if (a.on !== undefined) input[keyOf(t, /^on$|enable|enabled|state|value/i) ?? 'on'] = a.on
  const r = keyOf(t, /reason|justification|why|理由/i)
  if (r && reason !== undefined) input[r] = reason
  return input
}

function approvalInput(h: Handle, a: MockAct, reason: string): Record<string, unknown> {
  const t = h.tool
  const args: Record<string, unknown> = a.action === 'toggleFlag' ? { name: a.target, on: a.on } : a.action === 'failover' ? { cluster: a.target } : { service: a.target }
  if (a.version !== undefined) args.version = a.version
  if (a.replicas !== undefined) args.replicas = a.replicas
  const argsKey = keyOf(t, /^args$|params|arguments|parameters/i)
  const base = { [keyOf(t, /action|operation|command/i) ?? 'action']: a.action, [keyOf(t, /reason|justification|why|理由/i) ?? 'reason']: reason }
  return argsKey ? { ...base, [argsKey]: args } : { ...base, ...args }
}

// ———————————————— 读对话历史 ————————————————

interface Use {
  name: string
  input: Record<string, unknown>
  inputText: string
  result?: string
  error: boolean
}

function history(req: ChatRequest): Use[] {
  const uses: Use[] = []
  const byId = new Map<string, Use>()
  for (const m of req.messages)
    for (const b of blocksOf(m.content)) {
      if (b.type === 'tool_use') {
        const input = (b.input ?? {}) as Record<string, unknown>
        const u: Use = { name: b.name, input, inputText: JSON.stringify(input), error: false }
        uses.push(u)
        byId.set(b.id, u)
      } else if (b.type === 'tool_result') {
        const u = byId.get(b.tool_use_id)
        if (u) {
          u.result = b.content
          u.error = !!b.is_error || /^\s*(错误|error)/i.test(b.content)
        }
      }
    }
  return uses
}

const REJECTED = /驳回|"approved"\s*:\s*false|rejected|未通过|不批准/i
const APPROVED = /"approved"\s*:\s*true|批准[：:]|审批通过|已批准|\bapproved\b[：:]|approved by/i

class Oncall {
  box: Box
  uses: Use[]
  sys: string

  constructor(
    req: ChatRequest,
    private plan: MockPlan,
    private root: OncallOutput['rootCause'],
    private ctx: MockContext,
  ) {
    this.box = toolbox(req)
    this.uses = history(req)
    this.sys = req.system ?? ''
  }

  usesOf = (k: Kind) => {
    const h = this.box[k]
    return h ? this.uses.filter((u) => u.name === h.tool.name && (!h.action || u.input[h.action[0]] === h.action[1])) : []
  }
  private matches(u: Use, ev: Ev) {
    return [ev.service, ev.metric].every((x) => !x || u.inputText.includes(`"${x}"`))
  }
  attempted = (ev: Ev) => this.usesOf(ev.kind).some((u) => this.matches(u, ev))
  satisfied = (ev: Ev) => this.usesOf(ev.kind).some((u) => this.matches(u, ev) && u.result !== undefined && !u.error && (!ev.marker || u.result.includes(ev.marker)))

  /** 沿调查计划取证：返回下一批要查的证据，或者“证据齐了 / 断了” */
  investigate(): { next: Ev[] } | { complete: boolean } {
    const hops = [...new Set(this.plan.evidence.map((e) => e.hop))].sort((a, b) => a - b)
    for (const hop of hops) {
      const pending = this.plan.evidence.filter((e) => e.hop === hop && !this.satisfied(e))
      if (!pending.length) continue
      const next = pending.filter((e) => this.box[e.kind] && !this.attempted(e))
      if (next.length) return { next }
      return { complete: false }
    }
    return { complete: true }
  }

  run() {
    const inv = this.investigate()
    if ('next' in inv) {
      const calls = inv.next.map((e) => ({ name: this.box[e.kind]!.tool.name, input: readInput(this.box[e.kind]!, e) }))
      const what = inv.next.map((e) =>
        e.kind === 'topology'
          ? L('依赖拓扑', 'the dependency topology')
          : L(`${e.service} 的${e.kind === 'metrics' ? ` ${e.metric} 指标` : e.kind === 'logs' ? '日志' : '变更历史'}`, `${e.service} ${e.kind === 'metrics' ? e.metric : e.kind === 'logs' ? 'logs' : 'change history'}`),
      )
      return callTools(this.ctx, calls, L(`查看${what.join('、')}。`, `Checking ${what.join(', ')}.`))
    }
    let root: OncallOutput['rootCause']
    let actions: MockAct[]
    let story = this.plan.story
    if (!inv.complete) {
      root = this.plan.naive.root
      actions = this.plan.naive.actions
      story = L(
        { impact: '告警服务指标异常。', cause: `${root.service} 自身异常。`, evidence: '告警服务的错误率 / 延迟升高（没能查到更多证据）。' },
        { impact: 'The alerting service has abnormal metrics.', cause: `${root.service} itself is broken.`, evidence: "The alerting service's error rate / latency went up (couldn't find more evidence)." },
      )
    } else if (this.plan.diagRule && !this.plan.diagRule.re.test(this.sys)) {
      root = this.plan.diagRule.root
      actions = this.plan.diagRule.actions
      story = L(
        { impact: this.plan.story.impact, cause: `${root.service} 最近的发布引入了问题（它的指标最难看，也刚发过版）。`, evidence: `${root.service} 延迟和错误率最高，并且最近有发布。` },
        { impact: this.plan.story.impact, cause: `${root.service}'s latest deploy broke it (it has the worst metrics and just shipped).`, evidence: `${root.service} has the highest latency and error rate, and deployed recently.` },
      )
    } else {
      root = this.root
      actions = this.plan.remedy
      const rb = this.plan.runbook
      if (rb) {
        const h = this.box.runbook
        const read = this.usesOf('runbook').some((u) => u.result?.includes(rb.marker))
        if (!read && h && !this.usesOf('runbook').length) return callTool(this.ctx, h.tool.name, { [keyOf(h.tool, /topic|query|keyword|name|title/i) ?? 'topic']: rb.topic }, L(`查一下《${rb.topic}》的运维手册。`, `Looking up the "${rb.topic}" runbook.`))
        if (!read) actions = rb.without
      }
      if (this.plan.rule && !this.plan.rule.re.test(this.sys)) actions = this.plan.rule.otherwise
    }
    return this.remediate(root, actions, story)
  }

  // —— 处置 ——
  private sameTarget = (u: Use, a: MockAct) => u.inputText.includes(`"${a.target}"`) && (a.version === undefined || u.inputText.includes(a.version))
  private remediationUses = (a: MockAct) => this.usesOf(a.action).filter((u) => this.sameTarget(u, a))
  private approvalUses = (a: MockAct) => this.usesOf('approval').filter((u) => u.inputText.includes(`"${a.action}"`) && this.sameTarget(u, a))

  private reason(a: MockAct, root: OncallOutput['rootCause'], story: MockPlan['story']) {
    if (!RULES.evidence.test(this.sys)) return L('尽快恢复服务。', 'Restore service ASAP.')
    return L(
      `根因：${root.service}（${root.category}）。证据：${story.evidence} 因此执行 ${a.action} ${a.target}${a.version ? ` 到 ${a.version}` : ''}${a.replicas !== undefined ? ` 到 ${a.replicas} 个副本` : ''}${a.on !== undefined ? `（${a.on ? 'on' : 'off'}）` : ''}。`,
      `Root cause: ${root.service} (${root.category}). Evidence: ${story.evidence} So: ${a.action} ${a.target}${a.version ? ` to ${a.version}` : ''}${a.replicas !== undefined ? ` to ${a.replicas} replicas` : ''}${a.on !== undefined ? ` (${a.on ? 'on' : 'off'})` : ''}.`,
    )
  }

  private remediate(root: OncallOutput['rootCause'], actions: MockAct[], story: MockPlan['story']) {
    const done: string[] = []
    for (const a of actions) {
      const label = `${a.action} ${a.target}${a.version ? ` → ${a.version}` : ''}${a.replicas !== undefined ? ` → ${a.replicas}` : ''}${a.on !== undefined ? ` → ${a.on ? 'on' : 'off'}` : ''}`
      const runs = this.remediationUses(a)
      if (runs.some((u) => u.result !== undefined && !u.error)) {
        done.push(label)
        continue
      }
      const failed = runs.find((u) => u.result !== undefined)
      if (failed) return this.finish(root, story, done, L(`${label} 没有执行成功：${failed.result!.slice(0, 80)}`, `${label} failed: ${failed.result!.slice(0, 80)}`))
      const reason = this.reason(a, root, story)
      const ap = this.box.approval
      if (ap) {
        const asked = this.approvalUses(a).filter((u) => u.result !== undefined)
        const last = asked[asked.length - 1]
        if (last && REJECTED.test(last.result!)) return this.finish(root, story, done, L(`${label} 的审批被驳回：${last.result!.slice(0, 80)}`, `approval for ${label} was rejected: ${last.result!.slice(0, 80)}`))
        if (!last || !APPROVED.test(last.result!)) return callTool(this.ctx, ap.tool.name, approvalInput(ap, a, reason), L(`申请审批：${label}。`, `Requesting approval: ${label}.`))
      }
      const h = this.box[a.action]
      if (!h) return this.finish(root, story, done, L(`需要 ${label}，但没有对应的处置工具`, `${label} is needed, but there's no tool for it`))
      return callTool(this.ctx, h.tool.name, actInput(h, a, reason), L(`执行 ${label}。`, `Running ${label}.`))
    }
    return this.finish(root, story, done)
  }

  private finish(root: OncallOutput['rootCause'], story: MockPlan['story'], done: string[], problem?: string) {
    const action = done.length
      ? L(`已${this.box.approval ? '经审批' : ''}执行 ${done.join('；')}。`, `Ran ${done.join('; ')}${this.box.approval ? ' with approval' : ''}.`)
      : L('未做任何变更。', 'No changes made.')
    const handling = problem ? L(`${action}${problem}，需要人工跟进。`, `${action} ${problem}; needs human follow-up.`) : action
    const summary = RULES.postmortem.test(this.sys)
      ? L(
          `【影响】${story.impact}\n【根因】${story.cause}\n【证据】${story.evidence}\n【处置】${handling}`,
          `Impact: ${story.impact}\nRoot cause: ${story.cause}\nEvidence: ${story.evidence}\nRemediation: ${handling}`,
        )
      : L(`${story.cause}${handling}`, `${story.cause} ${handling}`)
    if (RULES.json.test(this.sys)) return say(L(`排查结束。\n\`\`\`json\n${JSON.stringify({ rootCause: root, summary })}\n\`\`\``, `Investigation done.\n\`\`\`json\n${JSON.stringify({ rootCause: root, summary })}\n\`\`\``))
    return say(L(`根因：${root.service}（${root.category}）。${summary}`, `Root cause: ${root.service} (${root.category}). ${summary}`))
  }
}

export const mock: MockModel = (req, ctx) => {
  const task = ONCALL_TASKS.find((t) => t.id === ctx.scenario.split('#')[0])
  if (!task?.mock) return say(L('（模拟模型只会做核心任务；完整任务集请用真实模型跑基准）', '(The mock model only handles core tasks; run the full task set as a benchmark with a real model.)'))
  const plan = task.mock
  const agent = new Oncall(req, plan, task.root, ctx)
  if (!Object.keys(agent.box).length) {
    // 没有任何工具（一次性 prompt）：只能根据告警猜
    const n = plan.naive.root
    const text = L(`${n.service} 的指标异常，可能是最近的变更引起的，建议排查 ${n.service}。`, `${n.service} metrics look abnormal, probably from a recent change; suggest investigating ${n.service}.`)
    if (RULES.json.test(`${req.system ?? ''}\n${JSON.stringify(req.messages)}`)) return say(`\`\`\`json\n${JSON.stringify({ rootCause: n, summary: text })}\n\`\`\``)
    return say(L(`根因：${n.service}（${n.category}）。${text}`, `Root cause: ${n.service} (${n.category}). ${text}`))
  }
  return agent.run()
}
