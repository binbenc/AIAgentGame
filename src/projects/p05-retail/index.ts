import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { createRetailEnv, type RetailEnv } from './env/index'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, userSpecOf, type RetailTaskSpec } from './tasks'

const DIR = 'projects/retail/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<RetailEnv, void> = {
  id: 'p05',
  number: 5,
  tier: 2,
  title: '零售客服',
  tagline: '先验身份、再列详情、等客户说“是”——每一步都按政策来',
  client: '优品商城（综合电商）',
  prototype: { name: 'τ-bench (retail)', url: 'https://github.com/sierra-research/tau-bench' },
  concepts: ['多轮对话', '模拟用户', '政策遵循', '写操作确认', '基于状态的评测', 'pass^k'],
  brief,
  guide,
  entry: `${DIR}agent.ts`,
  contract: `interface RetailEnv {
  user: { opening: string; respond(agentMessage: string): Promise<string>; readonly done: boolean }
  tools: Tool[]   // 环境提供的现成工具（../../tools 的 Tool 接口）
  policy: string  // 客服政策（Markdown）
}
export async function serve(env: RetailEnv): Promise<void>`,
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: (task, ctx) => createRetailEnv(userSpecOf(task.input as RetailTaskSpec), ctx),
  invoke: (mod, _task, env) => mod.serve(env),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: 300_000,
  maxCallsPerTask: 60,
}
