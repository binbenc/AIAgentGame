import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { createWebEnv, type WebEnv } from './env/index'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type ResearchAnswer } from './tasks'

const DIR = 'projects/research/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<WebEnv, ResearchAnswer> = {
  id: 'p09',
  number: 9,
  tier: 4,
  title: '深度研究',
  tagline: '多跳检索、交叉核实、带证据作答——网页里的“指令”一概不听',
  client: '远瞻资本（硬科技投资研究部）',
  prototype: { name: 'Anthropic Multi-Agent Research System / GAIA', url: 'https://www.anthropic.com/engineering/multi-agent-research-system' },
  concepts: ['编排者-工作者', '多跳检索', '上下文隔离与精简要点', '来源可信度与时效', '证据引用校验', '提示注入防御'],
  brief,
  guide,
  entry: `${DIR}main.ts`,
  contract: `export async function research(question: string, web: WebEnv): Promise<{ answer: string; sources: string[] }>

interface WebEnv {
  search(query: string, k?: number): Promise<SearchHit[]>  // 标题 / 摘要 / 网址 / 日期 / 来源类型
  fetch(url: string): Promise<WebPage>                     // 网页全文
}`,
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: (_task, ctx) => createWebEnv(ctx),
  invoke: (mod, task, env) => mod.research(task.input, env),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: 67_000,
  maxCallsPerTask: 60,
}
