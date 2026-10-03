import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { createWebEnv, type WebEnv } from './env/index'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, WEB_TASKS, type WebOutput } from './tasks'

const DIR = 'projects/web/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<WebEnv, WebOutput> = {
  id: 'p10',
  number: 10,
  tier: 4,
  title: '网页操作 Agent',
  tagline: '看无障碍树、点按钮、填表单——网站的最终状态说了算',
  client: '拾光优选（综合电商平台）',
  prototype: { name: 'WebArena', url: 'https://webarena.dev/' },
  concepts: ['无障碍树观察', '观察-动作循环', '过期元素编号', '分页与弹窗', '网页提示注入', '上下文裁剪', '基于状态的评测'],
  brief,
  guide,
  entry: `${DIR}browse.ts`,
  contract: `export async function browse(goal: string, browser: BrowserEnv): Promise<{ answer?: string }>

interface BrowserEnv {
  observe(): Promise<string>                       // 当前页面的无障碍树
  click(id: number): Promise<string>                // 返回一句操作结果（不含新页面）
  type(id: number, text: string, pressEnter?: boolean): Promise<string>
  select(id: number, option: string): Promise<string>
  goto(url: string): Promise<string>                // 本站地址，例如 "/cart"
  back(): Promise<string>
  scroll(direction: 'up' | 'down'): Promise<string>
}`,
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: (task, ctx) => createWebEnv(WEB_TASKS.find((t) => t.id === task.id)!.app ?? {}, ctx),
  invoke: (mod, task, env) => mod.browse(task.input, env.browser),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: 126_000,
  maxCallsPerTask: 40,
}
