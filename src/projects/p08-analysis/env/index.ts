/**
 * P8 的环境：三份 CSV + 一组原始 API（列出数据集、预览、在沙箱里运行代码）。
 * 每次 runCode 都在全新的模块系统里运行；环境记录每一次运行的代码和输出，判定器据此检查“答案是不是代码算出来的”。
 */
import { L } from '../../../engine/locale'
import type { EnvCtx } from '../../types'
import { DATASET_INFO, datasets } from './data'
import { runInSandbox } from './sandbox'

export interface DatasetSummary {
  name: string
  /** 数据行数（不含表头） */
  rows: number
  description: string
}

/** 交给玩家 analyze() 的原始 API */
export interface AnalysisEnv {
  /** 可用的数据集：名字、行数、说明 */
  listDatasets(): Promise<DatasetSummary[]>
  /** CSV 原文的前 n 行（含表头），n 默认 5、最多 50 */
  preview(name: string, n?: number): Promise<string>
  /** 在沙箱里运行一段 TS / JS 代码，返回 console 输出（出错时附上错误信息，不会抛错） */
  runCode(code: string): Promise<string>
}

export interface Run {
  code: string
  output: string
}

export interface AnalysisTaskEnv {
  api: AnalysisEnv
  /** 本次任务里 runCode 执行过的全部代码和输出 */
  runs: Run[]
}

export function createAnalysisEnv(ctx: EnvCtx): AnalysisTaskEnv {
  const data = datasets()
  const env: AnalysisTaskEnv = { runs: [], api: undefined as unknown as AnalysisEnv }
  const check = (name: unknown) => {
    const n = String(name ?? '').trim()
    if (!(n in data))
      throw new Error(
        L(`数据集不存在：${n || '（空）'}。可用的数据集：${Object.keys(data).join(', ')}`, `No such dataset: ${n || '(empty)'}. Available datasets: ${Object.keys(data).join(', ')}`),
      )
    return n
  }
  env.api = {
    listDatasets: ctx.traced('listDatasets', async () => {
      await ctx.delay(10)
      return DATASET_INFO.map((d) => ({ name: d.name, rows: data[d.name].split('\n').length - 1, description: d.description }))
    }),
    preview: ctx.traced('preview', async (name: string, n?: number) => {
      await ctx.delay(20)
      const k = Math.max(1, Math.min(50, Math.floor(Number(n) || 5)))
      return data[check(name)].split('\n').slice(0, k + 1).join('\n')
    }),
    runCode: ctx.traced('runCode', async (code: string) => {
      await ctx.delay(300)
      if (typeof code !== 'string' || !code.trim()) return L('错误：code 必须是非空字符串', 'Error: code must be a non-empty string')
      const output = runInSandbox(code, data)
      env.runs.push({ code, output })
      return output
    }),
  }
  return env
}
