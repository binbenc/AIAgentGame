/**
 * 确定性的约束校验器：模型不擅长算账、查日历、对营业时间，这些都交给代码。
 * 规则和需求文档里的判定规则一一对应；校验结果用中文逐条列出，直接发回给模型去修改。
 */
import type { Attraction, Hotel, Restaurant, Transport, TravelEnv, TravelPlan, TripRequest } from './types'

export interface Catalog {
  /** 每一程（按日期顺序）：第几天、从哪到哪、可选班次 */
  legs: { day: number; from: string; to: string; date: string; options: Transport[] }[]
  hotels: Map<string, Hotel>
  restaurants: Map<string, Restaurant>
  attractions: Map<string, Attraction>
  transports: Map<string, Transport>
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const SLOTS = { breakfast: 8 * 60, lunch: 12 * 60, dinner: 18 * 60 + 30 } as const
const MEAL_NAMES = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as const
type Meal = keyof typeof SLOTS

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10)
}
export const weekdayOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}
export const totalDays = (r: TripRequest) => r.stops.reduce((n, s) => n + s.days, 0)
export const dayCities = (r: TripRequest) => r.stops.flatMap((s) => Array.from({ length: s.days }, () => s.city))
export const rooms = (people: number, h: Hotel) => Math.ceil(people / h.maxOccupancy)

export function openAt(hours: string, slot: number): boolean {
  return hours.split(',').some((range) => {
    const [a, b] = range.split('-').map((s) => toMin(s.trim()))
    return a <= slot && slot + 60 <= (b <= a ? b + 1440 : b)
  })
}

/** 当天在 city 的可活动时间：到达之后、出发前 1 小时之前 */
export function windowOf(city: string, legs: Transport[]) {
  let start = 8 * 60
  let end = 21 * 60
  for (const t of legs) {
    if (t.to === city) start = Math.max(start, toMin(t.arrive))
    if (t.from === city) end = Math.min(end, toMin(t.depart) - 60)
  }
  return { start, end }
}
const fits = (w: { start: number; end: number }, meal: Meal) => SLOTS[meal] >= w.start && SLOTS[meal] + 60 <= w.end

/** 把行程需要的数据一次查齐（并行） */
export async function gather(req: TripRequest, env: TravelEnv): Promise<Catalog> {
  const n = totalDays(req)
  const cities = dayCities(req)
  const legSpecs: { day: number; from: string; to: string; date: string }[] = []
  for (let i = 0; i < n; i++) {
    const from = i === 0 ? req.origin : cities[i - 1]
    const to = i === n - 1 ? req.origin : cities[i]
    if (from !== to) legSpecs.push({ day: i, from, to, date: addDays(req.startDate, i) })
  }
  const unique = [...new Set(cities)]
  const [legs, perCity] = await Promise.all([
    Promise.all(legSpecs.map(async (l) => ({ ...l, options: await env.searchTransport(l.from, l.to, l.date) }))),
    Promise.all(unique.map(async (c) => Promise.all([env.searchHotels(c), env.searchRestaurants(c), env.searchAttractions(c)]))),
  ])
  return {
    legs,
    transports: new Map(legs.flatMap((l) => l.options).map((t) => [t.id, t])),
    hotels: new Map(perCity.flatMap(([h]) => h).map((x) => [x.id, x])),
    restaurants: new Map(perCity.flatMap(([, r]) => r).map((x) => [x.id, x])),
    attractions: new Map(perCity.flatMap(([, , a]) => a).map((x) => [x.id, x])),
  }
}

/** 每一站的入住晚数 */
export function nightsByStop(req: TripRequest): Map<string, number> {
  const n = totalDays(req)
  const out = new Map<string, number>()
  dayCities(req).forEach((c, i) => {
    if (i < n - 1) out.set(c, (out.get(c) ?? 0) + 1)
  })
  return out
}

/** 硬性偏好直接在数据层过滤掉：模型看不到的选项就不会选错 */
export function prefilter(c: Catalog, req: TripRequest): Catalog {
  const p = req.preferences
  const nights = nightsByStop(req)
  const keep = <T>(m: Map<string, T>, ok: (x: T) => boolean) => new Map([...m].filter(([, x]) => ok(x)))
  return {
    legs: c.legs.map((l) => ({ ...l, options: l.options.filter((t) => !(p.noFlight && t.mode === '飞机')) })),
    transports: keep(c.transports, (t) => !(p.noFlight && t.mode === '飞机')),
    hotels: keep(
      c.hotels,
      (h) => (!p.pets || h.petsAllowed) && (!p.accessible || h.barrierFree) && (!p.roomType || h.roomType === p.roomType) && h.minNights <= (nights.get(h.city) ?? 0),
    ),
    restaurants: c.restaurants,
    attractions: keep(c.attractions, (a) => !p.accessible || a.barrierFree),
  }
}

/** 可行性下界：最便宜的组合都超预算、或者某一程 / 某一站根本没有可选项时，直接判定不可行 */
export function infeasibility(c: Catalog, req: TripRequest): string | null {
  const p = req.preferences
  for (const l of c.legs)
    if (!l.options.length) return `${l.date} 没有从${l.from}到${l.to}的${p.noFlight ? '高铁（客户不坐飞机，而这条线路只有航班）' : '交通'}，无法安排行程。`
  const nights = nightsByStop(req)
  const hotels = [...c.hotels.values()]
  let hotelMin = 0
  for (const [city, k] of nights) {
    const cands = hotels.filter((h) => h.city === city)
    if (!cands.length) {
      const why = [p.pets && '可携带宠物', p.accessible && '有无障碍客房', p.roomType && `房型为${p.roomType}`, `最少连住不超过 ${k} 晚`].filter(Boolean).join('、')
      return `${city}没有满足要求的酒店（${why}），无法安排住宿。`
    }
    hotelMin += Math.min(...cands.map((h) => h.price * rooms(req.people, h))) * k
  }
  if (req.budget === null) return null
  const transportMin = c.legs.reduce((s, l) => s + Math.min(...l.options.map((t) => t.price)), 0) * req.people
  // 没有长途交通的整天至少要吃午餐 + 晚餐、看 1 个景点
  const fullDays = new Map<string, number>()
  dayCities(req).forEach((city, i) => {
    if (!c.legs.some((l) => l.day === i)) fullDays.set(city, (fullDays.get(city) ?? 0) + 1)
  })
  let extra = 0
  for (const [city, k] of fullDays) {
    const meals = [...c.restaurants.values()].filter((r) => r.city === city).map((r) => r.avgCost).sort((a, b) => a - b)
    const tickets = [...c.attractions.values()].filter((a) => a.city === city).map((a) => a.ticket).sort((a, b) => a - b)
    extra += (meals.slice(0, 2 * k).reduce((s, x) => s + x, 0) + tickets.slice(0, k).reduce((s, x) => s + x, 0)) * req.people
  }
  const min = transportMin + hotelMin + extra
  if (min > req.budget)
    return `预算不足：最便宜的组合也需要约 ${min} 元（交通至少 ${transportMin} 元、住宿至少 ${hotelMin} 元），超出预算 ${req.budget} 元。`
  return null
}

export function costOf(plan: TravelPlan, req: TripRequest, c: Catalog) {
  let transport = 0
  let hotel = 0
  let meals = 0
  let tickets = 0
  for (const d of plan.days) {
    for (const id of d.transport) transport += (c.transports.get(id)?.price ?? 0) * req.people
    const h = d.hotel ? c.hotels.get(d.hotel) : undefined
    if (h) hotel += h.price * rooms(req.people, h)
    for (const id of Object.values(d.meals)) if (id) meals += (c.restaurants.get(id)?.avgCost ?? 0) * req.people
    for (const id of d.attractions) tickets += (c.attractions.get(id)?.ticket ?? 0) * req.people
  }
  return { transport, hotel, meals, tickets, total: transport + hotel + meals + tickets }
}

/** 逐条列出计划违反的约束；空数组表示通过 */
export function verify(plan: TravelPlan, req: TripRequest, c: Catalog): string[] {
  const out: string[] = []
  const n = totalDays(req)
  const cities = dayCities(req)
  const p = req.preferences
  if (plan.days.length !== n) out.push(`行程应为 ${n} 天，计划里有 ${plan.days.length} 天`)
  const usedR = new Set<string>()
  const usedA = new Set<string>()
  const cuisines = new Set<string>()

  plan.days.slice(0, n).forEach((d, i) => {
    const date = addDays(req.startDate, i)
    const tag = `第 ${i + 1} 天（${date} ${weekdayOf(date)}）`
    const city = cities[i]
    if (d.date !== date) out.push(`${tag}：date 应为 ${date}`)
    if (d.city !== city) out.push(`${tag}：city 应为“${city}”`)
    const from = i === 0 ? req.origin : cities[i - 1]
    const to = i === n - 1 ? req.origin : city
    const legs: Transport[] = []
    for (const id of d.transport) {
      const t = c.transports.get(id)
      if (!t) out.push(`${tag}：交通 ${id} 不在可选项里`)
      else if (t.date !== date) out.push(`${tag}：交通 ${id} 不是当天的班次`)
      else legs.push(t)
    }
    legs.sort((a, b) => toMin(a.depart) - toMin(b.depart))
    if (from !== to) {
      if (!legs.length) out.push(`${tag}：缺少从${from}到${to}的交通`)
      else if (legs[0].from !== from || legs[legs.length - 1].to !== to) out.push(`${tag}：交通应从${from}出发、到达${to}`)
    } else if (legs.length) out.push(`${tag}：当天不需要长途交通`)
    if (p.noFlight) for (const t of legs) if (t.mode === '飞机') out.push(`${tag}：客户不坐飞机，${t.id} 是航班`)

    const w = windowOf(city, legs)
    const span = `${fmt(w.start)}~${fmt(Math.max(w.start, w.end))}`
    let meals = 0
    for (const meal of Object.keys(SLOTS) as Meal[]) {
      const id = d.meals[meal]
      if (!id) {
        if (meal !== 'breakfast' && fits(w, meal)) out.push(`${tag}${MEAL_NAMES[meal]}没有安排（当天可活动时间 ${span}）`)
        continue
      }
      const r = c.restaurants.get(id)
      if (!r) {
        out.push(`${tag}${MEAL_NAMES[meal]}：餐厅 ${id} 不在可选项里`)
        continue
      }
      meals++
      if (r.city !== city) out.push(`${tag}${MEAL_NAMES[meal]}：${id} 不在${city}`)
      if (!fits(w, meal)) out.push(`${tag}${MEAL_NAMES[meal]}：${fmt(SLOTS[meal])} 不在可活动时间 ${span} 内（到达之后、出发前 1 小时之前），去掉这顿或换班次`)
      if (!openAt(r.hours, SLOTS[meal])) out.push(`${tag}${MEAL_NAMES[meal]}：${r.name}（${id}）营业时间 ${r.hours}，${fmt(SLOTS[meal])} 不营业`)
      if (usedR.has(id)) out.push(`${tag}：餐厅 ${id} 重复了`)
      usedR.add(id)
      cuisines.add(r.cuisine)
    }
    let hours = 0
    for (const id of d.attractions) {
      const a = c.attractions.get(id)
      if (!a) {
        out.push(`${tag}：景点 ${id} 不在可选项里`)
        continue
      }
      hours += a.duration
      if (a.city !== city) out.push(`${tag}：景点 ${id} 不在${city}`)
      if (p.accessible && !a.barrierFree) out.push(`${tag}：${a.name}（${id}）没有无障碍设施`)
      if (a.closedOn === weekdayOf(date)) out.push(`${tag}：${a.name}（${id}）${a.closedOn}闭馆，换到别的日子或换景点`)
      if (usedA.has(id)) out.push(`${tag}：景点 ${id} 重复了`)
      usedA.add(id)
    }
    if (p.maxAttractionsPerDay && d.attractions.length > p.maxAttractionsPerDay) out.push(`${tag}：景点超过每天最多 ${p.maxAttractionsPerDay} 个的要求`)
    if (d.attractions.length && (hours + meals) * 60 > Math.max(0, w.end - w.start)) out.push(`${tag}：景点 ${hours} 小时 + ${meals} 顿饭，超出可活动时间 ${span}`)
    if (from === to && !d.attractions.length) out.push(`${tag}：完整的一天至少安排 1 个景点`)

    if (i === n - 1) {
      if (d.hotel) out.push(`${tag}：最后一天不需要住宿，hotel 应为 null`)
    } else if (!d.hotel) out.push(`${tag}：没有安排住宿`)
    else {
      const h = c.hotels.get(d.hotel)
      if (!h) out.push(`${tag}：酒店 ${d.hotel} 不在可选项里`)
      else {
        if (h.city !== city) out.push(`${tag}：酒店 ${d.hotel} 不在${city}`)
        if (p.pets && !h.petsAllowed) out.push(`${tag}：客户带宠物，酒店 ${h.id} 禁止携带宠物`)
        if (p.accessible && !h.barrierFree) out.push(`${tag}：客户需要无障碍，酒店 ${h.id} 没有无障碍客房`)
        if (p.roomType && h.roomType !== p.roomType) out.push(`${tag}：客户要求${p.roomType}，酒店 ${h.id} 是${h.roomType}`)
      }
    }
  })

  // 最少连住
  for (let i = 0; i < n - 1; ) {
    const id = plan.days[i]?.hotel
    let j = i
    while (j < n - 1 && plan.days[j]?.hotel === id) j++
    const h = id ? c.hotels.get(id) : undefined
    if (h && j - i < h.minNights) out.push(`酒店 ${h.id} 要求最少连住 ${h.minNights} 晚，只住了 ${j - i} 晚`)
    i = j
  }
  for (const want of p.cuisines) if (!cuisines.has(want)) out.push(`客户想吃${want}，行程里还没有${want}餐厅`)
  if (req.budget !== null) {
    const cost = costOf(plan, req, c)
    if (cost.total > req.budget)
      out.push(`总花费 ${cost.total} 元超出预算 ${req.budget} 元（交通 ${cost.transport}、住宿 ${cost.hotel}、餐饮 ${cost.meals}、门票 ${cost.tickets}），请换更便宜的交通 / 酒店 / 餐厅`)
  }
  return out
}

/** 给模型看的紧凑数据：一行一个选项，id 在最前面；日期带星期，方便核对闭馆日 */
export function render(c: Catalog, req: TripRequest): string {
  const n = totalDays(req)
  const cities = dayCities(req)
  const lines: string[] = ['## 日程']
  for (let i = 0; i < n; i++) {
    const date = addDays(req.startDate, i)
    lines.push(`- 第 ${i + 1} 天 ${date}（${weekdayOf(date)}）：${cities[i]}${i === n - 1 ? `，当天返回${req.origin}` : ''}`)
  }
  lines.push('', '## 交通（每人票价）')
  for (const l of c.legs) {
    lines.push(`### 第 ${l.day + 1} 天 ${l.from}→${l.to}`)
    for (const t of l.options) lines.push(`${t.id} ${t.mode} ${t.depart}→${t.arrive} ¥${t.price}`)
  }
  for (const city of new Set(cities)) {
    lines.push('', `## ${city} · 酒店（每间每晚）`)
    for (const h of c.hotels.values()) if (h.city === city) lines.push(`${h.id} ${h.name} ¥${h.price} ${h.roomType}（每间≤${h.maxOccupancy}人，需 ${rooms(req.people, h)} 间）评分${h.rating}`)
    lines.push(`## ${city} · 餐厅（人均）`)
    for (const r of c.restaurants.values()) if (r.city === city) lines.push(`${r.id} ${r.name} ${r.cuisine} ¥${r.avgCost} 营业${r.hours}`)
    lines.push(`## ${city} · 景点（每人门票）`)
    for (const a of c.attractions.values()) if (a.city === city) lines.push(`${a.id} ${a.name} ¥${a.ticket} ${a.duration}小时${a.closedOn ? ` ${a.closedOn}闭馆` : ''}`)
  }
  return lines.join('\n')
}
