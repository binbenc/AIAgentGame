import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import briefEn from './brief.en.md?raw'
import { createWebEnv, type WebEnv } from './env/index'
import guide from './guide.md?raw'
import guideEn from './guide.en.md?raw'
import { mock } from './mock'
import { toTasks, WEB_TASKS, type WebOutput } from './tasks'

const DIR = 'projects/web/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<WebEnv, WebOutput> = {
  id: 'p10',
  number: 10,
  tier: 4,
  title: L('网页操作 Agent', 'Web Agent'),
  tagline: L('看无障碍树、点按钮、填表单——网站的最终状态说了算', 'Read the accessibility tree, click buttons, fill in forms. The final state of the site is what counts'),
  client: L('拾光优选（综合电商平台）', 'Glimmer Mart (online marketplace)'),
  prototype: { name: 'WebArena', url: 'https://webarena.dev/' },
  concepts: L(
    ['无障碍树观察', '观察-动作循环', '过期元素编号', '分页与弹窗', '网页提示注入', '上下文裁剪', '基于状态的评测'],
    ['Accessibility-tree observations', 'Observe-act loop', 'Stale element ids', 'Pagination and popups', 'Prompt injection in web pages', 'Context trimming', 'State-based evaluation'],
  ),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}browse.ts`,
  contract: L(
    `export async function browse(goal: string, browser: BrowserEnv): Promise<{ answer?: string }>

interface BrowserEnv {
  observe(): Promise<string>                       // 当前页面的无障碍树
  click(id: number): Promise<string>                // 返回一句操作结果（不含新页面）
  type(id: number, text: string, pressEnter?: boolean): Promise<string>
  select(id: number, option: string): Promise<string>
  goto(url: string): Promise<string>                // 本站地址，例如 "/cart"
  back(): Promise<string>
  scroll(direction: 'up' | 'down'): Promise<string>
}`,
    `export async function browse(goal: string, browser: BrowserEnv): Promise<{ answer?: string }>

interface BrowserEnv {
  observe(): Promise<string>                       // accessibility tree of the current page
  click(id: number): Promise<string>                // returns a one-line result (not the new page)
  type(id: number, text: string, pressEnter?: boolean): Promise<string>
  select(id: number, option: string): Promise<string>
  goto(url: string): Promise<string>                // a path on this site, e.g. "/cart"
  back(): Promise<string>
  scroll(direction: 'up' | 'down'): Promise<string>
}`,
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
  createEnv: (task, ctx) => createWebEnv(WEB_TASKS.find((t) => t.id === task.id)!.app ?? {}, ctx),
  invoke: (mod, task, env) => mod.browse(task.input, env.browser),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(126_000, 107_000),
  maxCallsPerTask: 40,
}
