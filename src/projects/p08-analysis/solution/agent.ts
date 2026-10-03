import { log } from 'agent-quest'
import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

export interface DatasetSummary {
  name: string
  rows: number
  description: string
}

/** 环境提供的原始 API（沙箱里用 `import { load } from 'data'` 读数据，值都是原始字符串） */
export interface AnalysisEnv {
  listDatasets(): Promise<DatasetSummary[]>
  preview(name: string, n?: number): Promise<string>
  runCode(code: string): Promise<string>
}

export interface AnalysisAnswer {
  answer: number | string
  code: string
  explanation: string
}

const SYSTEM = (catalog: string) => `你是鲜到家运营分析组的数据分析 Agent。所有数字都必须用 run_code 执行代码算出来，不能估计，也不能心算。

<数据集>
${catalog}
</数据集>

<沙箱>
run_code 运行一段 TypeScript（同步执行，不支持顶层 await）。用 import { load } from 'data' 读取数据：load(name) 返回按表头解析的行数组，所有值都是原始字符串（空值是 ''），类型转换和清洗由你的代码负责。用 console.log 打印结果，只打印汇总，不要打印整张表。
</沙箱>

<清洗规则>
- 重复记录只算一次：sales 按整行去重，events 按 event_id，nps 按 resp_id。
- 缺失 / 无效值（空值、N/A、超出范围的评分）不参与计算，不能当成 0。
- 地区、平台、城市的不同写法（大小写、英文、带“区 / 市”）合并成标准写法。
- 数字可能带千分位逗号，先去掉再转换。
</清洗规则>

工作流程：
1. 用 preview_dataset 看表头和前几行。
2. 数据质量检查：用代码统计每列的空值、完全重复的行、类别列的全部取值、数字格式。前几行干净不代表整张表干净。
3. 按清洗规则写分析代码；代码报错就读错误信息，修正后重新运行。
4. 最终答案必须由一段完整、可独立运行的代码打印出来：最后一行 console.log('ANSWER:', 值)，按题目要求的精度四舍五入。
5. 最后回复：第一行“答案：<值>”，后面一两句话说明计算方法。`

function analysisTools(env: AnalysisEnv, runs: { code: string; output: string }[]): Tool[] {
  return [
    {
      spec: {
        name: 'preview_dataset',
        description: '查看数据集 CSV 原文的前 n 行（含表头），用来了解列名和格式。注意：前几行不能代表整张表的数据质量。',
        input_schema: {
          type: 'object',
          properties: { name: { type: 'string', description: '数据集名，例如 "sales"' }, n: { type: 'number', description: '行数，默认 5，最多 50' } },
          required: ['name'],
        },
      },
      run: ({ name, n }) => env.preview(String(name), typeof n === 'number' ? n : 5),
    },
    {
      spec: {
        name: 'run_code',
        description: "在沙箱里运行一段 TypeScript 代码（import { load } from 'data'），返回 console.log 的输出；出错时返回错误信息。",
        input_schema: { type: 'object', properties: { code: { type: 'string', description: '完整的 TypeScript 代码' } }, required: ['code'] },
      },
      run: async ({ code }) => {
        const output = await env.runCode(String(code))
        runs.push({ code: String(code), output })
        return output
      },
    },
  ]
}

/** 把答案文字转成题目要求的类型：能解析成数字的就返回数字 */
function parseAnswer(text: string): number | string {
  const t = text.trim().replace(/^["'“]|["'”]$/g, '')
  const n = t.replace(/[,，%\s]/g, '')
  return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : t
}

const catalogs = new WeakMap<AnalysisEnv, Promise<string>>()
function catalogOf(env: AnalysisEnv): Promise<string> {
  let hit = catalogs.get(env)
  if (!hit) {
    hit = env.listDatasets().then((sets) => sets.map((s) => `- ${s.name}（${s.rows} 行）：${s.description}`).join('\n'))
    catalogs.set(env, hit)
  }
  return hit
}

export async function analyze(question: string, env: AnalysisEnv): Promise<AnalysisAnswer> {
  const runs: { code: string; output: string }[] = []
  const res = await runAgent(question, analysisTools(env, runs), { system: SYSTEM(await catalogOf(env)), maxSteps: 10 })
  // 答案以代码的输出为准：取最后一次成功打印 ANSWER 的运行
  const answered = runs.filter((r) => /ANSWER:/.test(r.output) && !/(^|\n)\s*错误：/.test(r.output))
  const last = answered[answered.length - 1]
  const fromOutput = last ? [...last.output.matchAll(/ANSWER:\s*(.+)/g)].pop()?.[1] : undefined
  const fromText = /答案[:：]\s*(.+)/.exec(res.output)?.[1]
  const answer = parseAnswer(fromOutput ?? fromText ?? res.output)
  log(`数据分析：${res.stopReason}，${res.steps} 步，运行代码 ${runs.length} 次，答案 ${answer}`)
  return { answer, code: last?.code ?? runs[runs.length - 1]?.code ?? '', explanation: res.output.replace(/^.*答案[:：].*\n?/m, '').trim() }
}
