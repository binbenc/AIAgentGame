import { chat, textOf } from 'agent-quest'
// 提示：前面关卡写好的 Agent 循环和工具接口可以直接复用
// import { runAgent } from '../../agent'
// import type { Tool } from '../../tools'

export interface DatasetSummary {
  name: string
  /** 数据行数（不含表头） */
  rows: number
  description: string
}

/**
 * 环境提供的原始 API。怎么包装成给模型用的工具，由你决定。
 *
 * runCode 的沙箱里可以 `import { load, raw, datasets } from 'data'`：
 * - load(name) 按表头把 CSV 解析成行数组，所有值都是**原始字符串**（空值是 ''，清洗由你的代码负责）；
 * - raw(name) 返回 CSV 原文；datasets() 返回全部数据集名。
 * 代码同步执行（不支持顶层 await），用 console.log 打印结果；出错时错误信息会附在输出后面返回。
 */
export interface AnalysisEnv {
  /** 可用的数据集：名字、行数、说明 */
  listDatasets(): Promise<DatasetSummary[]>
  /** CSV 原文的前 n 行（含表头），n 默认 5、最多 50 */
  preview(name: string, n?: number): Promise<string>
  /** 在沙箱里运行一段 TS / JS 代码，返回 console 输出（出错时附上错误信息，不会抛错） */
  runCode(code: string): Promise<string>
}

export interface AnalysisAnswer {
  /** 最终答案：数值题返回 number（按题目要求的精度），分类题返回 string */
  answer: number | string
  /** 算出这个答案的完整代码（必须是通过 runCode 执行过的） */
  code: string
  /** 计算方法的简要说明 */
  explanation: string
}

/**
 * 数据分析 Agent 的入口：回答运营同事的分析问题。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function analyze(question: string, env: AnalysisEnv): Promise<AnalysisAnswer> {
  // 最朴素的版本：把每个数据集的前几行给模型看，让它直接说答案。
  // 模型只看到 5 行数据，算不了上千行的统计——试试看它能拿几分。
  const sets = await env.listDatasets()
  const previews = await Promise.all(sets.map(async (s) => `## ${s.name}（${s.rows} 行）：${s.description}\n${await env.preview(s.name, 5)}`))
  const res = await chat({
    max_tokens: 800,
    messages: [{ role: 'user', content: `数据预览：\n\n${previews.join('\n\n')}\n\n问题：${question}\n请直接给出答案。` }],
  })
  const text = textOf(res.content)
  const num = /-?\d+(?:\.\d+)?/.exec(text.replace(/,/g, ''))
  return { answer: num ? Number(num[0]) : text.trim(), code: '', explanation: text }
}
