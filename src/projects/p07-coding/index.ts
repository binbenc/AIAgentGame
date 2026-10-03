import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import briefEn from './brief.en.md?raw'
import brief from './brief.md?raw'
import { createRepoEnv, type CodingEnv } from './env'
import guideEn from './guide.en.md?raw'
import guide from './guide.md?raw'
import { mock } from './mock'
import { CODING_TASKS, initialFiles, toTasks } from './tasks'

const DIR = 'projects/coding/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<CodingEnv, unknown> = {
  id: 'p07',
  number: 7,
  tier: 3,
  title: L('编码 Agent', 'Coding Agent'),
  tagline: L('读 issue、找 bug、改代码、跑测试——隐藏测试说了算', 'Read the issue, find the bug, fix the code, run the tests — hidden tests have the final say'),
  client: L('开源组织 TinyLibs', 'TinyLibs (open-source org)'),
  prototype: { name: 'SWE-bench / mini-swe-agent', url: 'https://github.com/swe-agent/mini-swe-agent' },
  concepts: L(
    ['Agent-计算机接口（ACI）', 'str_replace 编辑', '测试驱动验证', 'FAIL_TO_PASS / PASS_TO_PASS', '沙箱执行'],
    ['Agent-computer interface (ACI)', 'str_replace editing', 'Test-driven verification', 'FAIL_TO_PASS / PASS_TO_PASS', 'Sandboxed execution'],
  ),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}agent.ts`,
  contract: L(
    `export async function solve(issue: string, repo: RepoApi): Promise<void>

interface RepoApi {
  listFiles(): Promise<string[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  search(pattern: string): Promise<string>   // "path:行号: 内容"，每行一个匹配
  runTests(filter?: string): Promise<string> // 跑仓库里的 *.test.ts，返回文本报告
}`,
    `export async function solve(issue: string, repo: RepoApi): Promise<void>

interface RepoApi {
  listFiles(): Promise<string[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  search(pattern: string): Promise<string>   // "path:line: content", one match per line
  runTests(filter?: string): Promise<string> // runs the repo's *.test.ts, returns a text report
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
  createEnv: (task, ctx) => createRepoEnv(task.input, initialFiles(CODING_TASKS.find((d) => d.id === task.id)!), ctx),
  invoke: (mod, task, env) => mod.solve(task.input, env.repo),
  tasks: toTasks(),
  mock,
  passThreshold: 0.8,
  tokenBudget: L(60000, 52000),
  maxCallsPerTask: 30,
}
