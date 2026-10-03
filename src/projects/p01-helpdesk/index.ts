import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { HELP_DOCS } from './docs'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type HelpAnswer } from './tasks'

const DIR = 'projects/helpdesk/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<{ docs: typeof HELP_DOCS }, HelpAnswer> = {
  id: 'p01',
  number: 1,
  tier: 1,
  title: '帮助中心问答',
  tagline: '只说文档里有的，每句话都有出处',
  client: '极光网盘（云存储 SaaS）',
  prototype: { name: 'Chat with Docs / RAG', url: 'https://www.anthropic.com/news/contextual-retrieval' },
  concepts: ['RAG', '引用校验', '新旧文档冲突', '拒答', '成本'],
  brief,
  guide,
  entry: `${DIR}main.ts`,
  contract: 'export async function answer(question: string, docs: HelpDoc[]): Promise<{ answer: string; citations: string[]; refused: boolean }>',
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: () => ({ docs: HELP_DOCS }),
  invoke: (mod, task, env) => mod.answer(task.input, env.docs),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: 4100,
}
