import { chat, textOf } from 'agent-quest'
import { parseJsonLoose } from '../../structured'
import { TravelPlanSchema, type TravelEnv, type TravelPlan } from './types'
// Tip: every module you wrote in earlier levels can be reused, e.g.
// import { runAgent } from '../../agent'              // tool loop
// import { writeWithReview } from '../../refine'      // generate → review → revise

/**
 * Entry point of the trip planner: understand the customer's request and build an itinerary from the catalog's transport / hotels / restaurants / attractions that meets every constraint.
 * When the request can't be met, return { feasible: false, reason }.
 * This is a "project": there's no TODO list and the architecture is up to you. Read the brief first, then look at the task list.
 */
export async function plan(request: string, env: TravelEnv): Promise<TravelPlan> {
  // The most naive version: dump all the data for the cities mentioned in the request on the model and have it write the plan in one go.
  // It runs, but the model can't do the math and can't keep every requirement in mind. See how many points it gets.
  const cities = (await env.cities()).filter((c) => request.includes(c))
  const dates = [...request.matchAll(/(?:November|Nov\.?)\s+(\d{1,2})|\b(\d{1,2})(?:st|nd|rd|th)\b/g)].map((m) => `2026-11-${(m[1] ?? m[2]).padStart(2, '0')}`)
  const data: Record<string, unknown> = {}
  for (const c of cities) {
    data[`hotels in ${c}`] = await env.searchHotels(c)
    data[`restaurants in ${c}`] = await env.searchRestaurants(c)
    data[`attractions in ${c}`] = await env.searchAttractions(c)
    for (const d of cities) if (c !== d) for (const date of new Set(dates)) data[`${date} ${c}→${d}`] = await env.searchTransport(c, d, date)
  }
  const res = await chat({
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `${request}

Available transport, hotels, restaurants and attractions:
${JSON.stringify(data)}

Output the itinerary as JSON: {"feasible": true, "days": [{"date": "YYYY-MM-DD", "city": "city", "transport": ["transport id"], "attractions": ["attraction id"], "meals": {"lunch": "restaurant id", "dinner": "restaurant id"}, "hotel": "hotel id or null"}]}`,
      },
    ],
  })
  return TravelPlanSchema.parse(parseJsonLoose(textOf(res.content)))
}
