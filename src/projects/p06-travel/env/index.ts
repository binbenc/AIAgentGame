/**
 * P6 的环境：远方旅行社的产品库 API。只读、确定性；所有调用都会记录到 trace。
 * 和 TravelPlanner 一样，环境只提供“查询”，计划由玩家的 Agent 组装，判定器用同一份数据库独立核算。
 */
import type { EnvCtx } from '../../types'
import { ATTRACTIONS, CITIES, HOTELS, RESTAURANTS, transportsOn, type Attraction, type Hotel, type Restaurant, type Transport } from './data'

export interface TravelEnv {
  /** 产品库覆盖的城市 */
  cities(): Promise<string[]>
  /** 某天从 from 到 to 的全部高铁 / 航班（按出发时间排序）；日期格式 YYYY-MM-DD */
  searchTransport(from: string, to: string, date: string): Promise<Transport[]>
  /** 某城市的全部酒店（按评分从高到低） */
  searchHotels(city: string): Promise<Hotel[]>
  /** 某城市的餐厅（按评分从高到低）；cuisine 可选，按菜系过滤 */
  searchRestaurants(city: string, cuisine?: string): Promise<Restaurant[]>
  /** 某城市的景点（按评分从高到低） */
  searchAttractions(city: string): Promise<Attraction[]>
}

const norm = (s: unknown) => String(s ?? '').trim().replace(/市$/, '')
const byRating = <T extends { rating: number }>(xs: T[]) => [...xs].sort((a, b) => b.rating - a.rating)

export function createTravelEnv(ctx: EnvCtx): TravelEnv {
  const io = async <T>(v: T): Promise<T> => {
    await ctx.delay(80)
    return structuredClone(v)
  }
  return {
    cities: ctx.traced('cities', () => io([...CITIES])),
    searchTransport: ctx.traced('searchTransport', (from: string, to: string, date: string) => io(transportsOn(norm(from), norm(to), String(date ?? '').trim()))),
    searchHotels: ctx.traced('searchHotels', (city: string) => io(byRating(HOTELS.filter((h) => h.city === norm(city))))),
    searchRestaurants: ctx.traced('searchRestaurants', (city: string, cuisine?: string) =>
      io(byRating(RESTAURANTS.filter((r) => r.city === norm(city) && (!cuisine || r.cuisine.includes(String(cuisine).trim()))))),
    ),
    searchAttractions: ctx.traced('searchAttractions', (city: string) => io(byRating(ATTRACTIONS.filter((a) => a.city === norm(city))))),
  }
}
