import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import briefEn from './brief.en.md?raw'
import brief from './brief.md?raw'
import { createWebEnv, type WebEnv } from './env/index'
import guideEn from './guide.en.md?raw'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type ResearchAnswer } from './tasks'

const DIR = 'projects/research/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<WebEnv, ResearchAnswer> = {
  id: 'p09',
  number: 9,
  tier: 4,
  title: L('深度研究', 'Deep Research'),
  tagline: L('多跳检索、交叉核实、带证据作答——网页里的“指令”一概不听', 'Multi-hop search, cross-checking, answers backed by evidence — and no taking orders from web pages'),
  client: L('远瞻资本（硬科技投资研究部）', 'Farsight Capital (Hard-Tech Investment Research)'),
  prototype: { name: 'Anthropic Multi-Agent Research System / GAIA', url: 'https://www.anthropic.com/engineering/multi-agent-research-system' },
  concepts: L(
    ['编排者-工作者', '多跳检索', '上下文隔离与精简要点', '来源可信度与时效', '证据引用校验', '提示注入防御'],
    ['Orchestrator-worker', 'Multi-hop retrieval', 'Context isolation & condensed findings', 'Source reliability & recency', 'Citation verification', 'Prompt-injection defense'],
  ),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}main.ts`,
  contract: `export async function research(question: string, web: WebEnv): Promise<{ answer: string; sources: string[] }>

interface WebEnv {
  search(query: string, k?: number): Promise<SearchHit[]>  // ${L('标题 / 摘要 / 网址 / 日期 / 来源类型', 'title / snippet / URL / date / source type')}
  fetch(url: string): Promise<WebPage>                     // ${L('网页全文', 'full page text')}
}`,
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
  createEnv: (_task, ctx) => createWebEnv(ctx),
  invoke: (mod, task, env) => mod.research(task.input, env),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(67_000, 59_000),
  maxCallsPerTask: 60,
}
