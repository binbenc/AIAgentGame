/**
 * P6 判定器（TravelPlanner 风格）：只看玩家返回的计划，用产品库独立核算，和模型 / 架构无关。
 * - 常识约束：天数和日期、每天的城市、id 存在且属于对应城市 / 日期、交通衔接、时间窗、营业时间、闭馆日、
 *   住宿连续、不重复、计划完整（整天要有景点和午晚餐）；
 * - 硬约束：预算（按数据库价格计算，不看计划里自报的金额）、不坐飞机、宠物、无障碍、房型、菜系、每天景点上限、最少入住晚数；
 * - 不可行的需求：必须返回 feasible: false 并说明原因。
 */
import { z } from 'zod'
import type { CheckResult } from '../types'
import { addDays, ATTRACTION_BY_ID, fmtMin, HOTEL_BY_ID, openFor, RESTAURANT_BY_ID, toMin, transportById, weekdayOf, type Transport } from './env/data'

// —————————— 返回值格式（和玩家的 types.ts 保持一致） ——————————

const Id = z.string().min(1)
export const DayPlanSchema = z.object({
  date: z.string(),
  city: z.string(),
  transport: z.array(Id).default([]),
  attractions: z.array(Id).default([]),
  meals: z
    .object({
      breakfast: Id.nullable().optional(),
      lunch: Id.nullable().optional(),
      dinner: Id.nullable().optional(),
    })
    .default({}),
  hotel: Id.nullable().optional(),
})
export const TravelPlanSchema = z.object({
  feasible: z.boolean(),
  reason: z.string().optional(),
  days: z.array(DayPlanSchema).default([]),
  estimatedCost: z.number().optional(),
})
export type TravelPlan = z.infer<typeof TravelPlanSchema>
export type DayPlan = z.infer<typeof DayPlanSchema>

// —————————— 任务的标准答案（玩家看不到） ——————————

export interface Prefs {
  cuisines?: string[]
  noFlight?: boolean
  pets?: boolean
  accessible?: boolean
  maxAttractionsPerDay?: number
  roomType?: string
}

export interface TripSpec {
  origin: string
  stops: { city: string; days: number }[]
  startDate: string
  people: number
  budget: number | null
  prefs: Prefs
  /** false：这个需求不可能满足 */
  feasible: boolean
  /** 不可行时，原因里至少要出现其中一个词 */
  infeasibleWords?: string[]
  /** 不可行时给玩家的提示 */
  infeasibleWhy?: string
}

export const SLOTS = { breakfast: toMin('08:00'), lunch: toMin('12:00'), dinner: toMin('18:30') } as const
export const MEAL_NAMES = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as const
export type Meal = keyof typeof SLOTS
const DAY_START = toMin('08:00')
const DAY_END = toMin('21:00')
/** 出发前要留出去车站 / 机场的时间 */
const DEPART_BUFFER = 60

export const totalDays = (s: TripSpec) => s.stops.reduce((n, x) => n + x.days, 0)
/** 每天所在的城市：按 stops 顺序展开 */
export const dayCities = (s: TripSpec) => s.stops.flatMap((x) => Array.from({ length: x.days }, () => x.city))
export const roomsFor = (people: number, maxOccupancy: number) => Math.ceil(people / maxOccupancy)

const short = (date: string) => `${date.slice(5)}（${weekdayOf(date)}）`

export interface Window {
  start: number
  end: number
}

/** 当天在 city 里可以活动的时间窗：到达之后、出发前 1 小时之前 */
export function windowOf(city: string, legs: Transport[]): Window {
  let start = DAY_START
  let end = DAY_END
  for (const t of legs) {
    if (t.to === city) start = Math.max(start, toMin(t.arrive))
    if (t.from === city) end = Math.min(end, toMin(t.depart) - DEPART_BUFFER)
  }
  return { start, end }
}

export const mealFits = (w: Window, meal: Meal) => SLOTS[meal] >= w.start && SLOTS[meal] + 60 <= w.end

export interface Cost {
  transport: number
  hotel: number
  meals: number
  tickets: number
  total: number
}

/** 按数据库价格核算（不存在的 id 不计） */
export function costOf(spec: TripSpec, plan: TravelPlan): Cost {
  const c = { transport: 0, hotel: 0, meals: 0, tickets: 0, total: 0 }
  for (const d of plan.days) {
    for (const id of d.transport) c.transport += (transportById(id)?.price ?? 0) * spec.people
    const h = d.hotel ? HOTEL_BY_ID.get(d.hotel) : undefined
    if (h) c.hotel += h.price * roomsFor(spec.people, h.maxOccupancy)
    for (const id of Object.values(d.meals)) if (id) c.meals += (RESTAURANT_BY_ID.get(id)?.avgCost ?? 0) * spec.people
    for (const id of d.attractions) c.tickets += (ATTRACTION_BY_ID.get(id)?.ticket ?? 0) * spec.people
  }
  c.total = c.transport + c.hotel + c.meals + c.tickets
  return c
}

/** 列出计划违反的每一条约束（中文，指明第几天、哪个 id、为什么） */
export function violations(spec: TripSpec, plan: TravelPlan): string[] {
  const out: string[] = []
  const n = totalDays(spec)
  const cities = dayCities(spec)
  const { prefs } = spec

  if (plan.days.length !== n) {
    out.push(`行程应为 ${n} 天（${spec.startDate} 出发），计划里有 ${plan.days.length} 天`)
    if (!plan.days.length) return out
  }
  const usedR = new Map<string, string>()
  const usedA = new Map<string, string>()
  const cuisinesHad = new Set<string>()

  plan.days.slice(0, n).forEach((d, i) => {
    const date = addDays(spec.startDate, i)
    const tag = `第 ${i + 1} 天（${short(date)}）`
    const city = cities[i]
    if (d.date !== date) out.push(`${tag}的日期应为 ${date}，计划里写的是 ${d.date}`)
    if (d.city !== city) out.push(`${tag}应该在${city}，计划里写的是“${d.city}”`)

    // —— 交通 ——
    const from = i === 0 ? spec.origin : cities[i - 1]
    const to = i === n - 1 ? spec.origin : city
    const legs: Transport[] = []
    for (const id of d.transport) {
      const t = transportById(id)
      if (!t) out.push(`${tag}：交通 ${id} 在产品库里不存在（只能使用 searchTransport 返回的 id）`)
      else if (t.date !== date) out.push(`${tag}：交通 ${id} 是 ${t.date} 的班次，不是当天的`)
      else legs.push(t)
    }
    legs.sort((a, b) => toMin(a.depart) - toMin(b.depart))
    if (from !== to) {
      if (!legs.length) out.push(`${tag}：需要从${from}前往${to}，但没有安排交通`)
      else {
        let at = from
        let ready = 0
        for (const t of legs) {
          if (t.from !== at) out.push(`${tag}：交通 ${t.id}（${t.from}→${t.to}）衔接不上，此时人在${at}`)
          if (toMin(t.depart) < ready) out.push(`${tag}：交通 ${t.id} ${t.depart} 出发，但上一程 ${fmtMin(ready)} 才到达`)
          at = t.to
          ready = toMin(t.arrive)
        }
        if (at !== to) out.push(`${tag}：当天的交通最后到达${at}，应该到达${to}`)
      }
    } else if (legs.length) out.push(`${tag}：当天不需要长途交通，却安排了 ${legs.map((t) => t.id).join('、')}`)
    if (prefs.noFlight) for (const t of legs) if (t.mode === '飞机') out.push(`${tag}：客户不坐飞机，但安排了航班 ${t.id}`)

    const w = windowOf(city, legs)
    const empty = w.end <= w.start
    const winText = empty ? `当天在${city}没有可活动时间` : `当天在${city}的可活动时间是 ${fmtMin(w.start)}~${fmtMin(w.end)}`
    const why = legs
      .flatMap((t) => [
        t.to === city ? `${t.id} ${t.arrive} 才到达${city}` : '',
        t.from === city ? `${t.id} ${t.depart} 从${city}出发（要提前 1 小时去车站 / 机场）` : '',
      ])
      .filter(Boolean)
      .join('，')
    const outside: string[] = []

    // —— 餐饮 ——
    let mealsCount = 0
    for (const meal of Object.keys(SLOTS) as Meal[]) {
      const id = d.meals[meal]
      const label = `${tag}${MEAL_NAMES[meal]}`
      if (!id) {
        if (meal !== 'breakfast' && mealFits(w, meal)) out.push(`${label}没有安排（${winText}，在这个时间段里的午餐和晚餐都要安排）`)
        continue
      }
      const r = RESTAURANT_BY_ID.get(id)
      if (!r) {
        out.push(`${label}：餐厅 ${id} 在产品库里不存在（只能使用 searchRestaurants 返回的 id）`)
        continue
      }
      if (mealFits(w, meal)) mealsCount++
      if (r.city !== city) out.push(`${label}：${r.name}（${id}）在${r.city}，当天人在${city}`)
      if (!mealFits(w, meal)) outside.push(`${MEAL_NAMES[meal]}（${fmtMin(SLOTS[meal])}）`)
      else if (!openFor(r.hours, SLOTS[meal])) out.push(`${label}：${r.name}（${id}）营业时间是 ${r.hours}，${fmtMin(SLOTS[meal])} 不营业`)
      if (usedR.has(id)) out.push(`${label}：餐厅 ${r.name}（${id}）和${usedR.get(id)}重复了`)
      else usedR.set(id, label)
      cuisinesHad.add(r.cuisine)
    }

    // —— 景点 ——
    let hours = 0
    for (const id of d.attractions) {
      const a = ATTRACTION_BY_ID.get(id)
      if (!a) {
        out.push(`${tag}：景点 ${id} 在产品库里不存在（只能使用 searchAttractions 返回的 id）`)
        continue
      }
      hours += a.duration
      if (a.city !== city) out.push(`${tag}：景点 ${a.name}（${id}）在${a.city}，当天人在${city}`)
      if (a.closedOn === weekdayOf(date)) out.push(`${tag}：${a.name}（${id}）${a.closedOn}闭馆`)
      if (prefs.accessible && !a.barrierFree) out.push(`${tag}：${a.name}（${id}）没有无障碍设施，客户需要无障碍`)
      if (usedA.has(id)) out.push(`${tag}：景点 ${a.name}（${id}）和${usedA.get(id)}重复了`)
      else usedA.set(id, tag)
    }
    if (d.attractions.length && empty) outside.push(`${d.attractions.length} 个景点`)
    else if (d.attractions.length && hours * 60 + mealsCount * 60 > w.end - w.start)
      out.push(`${tag}：景点共需约 ${hours} 小时，加上 ${mealsCount} 顿饭，${winText}，排不下`)
    if (outside.length) out.push(`${tag}：${why ? why + '，' : ''}${winText}，却安排了${outside.join('、')}`)
    if (prefs.maxAttractionsPerDay && d.attractions.length > prefs.maxAttractionsPerDay)
      out.push(`${tag}安排了 ${d.attractions.length} 个景点，客户要求每天最多 ${prefs.maxAttractionsPerDay} 个`)
    if (from === to && !d.attractions.length) out.push(`${tag}是完整的一天，至少要安排 1 个景点`)

    // —— 住宿 ——
    const last = i === n - 1
    if (last) {
      if (d.hotel) out.push(`${tag}是最后一天，当天返程，不需要住宿（计划里安排了 ${d.hotel}）`)
    } else if (!d.hotel) out.push(`${tag}晚上没有安排住宿`)
    else {
      const h = HOTEL_BY_ID.get(d.hotel)
      if (!h) out.push(`${tag}：酒店 ${d.hotel} 在产品库里不存在`)
      else {
        if (h.city !== city) out.push(`${tag}：酒店 ${h.name}（${h.id}）在${h.city}，当晚人在${city}`)
        if (prefs.pets && !h.petsAllowed) out.push(`${tag}：客户带宠物，但 ${h.name}（${h.id}）禁止携带宠物`)
        if (prefs.accessible && !h.barrierFree) out.push(`${tag}：客户需要无障碍客房，但 ${h.name}（${h.id}）没有`)
        if (prefs.roomType && h.roomType !== prefs.roomType) out.push(`${tag}：客户要求${prefs.roomType}，但 ${h.name}（${h.id}）是${h.roomType}`)
      }
    }
  })

  // 最少入住晚数：按连续入住同一家酒店计算
  const nights = plan.days.slice(0, n - 1)
  for (let i = 0; i < nights.length; ) {
    const id = nights[i].hotel
    let j = i
    while (j < nights.length && nights[j].hotel === id) j++
    const h = id ? HOTEL_BY_ID.get(id) : undefined
    if (h && j - i < h.minNights) out.push(`酒店 ${h.name}（${h.id}）要求最少连住 ${h.minNights} 晚，计划只住了 ${j - i} 晚（第 ${i + 1} 天起）`)
    i = j
  }

  for (const c of prefs.cuisines ?? []) if (!cuisinesHad.has(c)) out.push(`客户想吃${c}，但行程里没有一顿是${c}`)

  if (spec.budget !== null) {
    const c = costOf(spec, plan)
    if (c.total > spec.budget)
      out.unshift(`总花费 ${c.total} 元超出预算 ${spec.budget} 元（交通 ${c.transport}、住宿 ${c.hotel}、餐饮 ${c.meals}、门票 ${c.tickets}；按 ${spec.people} 人计算）`)
  }
  return out
}

function list(vs: string[], max = 6): string {
  const shown = vs.slice(0, max).map((v, i) => `${i + 1}) ${v}`)
  return shown.join('；') + (vs.length > max ? `；……共 ${vs.length} 条` : '')
}

export function checkTravel(spec: TripSpec, output: unknown): CheckResult {
  const parsed = TravelPlanSchema.safeParse(output)
  if (!parsed.success)
    return {
      pass: false,
      reason: `返回值格式不对：${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '（根）'} ${i.message}`)
        .join('；')}。应为 types.ts 里的 TravelPlan：{ feasible, reason?, days: [{ date, city, transport, attractions, meals, hotel }] }`,
    }
  const plan = parsed.data
  if (!spec.feasible) {
    if (plan.feasible) {
      const vs = violations(spec, plan)
      return {
        pass: false,
        reason: `这个需求无法满足（${spec.infeasibleWhy}），应该返回 feasible: false 并说明原因，而不是给出一份不合规的计划${vs.length ? `。这份计划的问题：${list(vs, 3)}` : ''}`,
      }
    }
    const reason = plan.reason ?? ''
    const words = spec.infeasibleWords ?? []
    if (!reason.trim() || (words.length && !words.some((w) => reason.includes(w))))
      return { pass: false, reason: `判断正确（不可行），但 reason 要向客户说明原因（${spec.infeasibleWhy}）。实际：“${reason.slice(0, 60)}”` }
    return { pass: true, reason: `正确判断为不可行：${reason.slice(0, 60)}` }
  }
  if (!plan.feasible)
    return { pass: false, reason: `这个需求是可以满足的（存在满足全部约束的方案），不应该返回 feasible: false。给出的原因：“${(plan.reason ?? '').slice(0, 60)}”` }
  const vs = violations(spec, plan)
  if (vs.length) return { pass: false, reason: `计划不满足 ${vs.length} 条约束：${list(vs)}` }
  const c = costOf(spec, plan)
  return { pass: true, reason: `计划满足全部约束，总花费 ${c.total} 元${spec.budget !== null ? ` / 预算 ${spec.budget} 元` : ''}` }
}
