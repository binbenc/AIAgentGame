/**
 * P6 的模拟模型：一个“有能力、但很死板”的行程规划模型（TravelPlanner 里最常见的失败方式它都会犯）。
 *
 * - 它只会用**上下文里出现过 id 的**交通 / 酒店 / 餐厅 / 景点；没见过数据就编一个 id（幻觉实体）。
 * - 它读得懂客户是谁、从哪出发、去哪、哪天、几个人（这是目标本身），但埋在原始需求里的**偏好**
 *   （不坐飞机、带宠物、无障碍、菜系、每天景点上限、房型）它会忽略——除非这些约束被**重新明确列出**：
 *   提示词里有结构化的约束清单（TripRequest JSON 的 preferences 等字段），或 system 里写明了对应规则。
 * - 需要**计算或交叉核对**的约束（预算、闭馆日、营业时间、到达 / 出发时间窗、最少入住晚数）它第一稿一定会错：
 *   它挑评分最高的酒店、最早的班次，每天塞满景点和两顿饭。只有当**校验结果**（检查工具的返回、或者代码发回来的
 *   违规清单）指出某一类问题后，它才会在下一稿里改正这一类问题。
 * - 预算问题被指出两次（已经按最省钱的方式改过还是超）时，它会如实回答 feasible: false。
 * - 被要求“提取 / 解析需求”时，它能输出准确的 TripRequest JSON；被要求当“评审”时，它算不清账，总说“看起来不错”。
 * - 有搜索工具时，它会先把需要的数据都查一遍（每条线路、每个城市），有检查工具时，交卷前会先调用检查工具。
 */
import { callTools, say } from '../../engine/llm/mock-kit'
import type { MockModel } from '../../engine/llm/providers/mock'
import { blocksOf, type ChatRequest, type ToolSpec, type ToolUseBlock } from '../../engine/llm/types'
import { L } from '../../engine/locale'
import {
  addDays,
  ATTRACTION_BY_ID,
  CITY_CODE,
  FLIGHT,
  HOTEL_BY_ID,
  openFor,
  RESTAURANT_BY_ID,
  toMin,
  transportById,
  transportsOn,
  weekdayOf,
  type Attraction,
  type Hotel,
  type Restaurant,
  type Transport,
} from './env/data'
import { costOf, dayCities, mealFits, roomsFor, SLOTS, totalDays, windowOf, type DayPlan, type Meal, type Prefs, type TravelPlan, type TripSpec } from './judge'
import { TRAVEL_TASKS } from './tasks'

// ———————————————— 规划器（模型“心里”的做法） ————————————————

export type PrefKey = keyof Prefs
/** 需要校验结果才会改正的问题类别 */
export type FixKey = 'budget' | 'timing' | 'hours' | 'closure' | 'minNights'

export interface DraftOptions {
  /** 模型能看到的实体 id */
  seen: (id: string) => boolean
  /** 模型注意到了哪些偏好 */
  aware: Set<PrefKey>
  /** 校验结果指出过的问题类别 */
  fixes: Set<FixKey>
  /** 指定每一程交通（用来穷举验证任务可行性） */
  forceLegs?: string[]
}

const DEFAULT_WINDOW = { start: toMin('08:00'), end: toMin('21:00') }
const CODE_OF = (city: string) => CITY_CODE[city] ?? 'XX'
const mmdd = (date: string) => date.slice(5).replace('-', '')

interface Leg {
  day: number
  from: string
  to: string
  date: string
}

export function legsOf(spec: TripSpec): Leg[] {
  const n = totalDays(spec)
  const cities = dayCities(spec)
  const legs: Leg[] = []
  for (let i = 0; i < n; i++) {
    const from = i === 0 ? spec.origin : cities[i - 1]
    const to = i === n - 1 ? spec.origin : cities[i]
    if (from !== to) legs.push({ day: i, from, to, date: addDays(spec.startDate, i) })
  }
  return legs
}

const byRating = <T extends { rating: number }>(xs: T[]) => [...xs].sort((a, b) => b.rating - a.rating)

export function draftPlan(spec: TripSpec, o: DraftOptions): TravelPlan {
  const n = totalDays(spec)
  const cities = dayCities(spec)
  const p: Prefs = Object.fromEntries(Object.entries(spec.prefs).filter(([k]) => o.aware.has(k as PrefKey)))
  const budget = o.fixes.has('budget')
  const timing = o.fixes.has('timing')
  const days: DayPlan[] = Array.from({ length: n }, (_, i) => ({ date: addDays(spec.startDate, i), city: cities[i], transport: [], attractions: [], meals: {}, hotel: null }))

  // 交通
  const legs = legsOf(spec)
  const chosen: Transport[][] = days.map(() => [])
  legs.forEach((leg, k) => {
    let t: Transport | undefined
    if (o.forceLegs) t = transportById(o.forceLegs[k])
    else {
      let cands = transportsSeen(leg, o.seen)
      if (p.noFlight) cands = cands.filter((x) => x.mode !== FLIGHT)
      // 从游玩城市出发的那一程：知道要留出游玩时间后，挑下午晚些的班次
      if (timing && leg.from !== spec.origin) {
        const late = cands.filter((x) => toMin(x.depart) >= toMin('16:00'))
        cands = late.length ? late : cands.slice(-1)
      }
      cands.sort((a, b) => (budget ? a.price - b.price : 0) || a.depart.localeCompare(b.depart))
      t = cands[0]
    }
    if (t) chosen[leg.day].push(t)
    days[leg.day].transport.push(t?.id ?? `K${1100 + k}-${mmdd(leg.date)}`)
  })

  // 住宿：每一站选一家，连住
  let dayIdx = 0
  for (const stop of spec.stops) {
    const idx = Array.from({ length: stop.days }, (_, j) => dayIdx + j).filter((i) => i < n - 1)
    dayIdx += stop.days
    if (!idx.length) continue
    let cands = HOTELS_IN(stop.city).filter((h) => o.seen(h.id))
    if (p.pets) cands = cands.filter((h) => h.petsAllowed)
    if (p.accessible) cands = cands.filter((h) => h.barrierFree)
    if (p.roomType) cands = cands.filter((h) => h.roomType === p.roomType)
    if (o.fixes.has('minNights')) cands = cands.filter((h) => h.minNights <= idx.length)
    if (budget) cands.sort((a, b) => a.price * roomsFor(spec.people, a.maxOccupancy) - b.price * roomsFor(spec.people, b.maxOccupancy))
    const h = cands[0]
    for (const i of idx) days[i].hotel = h?.id ?? `H-${CODE_OF(stop.city)}-99`
  }

  // 每天的活动
  const usedR = new Set<string>()
  const usedA = new Set<string>()
  const covered = new Set<string>()
  days.forEach((d, i) => {
    const city = d.city
    const full = !legs.some((l) => l.day === i)
    const w = timing ? windowOf(city, chosen[i]) : DEFAULT_WINDOW
    const meals: Meal[] = (['lunch', 'dinner'] as Meal[]).filter((m) => mealFits(w, m))
    for (const meal of meals) {
      let cands = RESTAURANTS_IN(city).filter((r) => o.seen(r.id) && !usedR.has(r.id))
      if (o.fixes.has('hours')) cands = cands.filter((r) => openFor(r.hours, SLOTS[meal]))
      if (budget) cands.sort((a, b) => a.avgCost - b.avgCost)
      const want = (p.cuisines ?? []).filter((c) => !covered.has(c))
      const r = cands.find((x) => want.includes(x.cuisine)) ?? cands[0]
      if (r) {
        usedR.add(r.id)
        covered.add(r.cuisine)
      }
      d.meals[meal] = r?.id ?? `R-${CODE_OF(city)}-9${i}`
    }
    let target = full ? (budget ? 1 : 3) : budget ? 0 : 1
    if (p.maxAttractionsPerDay) target = Math.min(target, p.maxAttractionsPerDay)
    let cands = ATTRACTIONS_IN(city).filter((a) => o.seen(a.id) && !usedA.has(a.id))
    if (p.accessible) cands = cands.filter((a) => a.barrierFree)
    if (o.fixes.has('closure')) cands = cands.filter((a) => a.closedOn !== weekdayOf(d.date))
    if (budget) cands.sort((a, b) => a.ticket - b.ticket)
    const avail = w.end - w.start - meals.length * 60
    let hours = 0
    for (const a of cands) {
      if (d.attractions.length >= target) break
      if (timing && (hours + a.duration) * 60 > avail) continue
      d.attractions.push(a.id)
      usedA.add(a.id)
      hours += a.duration
    }
    if (target > 0 && !d.attractions.length && !cands.length) d.attractions.push(`A-${CODE_OF(city)}-9${i}`)
  })

  // 模型自报的花费：只算了一部分（它不擅长算账），判定器不看这个数
  const claimed = costOf(spec, { feasible: true, days })
  return { feasible: true, days, estimatedCost: Math.round((claimed.transport + claimed.hotel) * 0.6) }
}

const HOTELS_IN = (city: string): Hotel[] => byRating([...HOTEL_BY_ID.values()].filter((h) => h.city === city))
const RESTAURANTS_IN = (city: string): Restaurant[] => byRating([...RESTAURANT_BY_ID.values()].filter((r) => r.city === city))
const ATTRACTIONS_IN = (city: string): Attraction[] => byRating([...ATTRACTION_BY_ID.values()].filter((a) => a.city === city))

function transportsSeen(leg: Leg, seen: (id: string) => boolean): Transport[] {
  const out: Transport[] = []
  for (const id of SEEN_TRANSPORT_IDS(leg)) if (seen(id)) out.push(transportById(id)!)
  return out
}
// 只需检查这条线路当天可能出现的 id
const SEEN_TRANSPORT_IDS = (leg: Leg) => transportsOn(leg.from, leg.to, leg.date).map((t) => t.id)

// ———————————————— 读请求 ————————————————

const ID_RE = /\b(?:[HRA]-[A-Z]{2}-\d{2}|[A-Z0-9]{1,3}\d{1,4}-\d{4})\b/g

function leaves(v: unknown, out: string[]) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => leaves(x, out))
}

interface View {
  system: string
  /** 模型能看到的全部文本 */
  all: string
  /** 去掉原始需求之后的文本（用来判断约束是否被重新列出） */
  restated: string
  /** 校验反馈：检查工具的返回 + 第一条之后的用户文本消息 */
  feedback: string[]
  /** 最后一次检查工具的返回 */
  lastCheck?: string
  checkCalls: number
  seenIds: Set<string>
  uses: ToolUseBlock[]
}

function view(req: ChatRequest, spec: TravelTaskLike, check?: ToolSpec): View {
  const parts = [req.system ?? '']
  const feedback: string[] = []
  const uses: ToolUseBlock[] = []
  const checkIds = new Set<string>()
  let lastCheck: string | undefined
  req.messages.forEach((m, mi) => {
    for (const b of blocksOf(m.content)) {
      if (b.type === 'text') {
        parts.push(b.text)
        if (m.role === 'user' && mi > 0) feedback.push(b.text)
      } else if (b.type === 'tool_use') {
        uses.push(b)
        if (check && b.name === check.name) checkIds.add(b.id)
        leaves(b.input, parts)
      } else if (b.type === 'tool_result') {
        parts.push(b.content)
        if (checkIds.has(b.tool_use_id)) {
          feedback.push(b.content)
          lastCheck = b.content
        }
      }
    }
  })
  const all = parts.join('\n')
  const restated = all.split(spec.request).join('')
  return { system: req.system ?? '', all, restated, feedback, lastCheck, checkCalls: checkIds.size, seenIds: new Set(all.match(ID_RE) ?? []), uses }
}

type TravelTaskLike = TripSpec & { id: string; request: string }

const STRUCTURED = /"(preferences|noFlight|cuisines|maxAttractionsPerDay)"\s*:/
// 中英文的说法都认，不随界面语言变化
const PREF_IN_SYSTEM: [PrefKey, RegExp][] = [
  ['noFlight', /不坐飞机|不乘坐?飞机|不能坐飞机|只坐高铁|不要(安排|选)?(航班|飞机)|no flights?|not fly|n't fly|never fly|trains? only|only (take )?(the )?trains?|avoid (flights|flying)/i],
  ['pets', /宠物|\bpets?\b/i],
  ['accessible', /无障碍|轮椅|accessib|wheelchair|barrier-free/i],
  ['cuisines', /菜系|想吃|cuisine/i],
  ['maxAttractionsPerDay', /每天最多|景点.{0,10}(上限|不超过|最多)|(at most|max(imum)?|no more than|limit).{0,30}(per|a|each) day|attractions?.{0,15}(limit|cap|at most|max)/i],
  ['roomType', /房型|room type/i],
]
const PREF_IN_FEEDBACK: [PrefKey, RegExp][] = [
  ['noFlight', /飞机|航班|\bflights?\b|\bfly\b|\bplanes?\b/i],
  ['pets', /宠物|\bpets?\b|\bdogs?\b|\bcats?\b/i],
  ['accessible', /无障碍|轮椅|accessib|wheelchair|barrier-free/i],
  ['cuisines', /菜系|想吃|口味|cuisine|wants? to eat|wants? .{0,30}(food|restaurant|meal)|no (meal|restaurant).{0,30}(is|serves)|no \w+ (restaurant|meal)/i],
  ['maxAttractionsPerDay', /景点.{0,12}(超过|最多|上限)|(超过|最多|上限).{0,8}个?景点|attractions?.{0,20}(more than|at most|max|limit)|(more than|at most|max|limit).{0,20}attractions?/i],
  ['roomType', /房型|要求.{0,4}(家庭房|大床房|双床房)|room type|wants? an? (king|twin|family) room/i],
]
const FIX_IN_FEEDBACK: [FixKey, RegExp][] = [
  ['budget', /超.{0,6}预算|预算.{0,12}(超|不够|不足)|over (the )?(¥\d+ )?budget|exceeds? (the )?(¥\d+ )?budget|budget.{0,20}(exceeded|not enough|too (low|small)|short)/i],
  ['timing', /到达|出发|发车|起飞|来不及|可活动时间|时间窗|\barriv|\bdepart|free time|time window/i],
  ['hours', /营业|opening hours|\bnot open (at|for)\b/i],
  ['closure', /闭馆|休息日|不开放|closed on/i],
  ['minNights', /最少.{0,4}(连住|入住)|至少.{0,4}(连住|入住)|最短入住|起住|minimum (stay|of \d+ nights?)|at least \d+ nights?/i],
]
const PROBLEM = /不存在|违反|问题|错误|不满足|不符合|超出|没有安排|✗|invalid|violation|problem|issue|missing|not (in|among) the options|doesn't exist|exceed|over (the )?budget/i

function awareness(v: View, spec: TripSpec): { aware: Set<PrefKey>; fixes: Set<FixKey>; budgetHits: number } {
  const aware = new Set<PrefKey>()
  if (STRUCTURED.test(v.restated)) (Object.keys(spec.prefs) as PrefKey[]).forEach((k) => aware.add(k))
  for (const [k, re] of PREF_IN_SYSTEM) if (re.test(v.system)) aware.add(k)
  const fixes = new Set<FixKey>()
  let budgetHits = 0
  for (const f of v.feedback) {
    for (const [k, re] of PREF_IN_FEEDBACK) if (re.test(f)) aware.add(k)
    for (const [k, re] of FIX_IN_FEEDBACK) if (re.test(f)) fixes.add(k)
    if (FIX_IN_FEEDBACK[0][1].test(f)) budgetHits++
  }
  return { aware, fixes, budgetHits }
}

// ———————————————— 工具识别 ————————————————

type Kind = 'check' | 'transport' | 'hotel' | 'restaurant' | 'attraction'
const KINDS: [Kind, RegExp][] = [
  ['check', /check|verif|validat|校验|检查|验证/i],
  ['transport', /transport|train|flight|交通|车次|航班|高铁/i],
  ['hotel', /hotel|lodging|accommodation|住宿|酒店/i],
  ['restaurant', /restaurant|food|dining|meal|餐厅|美食|餐饮/i],
  ['attraction', /attraction|sight|poi|景点/i],
]
function classify(t: ToolSpec): Kind | undefined {
  for (const [k, re] of KINDS) if (re.test(t.name)) return k
  for (const [k, re] of KINDS) if (re.test(t.description)) return k
  return undefined
}
const keysOf = (t: ToolSpec) => Object.keys(t.input_schema.properties ?? {})
const keyLike = (t: ToolSpec, re: RegExp, fallback: number) => keysOf(t).find((k) => re.test(k)) ?? (t.input_schema.required ?? keysOf(t))[fallback] ?? keysOf(t)[fallback]

function toolbox(req: ChatRequest): Partial<Record<Kind, ToolSpec>> {
  const box: Partial<Record<Kind, ToolSpec>> = {}
  for (const t of req.tools ?? []) {
    const k = classify(t)
    if (k) box[k] ??= t
  }
  return box
}

// ———————————————— 回复 ————————————————

function planText(plan: TravelPlan, preamble: string): string {
  return `${preamble}\n\n\`\`\`json\n${JSON.stringify(plan, null, 1)}\n\`\`\``
}

function tripRequestOf(spec: TripSpec) {
  const p = spec.prefs
  return {
    origin: spec.origin,
    stops: spec.stops,
    startDate: spec.startDate,
    people: spec.people,
    budget: spec.budget,
    preferences: {
      cuisines: p.cuisines ?? [],
      noFlight: !!p.noFlight,
      pets: !!p.pets,
      accessible: !!p.accessible,
      maxAttractionsPerDay: p.maxAttractionsPerDay ?? null,
      roomType: p.roomType ?? null,
    },
  }
}

export const mock: MockModel = (req, ctx) => {
  const spec = TRAVEL_TASKS.find((x) => x.id === ctx.scenario.split('#')[0])
  if (!spec) return say(L('（模拟模型不认识这个任务）', '(the mock model does not know this task)'))
  const box = toolbox(req)
  const v = view(req, spec, box.check)
  const hasTools = Object.keys(box).length > 0

  // 当评审：算不清账、也不会去查日历和营业时间，总说“看起来不错”
  if (!hasTools && /评审|审核|审查|评估|reviewer|evaluat|critic|review/i.test(v.system) && !/规划|planner|plan the trip/i.test(v.system))
    return say('{"pass": true, "score": 8, "feedback": []}')

  const knowsRequest = v.all.includes(spec.request) || STRUCTURED.test(v.restated)
  if (!knowsRequest)
    return say(L('请告诉我客户的出行需求（出发地、目的地、日期、人数、预算和偏好）。', "Please tell me the customer's travel request (origin, destinations, dates, number of people, budget and preferences)."))

  // 解析需求：输出结构化的 TripRequest
  if (!hasTools && !v.seenIds.size && /TripRequest|提取|解析|抽取|结构化|extract|parse|structured/i.test(v.all))
    return say(JSON.stringify(tripRequestOf(spec), null, 1))

  // 有搜索工具：先把缺的数据查齐
  if (hasTools) {
    const calls = missingSearches(spec, box, v)
    if (calls.length) return callTools(ctx, calls, L('先查一下交通、酒店、餐厅和景点。', "Let me look up transport, hotels, restaurants and attractions first."))
  }

  const { aware, fixes, budgetHits } = awareness(v, spec)
  const seen = (id: string) => v.seenIds.has(id)

  // 已经按最省钱的方式改过，预算还是不够：如实说不可行
  if (budgetHits >= 2 && spec.budget !== null) {
    const cheapest = draftPlan(spec, { seen, aware, fixes })
    const c = costOf(spec, cheapest)
    if (c.total > spec.budget) {
      const out: TravelPlan = {
        feasible: false,
        reason: L(`预算不足：按最省钱的方案也需要约 ${c.total} 元，超出预算 ${spec.budget} 元。`, `Over budget: even the cheapest plan costs about ¥${c.total}, more than the ¥${spec.budget} budget.`),
        days: [],
      }
      return say(planText(out, L('这个需求在预算内无法实现。', "This request can't be done within the budget.")))
    }
  }

  const plan = draftPlan(spec, { seen, aware, fixes })
  if (box.check) {
    const lastOk = v.lastCheck !== undefined && !PROBLEM.test(v.lastCheck) && ![...FIX_IN_FEEDBACK, ...PREF_IN_FEEDBACK].some(([, re]) => re.test(v.lastCheck!))
    const lastWasCheck = lastToolName(req) === box.check.name
    if (!(lastWasCheck && lastOk) && v.checkCalls < 5)
      return callTools(
        ctx,
        [checkCall(box.check, plan)],
        v.checkCalls ? L('根据检查结果修改了计划，再检查一遍。', "I revised the plan based on the check; let me check it again.") : L('先用检查工具核对一下这份计划。', 'Let me run the checker on this plan first.'),
      )
  }
  return say(planText(plan, fixes.size ? L('根据校验结果修改后的行程计划：', 'Here is the itinerary, revised based on the validation results:') : L('以下是为客户规划的行程：', "Here is the customer's itinerary:")))
}

function lastToolName(req: ChatRequest): string | undefined {
  const m = req.messages[req.messages.length - 1]
  const r = blocksOf(m.content).find((b) => b.type === 'tool_result')
  if (!r || r.type !== 'tool_result') return undefined
  for (const mm of req.messages) for (const b of blocksOf(mm.content)) if (b.type === 'tool_use' && b.id === r.tool_use_id) return b.name
  return undefined
}

function checkCall(t: ToolSpec, plan: TravelPlan) {
  const key = (t.input_schema.required ?? keysOf(t))[0] ?? 'plan'
  const type = (t.input_schema.properties?.[key] as { type?: string } | undefined)?.type
  return { name: t.name, input: { [key]: type === 'string' ? JSON.stringify(plan) : plan } }
}

function missingSearches(spec: TripSpec, box: Partial<Record<Kind, ToolSpec>>, v: View) {
  const calls: { name: string; input: Record<string, unknown> }[] = []
  const called = (t: ToolSpec, pred: (input: Record<string, unknown>) => boolean) => v.uses.some((u) => u.name === t.name && pred((u.input ?? {}) as Record<string, unknown>))
  const has = (input: Record<string, unknown>, value: string) => Object.values(input).some((x) => String(x).includes(value))
  if (box.transport) {
    const t = box.transport
    for (const leg of legsOf(spec)) {
      if (called(t, (i) => has(i, leg.from) && has(i, leg.to) && has(i, leg.date))) continue
      calls.push({ name: t.name, input: { [keyLike(t, /from|origin|出发|start/i, 0)]: leg.from, [keyLike(t, /^to$|dest|到达|target|end/i, 1)]: leg.to, [keyLike(t, /date|day|日期/i, 2)]: leg.date } })
    }
  }
  for (const k of ['hotel', 'restaurant', 'attraction'] as const) {
    const t = box[k]
    if (!t) continue
    for (const city of new Set(spec.stops.map((s) => s.city))) {
      if (called(t, (i) => has(i, city))) continue
      calls.push({ name: t.name, input: { [keyLike(t, /city|城市|location|place/i, 0)]: city } })
    }
  }
  return calls
}

