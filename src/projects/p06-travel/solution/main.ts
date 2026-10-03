import { chat, log, type Message } from 'agent-quest'
import { parseJsonLoose } from '../../structured'
import { textOf } from '../../tools'
import { TravelPlanSchema, TripRequestSchema, type TravelEnv, type TravelPlan, type TripRequest } from './types'
import { gather, infeasibility, prefilter, render, verify } from './verify'

const PARSE_SYSTEM = `你是远方旅行社的需求分析员。把客户的出行需求提取成 TripRequest JSON，只输出 JSON，不要输出其它文字。
今年是 2026 年。字段：
- origin：出发城市（返程也回到这里）
- stops：按游玩顺序的目的地 [{"city": "成都", "days": 3}]，days 之和 = 行程总天数（出发当天和返程当天都算）
- startDate：出发日期 YYYY-MM-DD
- people：总人数
- budget：总预算（元），没说就填 null
- preferences：{"cuisines": 想吃的菜系[], "noFlight": 是否不坐飞机, "pets": 是否带宠物, "accessible": 是否需要无障碍, "maxAttractionsPerDay": 每天最多几个景点或 null, "roomType": 指定房型或 null}`

const PLAN_SYSTEM = `你是远方旅行社的行程规划师。根据 <约束> 和 <可选项> 拼出一份行程，只输出一个 JSON 对象（TravelPlan），不要输出其它文字。
规则：
1. 只能使用 <可选项> 里出现的 id，不要编造。
2. days 按 <日程> 逐天输出：date、city（当天活动所在城市，最后一天写最后一个目的地）、transport（当天乘坐的交通 id）、attractions、meals（lunch 12:00、dinner 18:30，breakfast 可选）、hotel（最后一天为 null）。
3. <约束> 里的每一条都是硬性要求。
4. 收到校验意见时，逐条修改，输出修改后的完整 JSON。
格式：{"feasible": true, "days": [{"date": "YYYY-MM-DD", "city": "...", "transport": [], "attractions": [], "meals": {"lunch": "...", "dinner": "..."}, "hotel": "..."}]}`

const MAX_REPAIRS = 3

async function ask(system: string, messages: Message[], maxTokens: number): Promise<string> {
  const res = await chat({ system, messages, max_tokens: maxTokens })
  return textOf(res.content)
}

/** 第一步：自然语言 → 结构化约束（校验 + 带错误重试） */
async function parseRequest(request: string): Promise<TripRequest> {
  const messages: Message[] = [{ role: 'user', content: request }]
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await ask(PARSE_SYSTEM, messages, 600)
    try {
      const r = TripRequestSchema.safeParse(parseJsonLoose(text))
      if (r.success) return r.data
      lastError = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    } catch (e) {
      lastError = (e as Error).message
    }
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: `格式不对：${lastError}。请只输出 TripRequest JSON。` })
  }
  throw new Error(`需求解析失败：${lastError}`)
}

export async function plan(request: string, env: TravelEnv): Promise<TravelPlan> {
  // 1. 解析需求：后面的检索、过滤、校验都基于这份结构化约束
  const req = await parseRequest(request)
  log(`需求：${JSON.stringify(req)}`)

  // 2. 查数据（代码完成，不需要模型）+ 按硬性偏好过滤
  const catalog = prefilter(await gather(req, env), req)

  // 3. 可行性下界：明显做不到的需求直接说明原因，不浪费模型调用
  const why = infeasibility(catalog, req)
  if (why) {
    log(`不可行：${why}`)
    return { feasible: false, reason: why, days: [] }
  }

  // 4. 规划 → 校验 → 修改（evaluator-optimizer，评审由确定性代码担任）
  const messages: Message[] = [
    {
      role: 'user',
      content: `<需求>${request}</需求>\n\n<约束>\n${JSON.stringify(req)}\n</约束>\n\n<可选项>\n${render(catalog, req)}\n</可选项>`,
    },
  ]
  let best: { plan: TravelPlan; problems: string[] } | undefined
  for (let round = 0; round <= MAX_REPAIRS; round++) {
    const text = await ask(PLAN_SYSTEM, messages, 2500)
    let problems: string[]
    let draft: TravelPlan | undefined
    try {
      draft = TravelPlanSchema.parse(parseJsonLoose(text))
      if (!draft.feasible) return draft
      problems = verify(draft, req, catalog)
    } catch (e) {
      problems = [`输出不是合法的 TravelPlan JSON：${(e as Error).message}`]
    }
    log(`第 ${round + 1} 稿：${problems.length ? problems.length + ' 个问题' : '通过'}`)
    if (draft && (!best || problems.length < best.problems.length)) best = { plan: draft, problems }
    if (!problems.length) return draft!
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: `校验发现以下问题，请逐条修改后输出完整的 JSON：\n${problems.map((p) => `- ${p}`).join('\n')}` })
  }
  // 修改次数用完仍有问题：返回问题最少的一稿（并记录下来，方便排查）
  log(`仍有问题：${best?.problems.join('；')}`)
  return best?.plan ?? { feasible: false, reason: '规划失败：模型没有给出合法的计划', days: [] }
}
