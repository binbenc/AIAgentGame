/**
 * P6 判定器（TravelPlanner 风格）：只看玩家返回的计划，用产品库独立核算，和模型 / 架构无关。
 * - 常识约束：天数和日期、每天的城市、id 存在且属于对应城市 / 日期、交通衔接、时间窗、营业时间、闭馆日、
 *   住宿连续、不重复、计划完整（整天要有景点和午晚餐）；
 * - 硬约束：预算（按数据库价格计算，不看计划里自报的金额）、不坐飞机、宠物、无障碍、房型、菜系、每天景点上限、最少入住晚数；
 * - 不可行的需求：必须返回 feasible: false 并说明原因。
 */
import { z } from 'zod'
import { L } from '../../engine/locale'
import type { CheckResult } from '../types'
import { addDays, ATTRACTION_BY_ID, cityKey, FLIGHT, fmtMin, HOTEL_BY_ID, openFor, RESTAURANT_BY_ID, toMin, transportById, weekdayOf, type Transport } from './env/data'

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
export const MEAL_NAMES: Record<'breakfast' | 'lunch' | 'dinner', string> = L({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }, { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner' })
export type Meal = keyof typeof SLOTS
const DAY_START = toMin('08:00')
const DAY_END = toMin('21:00')
/** 出发前要留出去车站 / 机场的时间 */
const DEPART_BUFFER = 60

export const totalDays = (s: TripSpec) => s.stops.reduce((n, x) => n + x.days, 0)
/** 每天所在的城市：按 stops 顺序展开 */
export const dayCities = (s: TripSpec) => s.stops.flatMap((x) => Array.from({ length: x.days }, () => x.city))
export const roomsFor = (people: number, maxOccupancy: number) => Math.ceil(people / maxOccupancy)

const short = (date: string) => L(`${date.slice(5)}（${weekdayOf(date)}）`, `${date.slice(5)}, ${weekdayOf(date)}`)
/** 英文版比较城市时忽略大小写和撇号（Xi'an / Xian） */
const sameCity = L((a: string, b: string) => a === b, (a: string, b: string) => cityKey(a) === cityKey(b))

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
    out.push(L(`行程应为 ${n} 天（${spec.startDate} 出发），计划里有 ${plan.days.length} 天`, `the trip should be ${n} days (starting ${spec.startDate}), but the plan has ${plan.days.length}`))
    if (!plan.days.length) return out
  }
  const usedR = new Map<string, string>()
  const usedA = new Map<string, string>()
  const cuisinesHad = new Set<string>()

  plan.days.slice(0, n).forEach((d, i) => {
    const date = addDays(spec.startDate, i)
    const tag = L(`第 ${i + 1} 天（${short(date)}）`, `Day ${i + 1} (${short(date)})`)
    const city = cities[i]
    if (d.date !== date) out.push(L(`${tag}的日期应为 ${date}，计划里写的是 ${d.date}`, `${tag}: date should be ${date}, the plan says ${d.date}`))
    if (!sameCity(d.city, city)) out.push(L(`${tag}应该在${city}，计划里写的是“${d.city}”`, `${tag}: should be in ${city}, the plan says "${d.city}"`))

    // —— 交通 ——
    const from = i === 0 ? spec.origin : cities[i - 1]
    const to = i === n - 1 ? spec.origin : city
    const legs: Transport[] = []
    for (const id of d.transport) {
      const t = transportById(id)
      if (!t) out.push(L(`${tag}：交通 ${id} 在产品库里不存在（只能使用 searchTransport 返回的 id）`, `${tag}: transport ${id} doesn't exist in the catalog (only use ids returned by searchTransport)`))
      else if (t.date !== date) out.push(L(`${tag}：交通 ${id} 是 ${t.date} 的班次，不是当天的`, `${tag}: transport ${id} runs on ${t.date}, not that day`))
      else legs.push(t)
    }
    legs.sort((a, b) => toMin(a.depart) - toMin(b.depart))
    if (from !== to) {
      if (!legs.length) out.push(L(`${tag}：需要从${from}前往${to}，但没有安排交通`, `${tag}: needs to travel from ${from} to ${to}, but no transport is planned`))
      else {
        let at = from
        let ready = 0
        for (const t of legs) {
          if (t.from !== at) out.push(L(`${tag}：交通 ${t.id}（${t.from}→${t.to}）衔接不上，此时人在${at}`, `${tag}: transport ${t.id} (${t.from}→${t.to}) doesn't connect; the traveler is in ${at} at that point`))
          if (toMin(t.depart) < ready) out.push(L(`${tag}：交通 ${t.id} ${t.depart} 出发，但上一程 ${fmtMin(ready)} 才到达`, `${tag}: transport ${t.id} departs at ${t.depart}, but the previous leg only arrives at ${fmtMin(ready)}`))
          at = t.to
          ready = toMin(t.arrive)
        }
        if (at !== to) out.push(L(`${tag}：当天的交通最后到达${at}，应该到达${to}`, `${tag}: the day's transport ends in ${at}, but should end in ${to}`))
      }
    } else if (legs.length)
      out.push(L(`${tag}：当天不需要长途交通，却安排了 ${legs.map((t) => t.id).join('、')}`, `${tag}: no long-distance travel is needed that day, but ${legs.map((t) => t.id).join(', ')} is planned`))
    if (prefs.noFlight) for (const t of legs) if (t.mode === FLIGHT) out.push(L(`${tag}：客户不坐飞机，但安排了航班 ${t.id}`, `${tag}: the customer won't fly, but flight ${t.id} is planned`))

    const w = windowOf(city, legs)
    const empty = w.end <= w.start
    const winText = empty
      ? L(`当天在${city}没有可活动时间`, `there is no free time in ${city} that day`)
      : L(`当天在${city}的可活动时间是 ${fmtMin(w.start)}~${fmtMin(w.end)}`, `free time in ${city} that day is ${fmtMin(w.start)}-${fmtMin(w.end)}`)
    const why = legs
      .flatMap((t) => [
        t.to === city ? L(`${t.id} ${t.arrive} 才到达${city}`, `${t.id} only arrives in ${city} at ${t.arrive}`) : '',
        t.from === city ? L(`${t.id} ${t.depart} 从${city}出发（要提前 1 小时去车站 / 机场）`, `${t.id} leaves ${city} at ${t.depart} (allow 1 hour to get to the station / airport)`) : '',
      ])
      .filter(Boolean)
      .join(L('，', '; '))
    const outside: string[] = []

    // —— 餐饮 ——
    let mealsCount = 0
    for (const meal of Object.keys(SLOTS) as Meal[]) {
      const id = d.meals[meal]
      const label = L(`${tag}${MEAL_NAMES[meal]}`, `${tag} ${MEAL_NAMES[meal]}`)
      if (!id) {
        if (meal !== 'breakfast' && mealFits(w, meal))
          out.push(L(`${label}没有安排（${winText}，在这个时间段里的午餐和晚餐都要安排）`, `${label} is missing (${winText}; every lunch and dinner within that window must be planned)`))
        continue
      }
      const r = RESTAURANT_BY_ID.get(id)
      if (!r) {
        out.push(L(`${label}：餐厅 ${id} 在产品库里不存在（只能使用 searchRestaurants 返回的 id）`, `${label}: restaurant ${id} doesn't exist in the catalog (only use ids returned by searchRestaurants)`))
        continue
      }
      if (mealFits(w, meal)) mealsCount++
      if (r.city !== city) out.push(L(`${label}：${r.name}（${id}）在${r.city}，当天人在${city}`, `${label}: ${r.name} (${id}) is in ${r.city}, but the traveler is in ${city} that day`))
      if (!mealFits(w, meal)) outside.push(L(`${MEAL_NAMES[meal]}（${fmtMin(SLOTS[meal])}）`, `${MEAL_NAMES[meal]} (${fmtMin(SLOTS[meal])})`))
      else if (!openFor(r.hours, SLOTS[meal]))
        out.push(L(`${label}：${r.name}（${id}）营业时间是 ${r.hours}，${fmtMin(SLOTS[meal])} 不营业`, `${label}: ${r.name} (${id}) is open ${r.hours}, not at ${fmtMin(SLOTS[meal])}`))
      if (usedR.has(id)) out.push(L(`${label}：餐厅 ${r.name}（${id}）和${usedR.get(id)}重复了`, `${label}: restaurant ${r.name} (${id}) repeats ${usedR.get(id)}`))
      else usedR.set(id, label)
      cuisinesHad.add(r.cuisine)
    }

    // —— 景点 ——
    let hours = 0
    for (const id of d.attractions) {
      const a = ATTRACTION_BY_ID.get(id)
      if (!a) {
        out.push(L(`${tag}：景点 ${id} 在产品库里不存在（只能使用 searchAttractions 返回的 id）`, `${tag}: attraction ${id} doesn't exist in the catalog (only use ids returned by searchAttractions)`))
        continue
      }
      hours += a.duration
      if (a.city !== city) out.push(L(`${tag}：景点 ${a.name}（${id}）在${a.city}，当天人在${city}`, `${tag}: attraction ${a.name} (${id}) is in ${a.city}, but the traveler is in ${city} that day`))
      if (a.closedOn === weekdayOf(date)) out.push(L(`${tag}：${a.name}（${id}）${a.closedOn}闭馆`, `${tag}: ${a.name} (${id}) is closed on ${a.closedOn}s`))
      if (prefs.accessible && !a.barrierFree) out.push(L(`${tag}：${a.name}（${id}）没有无障碍设施，客户需要无障碍`, `${tag}: ${a.name} (${id}) isn't wheelchair accessible, and the customer needs accessibility`))
      if (usedA.has(id)) out.push(L(`${tag}：景点 ${a.name}（${id}）和${usedA.get(id)}重复了`, `${tag}: attraction ${a.name} (${id}) repeats ${usedA.get(id)}`))
      else usedA.set(id, tag)
    }
    if (d.attractions.length && empty) outside.push(L(`${d.attractions.length} 个景点`, `${d.attractions.length} attraction(s)`))
    else if (d.attractions.length && hours * 60 + mealsCount * 60 > w.end - w.start)
      out.push(L(`${tag}：景点共需约 ${hours} 小时，加上 ${mealsCount} 顿饭，${winText}，排不下`, `${tag}: the attractions take about ${hours} hours plus ${mealsCount} meal(s), but ${winText}; it doesn't fit`))
    if (outside.length)
      out.push(L(`${tag}：${why ? why + '，' : ''}${winText}，却安排了${outside.join('、')}`, `${tag}: ${why ? why + '; ' : ''}${winText}, yet the plan has ${outside.join(', ')}`))
    if (prefs.maxAttractionsPerDay && d.attractions.length > prefs.maxAttractionsPerDay)
      out.push(L(`${tag}安排了 ${d.attractions.length} 个景点，客户要求每天最多 ${prefs.maxAttractionsPerDay} 个`, `${tag} has ${d.attractions.length} attractions; the customer wants at most ${prefs.maxAttractionsPerDay} per day`))
    if (from === to && !d.attractions.length) out.push(L(`${tag}是完整的一天，至少要安排 1 个景点`, `${tag} is a full day; plan at least 1 attraction`))

    // —— 住宿 ——
    const last = i === n - 1
    if (last) {
      if (d.hotel) out.push(L(`${tag}是最后一天，当天返程，不需要住宿（计划里安排了 ${d.hotel}）`, `${tag} is the last day (heading home), so no hotel is needed (the plan has ${d.hotel})`))
    } else if (!d.hotel) out.push(L(`${tag}晚上没有安排住宿`, `${tag}: no hotel for the night`))
    else {
      const h = HOTEL_BY_ID.get(d.hotel)
      if (!h) out.push(L(`${tag}：酒店 ${d.hotel} 在产品库里不存在`, `${tag}: hotel ${d.hotel} doesn't exist in the catalog`))
      else {
        if (h.city !== city) out.push(L(`${tag}：酒店 ${h.name}（${h.id}）在${h.city}，当晚人在${city}`, `${tag}: hotel ${h.name} (${h.id}) is in ${h.city}, but the traveler is in ${city} that night`))
        if (prefs.pets && !h.petsAllowed) out.push(L(`${tag}：客户带宠物，但 ${h.name}（${h.id}）禁止携带宠物`, `${tag}: the customer is bringing a pet, but ${h.name} (${h.id}) doesn't allow pets`))
        if (prefs.accessible && !h.barrierFree) out.push(L(`${tag}：客户需要无障碍客房，但 ${h.name}（${h.id}）没有`, `${tag}: the customer needs an accessible room, but ${h.name} (${h.id}) has none`))
        if (prefs.roomType && h.roomType !== prefs.roomType)
          out.push(L(`${tag}：客户要求${prefs.roomType}，但 ${h.name}（${h.id}）是${h.roomType}`, `${tag}: the customer wants a ${prefs.roomType}, but ${h.name} (${h.id}) offers a ${h.roomType}`))
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
    if (h && j - i < h.minNights)
      out.push(L(`酒店 ${h.name}（${h.id}）要求最少连住 ${h.minNights} 晚，计划只住了 ${j - i} 晚（第 ${i + 1} 天起）`, `hotel ${h.name} (${h.id}) has a minimum stay of ${h.minNights} nights, but the plan stays ${j - i} (from day ${i + 1})`))
    i = j
  }

  for (const c of prefs.cuisines ?? []) if (!cuisinesHad.has(c)) out.push(L(`客户想吃${c}，但行程里没有一顿是${c}`, `the customer wants ${c}, but no meal in the plan is ${c}`))

  if (spec.budget !== null) {
    const c = costOf(spec, plan)
    if (c.total > spec.budget)
      out.unshift(
        L(
          `总花费 ${c.total} 元超出预算 ${spec.budget} 元（交通 ${c.transport}、住宿 ${c.hotel}、餐饮 ${c.meals}、门票 ${c.tickets}；按 ${spec.people} 人计算）`,
          `total cost ¥${c.total} is over the ¥${spec.budget} budget (transport ${c.transport}, hotels ${c.hotel}, meals ${c.meals}, tickets ${c.tickets}; for ${spec.people} ${spec.people === 1 ? 'person' : 'people'})`,
        ),
      )
  }
  return out
}

function list(vs: string[], max = 6): string {
  const shown = vs.slice(0, max).map((v, i) => `${i + 1}) ${v}`)
  return shown.join(L('；', '; ')) + (vs.length > max ? L(`；……共 ${vs.length} 条`, `; ... ${vs.length} in total`) : '')
}

export function checkTravel(spec: TripSpec, output: unknown): CheckResult {
  const parsed = TravelPlanSchema.safeParse(output)
  if (!parsed.success)
    return {
      pass: false,
      reason: L(
        `返回值格式不对：${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '（根）'} ${i.message}`)
          .join('；')}。应为 types.ts 里的 TravelPlan：{ feasible, reason?, days: [{ date, city, transport, attractions, meals, hotel }] }`,
        `The return value has the wrong shape: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
          .join('; ')}. It should be the TravelPlan from types.ts: { feasible, reason?, days: [{ date, city, transport, attractions, meals, hotel }] }`,
      ),
    }
  const plan = parsed.data
  if (!spec.feasible) {
    if (plan.feasible) {
      const vs = violations(spec, plan)
      return {
        pass: false,
        reason: L(
          `这个需求无法满足（${spec.infeasibleWhy}），应该返回 feasible: false 并说明原因，而不是给出一份不合规的计划${vs.length ? `。这份计划的问题：${list(vs, 3)}` : ''}`,
          `This request can't be met (${spec.infeasibleWhy}). Return feasible: false with the reason instead of a plan that breaks the rules${vs.length ? `. Problems with this plan: ${list(vs, 3)}` : ''}`,
        ),
      }
    }
    const reason = plan.reason ?? ''
    const words = spec.infeasibleWords ?? []
    if (!reason.trim() || (words.length && !words.some((w) => reason.toLowerCase().includes(w.toLowerCase()))))
      return {
        pass: false,
        reason: L(
          `判断正确（不可行），但 reason 要向客户说明原因（${spec.infeasibleWhy}）。实际：“${reason.slice(0, 60)}”`,
          `Correctly judged infeasible, but reason should explain why to the customer (${spec.infeasibleWhy}). Got: "${reason.slice(0, 80)}"`,
        ),
      }
    return { pass: true, reason: L(`正确判断为不可行：${reason.slice(0, 60)}`, `Correctly judged infeasible: ${reason.slice(0, 80)}`) }
  }
  if (!plan.feasible)
    return {
      pass: false,
      reason: L(
        `这个需求是可以满足的（存在满足全部约束的方案），不应该返回 feasible: false。给出的原因：“${(plan.reason ?? '').slice(0, 60)}”`,
        `This request can be met (a plan satisfying every constraint exists), so it shouldn't return feasible: false. Reason given: "${(plan.reason ?? '').slice(0, 80)}"`,
      ),
    }
  const vs = violations(spec, plan)
  if (vs.length) return { pass: false, reason: L(`计划不满足 ${vs.length} 条约束：${list(vs)}`, `The plan breaks ${vs.length} constraint(s): ${list(vs)}`) }
  const c = costOf(spec, plan)
  return {
    pass: true,
    reason: L(
      `计划满足全部约束，总花费 ${c.total} 元${spec.budget !== null ? ` / 预算 ${spec.budget} 元` : ''}`,
      `The plan meets every constraint; total cost ¥${c.total}${spec.budget !== null ? ` / budget ¥${spec.budget}` : ''}`,
    ),
  }
}
