import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import briefEn from './brief.en.md?raw'
import brief from './brief.md?raw'
import { createMailEnv, type MailEnv } from './env/index'
import guideEn from './guide.en.md?raw'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type MailTaskSpec } from './tasks'

const DIR = 'projects/email/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<MailEnv, void> = {
  id: 'p02',
  number: 2,
  tier: 1,
  title: L('邮件分拣助手', 'Email Triage Assistant'),
  tagline: L('该忽略的忽略、该提醒的提醒、该回的写好草稿——钓鱼邮件一个字都别回', "Skip what's skippable, flag what matters, draft what needs a reply, and never answer phishing"),
  client: L('星图数据（B2B 数据分析 SaaS）', 'Xingtu Data (B2B analytics SaaS)'),
  prototype: { name: 'Ambient Email Agent（agents-from-scratch）', url: 'https://github.com/langchain-ai/agents-from-scratch' },
  concepts: L(
    ['路由 / 分类', '结构化输出', '快模型降本', '上下文补全', '工具调用', '数据保密'],
    ['Routing / classification', 'Structured output', 'Fast models for cost', 'Context enrichment', 'Tool use', 'Data confidentiality'],
  ),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
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
  createEnv: (task, ctx) => {
    const spec = task.input as MailTaskSpec
    return createMailEnv(spec.email, spec.thread ?? [], ctx)
  },
  invoke: (mod, task, env) => mod.triage(structuredClone((task.input as MailTaskSpec).email), env),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(28_000, 24_300),
  maxCallsPerTask: 20,
}
