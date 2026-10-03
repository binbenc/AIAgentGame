/**
 * 远方旅行社 · 接口约定。plan() 必须返回符合 TravelPlanSchema 的对象；其余类型是产品库 API 的数据结构。
 * TripRequest 是建议的“结构化需求”格式，可以按需修改。
 */
import { z } from 'zod'

// —————————————— 产品库 API（环境提供） ——————————————

export interface Transport {
  /** 车次/航班号-月日，例如 "G1974-1106" */
  id: string
  code: string
  mode: '高铁' | '飞机'
  from: string
  to: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM */
  depart: string
  arrive: string
  /** 每人票价（元） */
  price: number
}

export interface Hotel {
  /** 例如 "H-CD-04" */
  id: string
  city: string
  name: string
  /** 每间每晚（元）；青旅床位是每床每晚 */
  price: number
  rating: number
  roomType: '大床房' | '双床房' | '家庭房' | '青旅床位'
  /** 每间最多住几人：需要的房间数 = ceil(人数 / maxOccupancy) */
  maxOccupancy: number
  /** 最少连续入住晚数 */
  minNights: number
  petsAllowed: boolean
  barrierFree: boolean
  rules: string[]
}

export interface Restaurant {
  /** 例如 "R-CD-03" */
  id: string
  city: string
  name: string
  cuisine: string
  /** 人均（元） */
  avgCost: number
  /** 例如 "11:00-14:00,17:00-21:30"；结束时间小于开始时间表示营业到次日凌晨 */
  hours: string
  rating: number
}

export interface Attraction {
  /** 例如 "A-CD-02" */
  id: string
  city: string
  name: string
  /** 每人门票（元） */
  ticket: number
  /** 建议游览时长（小时） */
  duration: number
  /** 每周闭馆日，例如 "周一"；null 表示全年开放 */
  closedOn: string | null
  barrierFree: boolean
  rating: number
}

export interface TravelEnv {
  cities(): Promise<string[]>
  /** 某天从 from 到 to 的全部班次（按出发时间排序）；date 形如 "2026-11-06" */
  searchTransport(from: string, to: string, date: string): Promise<Transport[]>
  /** 按评分从高到低 */
  searchHotels(city: string): Promise<Hotel[]>
  searchRestaurants(city: string, cuisine?: string): Promise<Restaurant[]>
  searchAttractions(city: string): Promise<Attraction[]>
}

// —————————————— 返回值：行程计划 ——————————————

const Id = z.string().min(1)

export const DayPlanSchema = z.object({
  /** YYYY-MM-DD，从出发日起连续 */
  date: z.string(),
  /** 当天活动所在的城市；最后一天写最后一个目的地（返程交通也写在这一天） */
  city: z.string(),
  /** 当天乘坐的交通 id（没有长途交通的日子为空数组） */
  transport: z.array(Id).default([]),
  /** 当天游览的景点 id */
  attractions: z.array(Id).default([]),
  /** 早餐 08:00（可选）、午餐 12:00、晚餐 18:30，各 1 小时 */
  meals: z
    .object({
      breakfast: Id.nullable().optional(),
      lunch: Id.nullable().optional(),
      dinner: Id.nullable().optional(),
    })
    .default({}),
  /** 当晚入住的酒店 id；最后一天为 null */
  hotel: Id.nullable().optional(),
})

export const TravelPlanSchema = z.object({
  /** 需求无法满足时为 false，并在 reason 里说明原因（days 可以为空） */
  feasible: z.boolean(),
  reason: z.string().optional(),
  days: z.array(DayPlanSchema).default([]),
  /** 你自己估算的总花费（仅供参考，判定器会按产品库价格重新核算） */
  estimatedCost: z.number().optional(),
})

export type DayPlan = z.infer<typeof DayPlanSchema>
export type TravelPlan = z.infer<typeof TravelPlanSchema>

// —————————————— 建议：结构化的需求 ——————————————

export const TripRequestSchema = z.object({
  origin: z.string(),
  /** 按游玩顺序的目的地，以及每个目的地玩几天（天数之和 = 行程总天数） */
  stops: z.array(z.object({ city: z.string(), days: z.number().int().min(1) })).min(1),
  /** YYYY-MM-DD */
  startDate: z.string(),
  people: z.number().int().min(1),
  /** 总预算（元），没说就是 null */
  budget: z.number().nullable(),
  preferences: z.object({
    cuisines: z.array(z.string()).default([]),
    noFlight: z.boolean().default(false),
    pets: z.boolean().default(false),
    accessible: z.boolean().default(false),
    maxAttractionsPerDay: z.number().int().nullable().default(null),
    roomType: z.string().nullable().default(null),
  }),
})
export type TripRequest = z.infer<typeof TripRequestSchema>
