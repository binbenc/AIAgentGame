import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { createMailEnv, type MailEnv } from './env/index'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type MailTaskSpec } from './tasks'

const DIR = 'projects/email/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<MailEnv, void> = {
  id: 'p02',
  number: 2,
  tier: 1,
  title: '邮件分拣助手',
  tagline: '该忽略的忽略、该提醒的提醒、该回的写好草稿——钓鱼邮件一个字都别回',
  client: '星图数据（B2B 数据分析 SaaS）',
  prototype: { name: 'Ambient Email Agent（agents-from-scratch）', url: 'https://github.com/langchain-ai/agents-from-scratch' },
  concepts: ['路由 / 分类', '结构化输出', '快模型降本', '上下文补全', '工具调用', '数据保密'],
  brief,
  guide,
  entry: `${DIR}main.ts`,
  contract: `export async function triage(email: Email, env: MailEnv): Promise<void>

interface MailEnv {
  me; rules: string; now(): string
  inbox: { thread(threadId); search(query) }
  crm: { findContact(email); search(query) }
  calendar: { listEvents(date); freeSlots(date, minutes?) }
  label(emailId, 'ignore' | 'notify' | 'respond'); createDraft(emailId, body)
  forward(emailId, to, note?); scheduleMeeting({ title, start, end, attendees })
}`,
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: (task, ctx) => {
    const spec = task.input as MailTaskSpec
    return createMailEnv(spec.email, spec.thread ?? [], ctx)
  },
  invoke: (mod, task, env) => mod.triage(structuredClone((task.input as MailTaskSpec).email), env),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: 28_000,
  maxCallsPerTask: 20,
}
