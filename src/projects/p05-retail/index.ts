import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import briefEn from './brief.en.md?raw'
import { createRetailEnv, type RetailEnv } from './env/index'
import guide from './guide.md?raw'
import guideEn from './guide.en.md?raw'
import { mock } from './mock'
import { toTasks, userSpecOf, type RetailTaskSpec } from './tasks'

const DIR = 'projects/retail/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<RetailEnv, void> = {
  id: 'p05',
  number: 5,
  tier: 2,
  title: L('零售客服', 'Retail Support'),
  tagline: L('先验身份、再列详情、等客户说“是”——每一步都按政策来', 'Verify identity, list the details, wait for a "yes": every step by the policy'),
  client: L('优品商城（综合电商）', 'Youpin Mall (general e-commerce)'),
  prototype: { name: 'τ-bench (retail)', url: 'https://github.com/sierra-research/tau-bench' },
  concepts: L(
    ['多轮对话', '模拟用户', '政策遵循', '写操作确认', '基于状态的评测', 'pass^k'],
    ['Multi-turn dialog', 'Simulated user', 'Policy compliance', 'Confirming writes', 'State-based evaluation', 'pass^k'],
  ),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}agent.ts`,
  contract: L(
    `interface RetailEnv {
  user: { opening: string; respond(agentMessage: string): Promise<string>; readonly done: boolean }
  tools: Tool[]   // 环境提供的现成工具（../../tools 的 Tool 接口）
  policy: string  // 客服政策（Markdown）
}
export async function serve(env: RetailEnv): Promise<void>`,
    `interface RetailEnv {
  user: { opening: string; respond(agentMessage: string): Promise<string>; readonly done: boolean }
  tools: Tool[]   // ready-made tools from the environment (the Tool interface in ../../tools)
  policy: string  // support policy (Markdown)
}
export async function serve(env: RetailEnv): Promise<void>`,
  ),
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
  createEnv: (task, ctx) => createRetailEnv(userSpecOf(task.input as RetailTaskSpec), ctx),
  invoke: (mod, _task, env) => mod.serve(env),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(300_000, 262_000),
  maxCallsPerTask: 60,
}
