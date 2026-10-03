import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import briefEn from './brief.en.md?raw'
import brief from './brief.md?raw'
import { createAnalysisEnv, type AnalysisTaskEnv } from './env/index'
import guideEn from './guide.en.md?raw'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type AnalysisAnswer } from './tasks'

const DIR = 'projects/analysis/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<AnalysisTaskEnv, AnalysisAnswer> = {
  id: 'p08',
  number: 8,
  tier: 3,
  title: L('数据分析 Agent', 'Data Analysis Agent'),
  tagline: L('先探查、再清洗、用代码算——答案要能复现', 'Profile, clean, compute with code — answers must be reproducible'),
  client: L('鲜到家（社区生鲜连锁）运营分析组', 'FreshDash (neighborhood grocery chain), Ops Analytics'),
  prototype: { name: 'Code Interpreter / InfiAgent-DABench', url: 'https://github.com/InfiAgent/InfiAgent' },
  concepts: L(
    ['代码执行工具', '数据质量探查', '数据清洗', '错误反馈修复', '可复现的答案'],
    ['Code execution tool', 'Data profiling', 'Data cleaning', 'Fixing from error feedback', 'Reproducible answers'],
  ),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}agent.ts`,
  contract: L(
    `export async function analyze(question: string, env: AnalysisEnv): Promise<{ answer: number | string; code: string; explanation: string }>

interface AnalysisEnv {
  listDatasets(): Promise<{ name: string; rows: number; description: string }[]>
  preview(name: string, n?: number): Promise<string>   // CSV 原文前 n 行（含表头）
  runCode(code: string): Promise<string>               // 沙箱：import { load } from 'data'；返回 console 输出 / 错误
}`,
    `export async function analyze(question: string, env: AnalysisEnv): Promise<{ answer: number | string; code: string; explanation: string }>

interface AnalysisEnv {
  listDatasets(): Promise<{ name: string; rows: number; description: string }[]>
  preview(name: string, n?: number): Promise<string>   // first n lines of the raw CSV (header included)
  runCode(code: string): Promise<string>               // sandbox: import { load } from 'data'; returns console output / errors
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
  createEnv: (_task, ctx) => createAnalysisEnv(ctx),
  invoke: (mod, task, env) => mod.analyze(task.input, env.api),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(56_000, 48_000),
  maxCallsPerTask: 20,
}
