import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import briefEn from './brief.en.md?raw'
import brief from './brief.md?raw'
import { HELP_DOCS } from './docs'
import guideEn from './guide.en.md?raw'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type HelpAnswer } from './tasks'

const DIR = 'projects/helpdesk/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<{ docs: typeof HELP_DOCS }, HelpAnswer> = {
  id: 'p01',
  number: 1,
  tier: 1,
  title: L('帮助中心问答', 'Help Center Q&A'),
  tagline: L('只说文档里有的，每句话都有出处', 'Say only what the docs say, and cite every claim'),
  client: L('极光网盘（云存储 SaaS）', 'Aurora Drive (cloud storage SaaS)'),
  prototype: { name: 'Chat with Docs / RAG', url: 'https://www.anthropic.com/news/contextual-retrieval' },
  concepts: L(['RAG', '引用校验', '新旧文档冲突', '拒答', '成本'], ['RAG', 'Citation validation', 'Outdated docs', 'Refusal', 'Cost']),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}main.ts`,
  contract: 'export async function answer(question: string, docs: HelpDoc[]): Promise<{ answer: string; citations: string[]; refused: boolean }>',
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
  createEnv: () => ({ docs: HELP_DOCS }),
  invoke: (mod, task, env) => mod.answer(task.input, env.docs),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(4100, 3400),
}
