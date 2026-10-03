/**
 * Deterministic constraint checker: models are bad at arithmetic, calendars and opening hours, so code does all of that.
 * The rules map one-to-one to the grading rules in the brief; problems are listed one per line and sent straight back to the model to fix.
 */
import type { Attraction, Hotel, Restaurant, Transport, TravelEnv, TravelPlan, TripRequest } from './types'

export interface Catalog {
  /** Each leg (in date order): which day, from where to where, available departures */
  legs: { day: number; from: string; to: string; date: string; options: Transport[] }[]
  hotels: Map<string, Hotel>
  restaurants: Map<string, Restaurant>
  attractions: Map<string, Attraction>
  transports: Map<string, Transport>
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SLOTS = { breakfast: 8 * 60, lunch: 12 * 60, dinner: 18 * 60 + 30 } as const
const MEAL_NAMES = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner' } as const
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

/** Free time in city that day: after arrival, until 1 hour before departure */
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

/** Fetch everything the trip needs in one go (in parallel) */
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

/** Nights at each stop */
export function nightsByStop(req: TripRequest): Map<string, number> {
  const n = totalDays(req)
  const out = new Map<string, number>()
  dayCities(req).forEach((c, i) => {
    if (i < n - 1) out.set(c, (out.get(c) ?? 0) + 1)
  })
  return out
}

/** Filter out hard preferences at the data layer: the model can't pick an option it never sees */
export function prefilter(c: Catalog, req: TripRequest): Catalog {
  const p = req.preferences
  const nights = nightsByStop(req)
  const keep = <T>(m: Map<string, T>, ok: (x: T) => boolean) => new Map([...m].filter(([, x]) => ok(x)))
  return {
    legs: c.legs.map((l) => ({ ...l, options: l.options.filter((t) => !(p.noFlight && t.mode === 'flight')) })),
    transports: keep(c.transports, (t) => !(p.noFlight && t.mode === 'flight')),
    hotels: keep(
      c.hotels,
      (h) => (!p.pets || h.petsAllowed) && (!p.accessible || h.barrierFree) && (!p.roomType || h.roomType === p.roomType) && h.minNights <= (nights.get(h.city) ?? 0),
    ),
    restaurants: c.restaurants,
    attractions: keep(c.attractions, (a) => !p.accessible || a.barrierFree),
  }
}

/** Feasibility lower bound: infeasible if even the cheapest combination is over budget, or some leg / stop has no options at all */
export function infeasibility(c: Catalog, req: TripRequest): string | null {
  const p = req.preferences
  for (const l of c.legs)
    if (!l.options.length)
      return `There's no ${p.noFlight ? "train (the customer won't fly, and this route only has flights)" : 'transport'} from ${l.from} to ${l.to} on ${l.date}, so the trip can't be planned.`
  const nights = nightsByStop(req)
  const hotels = [...c.hotels.values()]
  let hotelMin = 0
  for (const [city, k] of nights) {
    const cands = hotels.filter((h) => h.city === city)
    if (!cands.length) {
      const why = [p.pets && 'pets allowed', p.accessible && 'accessible rooms', p.roomType && `room type: ${p.roomType}`, `minimum stay of at most ${k} night(s)`].filter(Boolean).join(', ')
      return `No hotel in ${city} meets the requirements (${why}), so there's nowhere to stay.`
    }
    hotelMin += Math.min(...cands.map((h) => h.price * rooms(req.people, h))) * k
  }
  if (req.budget === null) return null
  const transportMin = c.legs.reduce((s, l) => s + Math.min(...l.options.map((t) => t.price)), 0) * req.people
  // A full day without long-distance travel needs at least lunch + dinner and 1 attraction
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
    return `Over budget: even the cheapest combination costs about ¥${min} (transport at least ¥${transportMin}, hotels at least ¥${hotelMin}), more than the ¥${req.budget} budget.`
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

/** List every constraint the plan breaks; an empty array means it passes */
export function verify(plan: TravelPlan, req: TripRequest, c: Catalog): string[] {
  const out: string[] = []
  const n = totalDays(req)
  const cities = dayCities(req)
  const p = req.preferences
  if (plan.days.length !== n) out.push(`the trip should be ${n} days, but the plan has ${plan.days.length}`)
  const usedR = new Set<string>()
  const usedA = new Set<string>()
  const cuisines = new Set<string>()

  plan.days.slice(0, n).forEach((d, i) => {
    const date = addDays(req.startDate, i)
    const tag = `Day ${i + 1} (${date}, ${weekdayOf(date)})`
    const city = cities[i]
    if (d.date !== date) out.push(`${tag}: date should be ${date}`)
    if (d.city !== city) out.push(`${tag}: city should be "${city}"`)
    const from = i === 0 ? req.origin : cities[i - 1]
    const to = i === n - 1 ? req.origin : city
    const legs: Transport[] = []
    for (const id of d.transport) {
      const t = c.transports.get(id)
      if (!t) out.push(`${tag}: transport ${id} is not among the options`)
      else if (t.date !== date) out.push(`${tag}: transport ${id} doesn't run that day`)
      else legs.push(t)
    }
    legs.sort((a, b) => toMin(a.depart) - toMin(b.depart))
    if (from !== to) {
      if (!legs.length) out.push(`${tag}: missing transport from ${from} to ${to}`)
      else if (legs[0].from !== from || legs[legs.length - 1].to !== to) out.push(`${tag}: transport should go from ${from} to ${to}`)
    } else if (legs.length) out.push(`${tag}: no long-distance transport is needed that day`)
    if (p.noFlight) for (const t of legs) if (t.mode === 'flight') out.push(`${tag}: the customer won't fly, but ${t.id} is a flight`)

    const w = windowOf(city, legs)
    const span = `${fmt(w.start)}~${fmt(Math.max(w.start, w.end))}`
    let meals = 0
    for (const meal of Object.keys(SLOTS) as Meal[]) {
      const id = d.meals[meal]
      if (!id) {
        if (meal !== 'breakfast' && fits(w, meal)) out.push(`${tag}: ${MEAL_NAMES[meal]} is missing (free time that day: ${span})`)
        continue
      }
      const r = c.restaurants.get(id)
      if (!r) {
        out.push(`${tag} ${MEAL_NAMES[meal]}: restaurant ${id} is not among the options`)
        continue
      }
      meals++
      if (r.city !== city) out.push(`${tag} ${MEAL_NAMES[meal]}: ${id} is not in ${city}`)
      if (!fits(w, meal))
        out.push(`${tag} ${MEAL_NAMES[meal]}: ${fmt(SLOTS[meal])} is outside the free time ${span} (after arrival, until 1 hour before departure); drop this meal or pick another departure`)
      if (!openAt(r.hours, SLOTS[meal])) out.push(`${tag} ${MEAL_NAMES[meal]}: ${r.name} (${id}) opening hours ${r.hours}; not open at ${fmt(SLOTS[meal])}`)
      if (usedR.has(id)) out.push(`${tag}: restaurant ${id} is used twice`)
      usedR.add(id)
      cuisines.add(r.cuisine)
    }
    let hours = 0
    for (const id of d.attractions) {
      const a = c.attractions.get(id)
      if (!a) {
        out.push(`${tag}: attraction ${id} is not among the options`)
        continue
      }
      hours += a.duration
      if (a.city !== city) out.push(`${tag}: attraction ${id} is not in ${city}`)
      if (p.accessible && !a.barrierFree) out.push(`${tag}: ${a.name} (${id}) is not wheelchair accessible`)
      if (a.closedOn === weekdayOf(date)) out.push(`${tag}: ${a.name} (${id}) is closed on ${a.closedOn}s; move it to another day or pick another attraction`)
      if (usedA.has(id)) out.push(`${tag}: attraction ${id} is used twice`)
      usedA.add(id)
    }
    if (p.maxAttractionsPerDay && d.attractions.length > p.maxAttractionsPerDay) out.push(`${tag}: more than the limit of ${p.maxAttractionsPerDay} attraction(s) per day`)
    if (d.attractions.length && (hours + meals) * 60 > Math.max(0, w.end - w.start)) out.push(`${tag}: ${hours}h of sightseeing + ${meals} meal(s) don't fit in the free time ${span}`)
    if (from === to && !d.attractions.length) out.push(`${tag}: a full day needs at least 1 attraction`)

    if (i === n - 1) {
      if (d.hotel) out.push(`${tag}: no hotel on the last day; hotel should be null`)
    } else if (!d.hotel) out.push(`${tag}: no hotel for the night`)
    else {
      const h = c.hotels.get(d.hotel)
      if (!h) out.push(`${tag}: hotel ${d.hotel} is not among the options`)
      else {
        if (h.city !== city) out.push(`${tag}: hotel ${d.hotel} is not in ${city}`)
        if (p.pets && !h.petsAllowed) out.push(`${tag}: the customer has a pet, but hotel ${h.id} doesn't allow pets`)
        if (p.accessible && !h.barrierFree) out.push(`${tag}: the customer needs wheelchair access, but hotel ${h.id} has no accessible rooms`)
        if (p.roomType && h.roomType !== p.roomType) out.push(`${tag}: the customer wants a ${p.roomType}, but hotel ${h.id} has a ${h.roomType}`)
      }
    }
  })

  // Minimum stay
  for (let i = 0; i < n - 1; ) {
    const id = plan.days[i]?.hotel
    let j = i
    while (j < n - 1 && plan.days[j]?.hotel === id) j++
    const h = id ? c.hotels.get(id) : undefined
    if (h && j - i < h.minNights) out.push(`hotel ${h.id} has a minimum stay of ${h.minNights} nights, but only ${j - i} are planned`)
    i = j
  }
  for (const want of p.cuisines) if (!cuisines.has(want)) out.push(`the customer wants ${want}, but no ${want} restaurant is planned yet`)
  if (req.budget !== null) {
    const cost = costOf(plan, req, c)
    if (cost.total > req.budget)
      out.push(
        `total cost ¥${cost.total} is over the ¥${req.budget} budget (transport ${cost.transport}, hotels ${cost.hotel}, meals ${cost.meals}, tickets ${cost.tickets}); switch to cheaper transport / hotels / restaurants`,
      )
  }
  return out
}

/** Compact data for the model: one option per line, id first; dates come with the weekday so closing days are easy to check */
export function render(c: Catalog, req: TripRequest): string {
  const n = totalDays(req)
  const cities = dayCities(req)
  const lines: string[] = ['## Schedule']
  for (let i = 0; i < n; i++) {
    const date = addDays(req.startDate, i)
    lines.push(`- Day ${i + 1} ${date} (${weekdayOf(date)}): ${cities[i]}${i === n - 1 ? `, returning to ${req.origin} that day` : ''}`)
  }
  lines.push('', '## Transport (fare per person)')
  for (const l of c.legs) {
    lines.push(`### Day ${l.day + 1} ${l.from}→${l.to}`)
    for (const t of l.options) lines.push(`${t.id} ${t.mode} ${t.depart}→${t.arrive} ¥${t.price}`)
  }
  for (const city of new Set(cities)) {
    lines.push('', `## ${city} · Hotels (per room per night)`)
    for (const h of c.hotels.values())
      if (h.city === city) lines.push(`${h.id} ${h.name} ¥${h.price} ${h.roomType} (≤${h.maxOccupancy} per room, ${rooms(req.people, h)} room(s) needed) rating ${h.rating}`)
    lines.push(`## ${city} · Restaurants (per person)`)
    for (const r of c.restaurants.values()) if (r.city === city) lines.push(`${r.id} ${r.name} ${r.cuisine} ¥${r.avgCost} open ${r.hours}`)
    lines.push(`## ${city} · Attractions (ticket per person)`)
    for (const a of c.attractions.values()) if (a.city === city) lines.push(`${a.id} ${a.name} ¥${a.ticket} ${a.duration}h${a.closedOn ? ` closed ${a.closedOn}s` : ''}`)
  }
  return lines.join('\n')
}
