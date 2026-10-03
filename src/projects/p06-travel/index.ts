import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import briefEn from './brief.en.md?raw'
import { createTravelEnv, type TravelEnv } from './env/index'
import guide from './guide.md?raw'
import guideEn from './guide.en.md?raw'
import type { TravelPlan } from './judge'
import { mock } from './mock'
import { toTasks } from './tasks'

const DIR = 'projects/travel/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<TravelEnv, TravelPlan> = {
  id: 'p06',
  number: 6,
  tier: 3,
  title: L('旅行规划', 'Trip Planner'),
  tagline: L('预算、闭馆日、营业时间、宠物规则——每一条约束都要算得清、查得到', 'Budgets, closing days, opening hours, pet rules: every constraint has to add up and check out'),
  client: L('远方旅行社（定制游）', 'Faraway Travel (custom trips)'),
  prototype: { name: 'TravelPlanner', url: 'https://osu-nlp-group.github.io/TravelPlanner/' },
  concepts: L(
    ['约束满足', '结构化需求解析', '规划 → 校验 → 修改', '确定性校验器', '缩小动作空间', '不可行判断'],
    ['Constraint satisfaction', 'Structured request parsing', 'Plan → verify → revise', 'Deterministic verifier', 'Shrinking the action space', 'Detecting infeasibility'],
  ),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}main.ts`,
  contract: `export async function plan(request: string, env: TravelEnv): Promise<TravelPlan>

interface TravelEnv {
  cities(): Promise<string[]>
  searchTransport(from: string, to: string, date: string): Promise<Transport[]>
  searchHotels(city: string): Promise<Hotel[]>
  searchRestaurants(city: string, cuisine?: string): Promise<Restaurant[]>
  searchAttractions(city: string): Promise<Attraction[]>
}
${L('// TravelPlan / Transport / Hotel / ... 的完整定义见 projects/travel/types.ts（TravelPlanSchema）', '// Full definitions of TravelPlan / Transport / Hotel / ... are in projects/travel/types.ts (TravelPlanSchema)')}`,
  starter: prefix(
    localizedFiles(
      rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/'),
      rawFiles(import.meta.glob('./starter.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter.en/'),
    ),
  ),
  solution: prefix(
    localizedFiles(
      rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
      rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
    ),
  ),
  createEnv: (_task, ctx) => createTravelEnv(ctx),
  invoke: (mod, task, env) => mod.plan(task.input, env),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(32_500, 29_250),
  maxCallsPerTask: 30,
}
