/**
 * Faraway Travel · interface contract. plan() must return an object matching TravelPlanSchema; the other types are the catalog API's data structures.
 * TripRequest is a suggested "structured request" format; change it as you see fit.
 */
import { z } from 'zod'

// —————————————— Catalog API (provided by the environment) ——————————————

export interface Transport {
  /** Train / flight number + month and day, e.g. "G1974-1106" */
  id: string
  code: string
  mode: 'train' | 'flight'
  from: string
  to: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM */
  depart: string
  arrive: string
  /** Fare per person (¥) */
  price: number
}

export interface Hotel {
  /** e.g. "H-CD-04" */
  id: string
  city: string
  name: string
  /** Per room per night (¥); for dorm beds, per bed per night */
  price: number
  rating: number
  roomType: 'king room' | 'twin room' | 'family room' | 'dorm bed'
  /** Max guests per room: rooms needed = ceil(people / maxOccupancy) */
  maxOccupancy: number
  /** Minimum consecutive nights */
  minNights: number
  petsAllowed: boolean
  barrierFree: boolean
  rules: string[]
}

export interface Restaurant {
  /** e.g. "R-CD-03" */
  id: string
  city: string
  name: string
  cuisine: string
  /** Average cost per person (¥) */
  avgCost: number
  /** e.g. "11:00-14:00,17:00-21:30"; an end time earlier than the start means open past midnight */
  hours: string
  rating: number
}

export interface Attraction {
  /** e.g. "A-CD-02" */
  id: string
  city: string
  name: string
  /** Ticket per person (¥) */
  ticket: number
  /** Suggested visit length (hours) */
  duration: number
  /** Weekly closing day, e.g. "Monday"; null means open every day */
  closedOn: string | null
  barrierFree: boolean
  rating: number
}

export interface TravelEnv {
  cities(): Promise<string[]>
  /** Every departure from `from` to `to` on a given day (sorted by departure time); date looks like "2026-11-06" */
  searchTransport(from: string, to: string, date: string): Promise<Transport[]>
  /** Sorted by rating, highest first */
  searchHotels(city: string): Promise<Hotel[]>
  searchRestaurants(city: string, cuisine?: string): Promise<Restaurant[]>
  searchAttractions(city: string): Promise<Attraction[]>
}

// —————————————— Return value: the travel plan ——————————————

const Id = z.string().min(1)

export const DayPlanSchema = z.object({
  /** YYYY-MM-DD, consecutive from the start date */
  date: z.string(),
  /** The city where the day is spent; the last day is the last destination (the trip home is listed on that day too) */
  city: z.string(),
  /** Transport ids taken that day (empty on days without long-distance travel) */
  transport: z.array(Id).default([]),
  /** Attraction ids visited that day */
  attractions: z.array(Id).default([]),
  /** Breakfast 08:00 (optional), lunch 12:00, dinner 18:30, 1 hour each */
  meals: z
    .object({
      breakfast: Id.nullable().optional(),
      lunch: Id.nullable().optional(),
      dinner: Id.nullable().optional(),
    })
    .default({}),
  /** Hotel id for that night; null on the last day */
  hotel: Id.nullable().optional(),
})

export const TravelPlanSchema = z.object({
  /** false when the request can't be met; explain why in reason (days may be empty) */
  feasible: z.boolean(),
  reason: z.string().optional(),
  days: z.array(DayPlanSchema).default([]),
  /** Your own estimate of the total cost (for reference only; the grader recomputes it from catalog prices) */
  estimatedCost: z.number().optional(),
})

export type DayPlan = z.infer<typeof DayPlanSchema>
export type TravelPlan = z.infer<typeof TravelPlanSchema>

// —————————————— Suggested: the structured request ——————————————

export const TripRequestSchema = z.object({
  origin: z.string(),
  /** Destinations in visiting order, and how many days at each (the days add up to the trip length) */
  stops: z.array(z.object({ city: z.string(), days: z.number().int().min(1) })).min(1),
  /** YYYY-MM-DD */
  startDate: z.string(),
  people: z.number().int().min(1),
  /** Total budget (¥), null if not given */
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
