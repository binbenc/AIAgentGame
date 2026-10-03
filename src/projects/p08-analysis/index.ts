import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { createAnalysisEnv, type AnalysisTaskEnv } from './env/index'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type AnalysisAnswer } from './tasks'

const DIR = 'projects/analysis/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<AnalysisTaskEnv, AnalysisAnswer> = {
  id: 'p08',
  number: 8,
  tier: 3,
  title: '数据分析 Agent',
  tagline: '先探查、再清洗、用代码算——答案要能复现',
  client: '鲜到家（社区生鲜连锁）运营分析组',
  prototype: { name: 'Code Interpreter / InfiAgent-DABench', url: 'https://github.com/InfiAgent/InfiAgent' },
  concepts: ['代码执行工具', '数据质量探查', '数据清洗', '错误反馈修复', '可复现的答案'],
  brief,
  guide,
  entry: `${DIR}agent.ts`,
  contract: `export async function analyze(question: string, env: AnalysisEnv): Promise<{ answer: number | string; code: string; explanation: string }>

interface AnalysisEnv {
  listDatasets(): Promise<{ name: string; rows: number; description: string }[]>
  preview(name: string, n?: number): Promise<string>   // CSV 原文前 n 行（含表头）
  runCode(code: string): Promise<string>               // 沙箱：import { load } from 'data'；返回 console 输出 / 错误
}`,
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: (_task, ctx) => createAnalysisEnv(ctx),
  invoke: (mod, task, env) => mod.analyze(task.input, env.api),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: 56_000,
  maxCallsPerTask: 20,
}
