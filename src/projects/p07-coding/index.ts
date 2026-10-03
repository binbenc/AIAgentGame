import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { createRepoEnv, type CodingEnv } from './env'
import guide from './guide.md?raw'
import { mock } from './mock'
import { CODING_TASKS, initialFiles, toTasks } from './tasks'

const DIR = 'projects/coding/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<CodingEnv, unknown> = {
  id: 'p07',
  number: 7,
  tier: 3,
  title: '编码 Agent',
  tagline: '读 issue、找 bug、改代码、跑测试——隐藏测试说了算',
  client: '开源组织 TinyLibs',
  prototype: { name: 'SWE-bench / mini-swe-agent', url: 'https://github.com/swe-agent/mini-swe-agent' },
  concepts: ['Agent-计算机接口（ACI）', 'str_replace 编辑', '测试驱动验证', 'FAIL_TO_PASS / PASS_TO_PASS', '沙箱执行'],
  brief,
  guide,
  entry: `${DIR}agent.ts`,
  contract: `export async function solve(issue: string, repo: RepoApi): Promise<void>

interface RepoApi {
  listFiles(): Promise<string[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  search(pattern: string): Promise<string>   // "path:行号: 内容"，每行一个匹配
  runTests(filter?: string): Promise<string> // 跑仓库里的 *.test.ts，返回文本报告
}`,
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: (task, ctx) => createRepoEnv(task.input, initialFiles(CODING_TASKS.find((d) => d.id === task.id)!), ctx),
  invoke: (mod, task, env) => mod.solve(task.input, env.repo),
  tasks: toTasks(),
  mock,
  passThreshold: 0.8,
  tokenBudget: 60000,
  maxCallsPerTask: 30,
}
