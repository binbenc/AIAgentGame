import { chat, log, type Message } from 'agent-quest'
import { parseJsonLoose } from '../../structured'
import { textOf } from '../../tools'
import { TravelPlanSchema, TripRequestSchema, type TravelEnv, type TravelPlan, type TripRequest } from './types'
import { gather, infeasibility, prefilter, render, verify } from './verify'

const PARSE_SYSTEM = `You are a request analyst at Faraway Travel. Extract the customer's travel request into TripRequest JSON. Output only the JSON, nothing else.
The year is 2026. Fields:
- origin: departure city (the trip also returns here)
- stops: destinations in visiting order [{"city": "Chengdu", "days": 3}]; the days add up to the total trip length (the departure day and the return day both count)
- startDate: departure date, YYYY-MM-DD
- people: total number of travelers
- budget: total budget (¥), null if not given
- preferences: {"cuisines": cuisines they want[], "noFlight": no flying, "pets": bringing a pet, "accessible": needs wheelchair access, "maxAttractionsPerDay": max attractions per day or null, "roomType": required room type or null}`

const PLAN_SYSTEM = `You are a trip planner at Faraway Travel. Build an itinerary from <constraints> and <options>. Output a single JSON object (TravelPlan) and nothing else.
Rules:
1. Only use ids that appear in <options>; never make one up.
2. Output days one by one following <schedule>: date, city (where the day is spent; the last day is the last destination), transport (transport ids taken that day), attractions, meals (lunch 12:00, dinner 18:30, breakfast optional), hotel (null on the last day).
3. Every item in <constraints> is a hard requirement.
4. When you get validation feedback, fix every item and output the complete revised JSON.
Format: {"feasible": true, "days": [{"date": "YYYY-MM-DD", "city": "...", "transport": [], "attractions": [], "meals": {"lunch": "...", "dinner": "..."}, "hotel": "..."}]}`

const MAX_REPAIRS = 3

async function ask(system: string, messages: Message[], maxTokens: number): Promise<string> {
  const res = await chat({ system, messages, max_tokens: maxTokens })
  return textOf(res.content)
}

/** Step 1: natural language → structured constraints (validated, retried with the error) */
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
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: `Wrong format: ${lastError}. Output only the TripRequest JSON.` })
  }
  throw new Error(`Could not parse the request: ${lastError}`)
}

export async function plan(request: string, env: TravelEnv): Promise<TravelPlan> {
  // 1. Parse the request: retrieval, filtering and validation all build on these structured constraints
  const req = await parseRequest(request)
  log(`request: ${JSON.stringify(req)}`)

  // 2. Fetch the data (code, no model needed) + filter by hard preferences
  const catalog = prefilter(await gather(req, env), req)

  // 3. Feasibility lower bound: for requests that clearly can't be met, explain why without spending model calls
  const why = infeasibility(catalog, req)
  if (why) {
    log(`infeasible: ${why}`)
    return { feasible: false, reason: why, days: [] }
  }

  // 4. Plan → validate → revise (evaluator-optimizer, with deterministic code as the evaluator)
  const messages: Message[] = [
    {
      role: 'user',
      content: `<request>${request}</request>\n\n<constraints>\n${JSON.stringify(req)}\n</constraints>\n\n<options>\n${render(catalog, req)}\n</options>`,
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
      problems = [`the output is not valid TravelPlan JSON: ${(e as Error).message}`]
    }
    log(`draft ${round + 1}: ${problems.length ? problems.length + ' problem(s)' : 'passed'}`)
    if (draft && (!best || problems.length < best.problems.length)) best = { plan: draft, problems }
    if (!problems.length) return draft!
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: `Validation found these problems. Fix every one and output the complete JSON:\n${problems.map((p) => `- ${p}`).join('\n')}` })
  }
  // Out of revisions and still not clean: return the draft with the fewest problems (and log them for debugging)
  log(`still has problems: ${best?.problems.join('; ')}`)
  return best?.plan ?? { feasible: false, reason: 'Planning failed: the model did not produce a valid plan', days: [] }
}
