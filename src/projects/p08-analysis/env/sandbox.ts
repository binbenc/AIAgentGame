/**
 * P8 的代码沙箱：在一个全新的模块系统（createModuleSystem）里运行一段 TS / JS 代码。
 *
 * - 内置模块 'data'：`load(name)` 按表头把 CSV 解析成行数组，**所有值都是原始字符串**（空值是 ''，
 *   千分位逗号、写法不一致都原样保留——清洗是分析代码的责任）；`raw(name)` 返回 CSV 原文；`datasets()` 返回数据集名。
 * - console.log / info / warn / error / table 的输出被收集起来作为运行结果返回（超长截断）。
 * - 编译错误和运行时异常不会抛出，而是作为文字（“错误：……”）附在输出后面返回，方便交还给模型修正。
 * - 代码同步执行，不支持顶层 await（也不需要：数据已经在内存里）。
 * - 同步死循环没法从内部打断：会卡住整个运行，直到外层（浏览器 Worker）超时。
 *   这正是生产环境要把模型写的代码放进独立进程 / 容器、并设置 CPU 和时间上限的原因。
 */
import { L } from '../../../engine/locale'
import { createModuleSystem } from '../../../engine/sandbox/loader'

export const MAX_OUTPUT = 4000

/** 解析 CSV（支持引号、转义引号 ""、引号内的逗号和换行），返回行数组（第一行是表头） */
export function parseCsvLines(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

/** 按表头解析成对象数组，值一律是字符串 */
export function parseCsv(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsvLines(text)
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

function show(v: unknown, depth = 0): string {
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' || v === undefined || v === null) return String(v)
  if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`
  if (v instanceof Error) return `${v.name}: ${v.message}`
  if (v instanceof Map) return `Map(${v.size}) {${[...v].map(([k, x]) => `${show(k, 1)} => ${show(x, depth + 1)}`).join(', ')}}`
  if (v instanceof Set) return `Set(${v.size}) {${[...v].map((x) => show(x, depth + 1)).join(', ')}}`
  if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]'
  if (Array.isArray(v)) return `[${v.map((x) => show(x, depth + 1)).join(', ')}]`
  return `{${Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k}: ${show(x, depth + 1)}`)
    .join(', ')}}`
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  return String(e)
}

/** 运行一段代码，返回它打印的内容；出错时把错误信息附在后面 */
export function runInSandbox(code: string, data: Record<string, string>): string {
  const lines: string[] = []
  let size = 0
  let cut = false
  const print = (...args: unknown[]) => {
    const text = args.map((a) => show(a)).join(' ')
    size += text.length + 1
    if (size > MAX_OUTPUT * 2) cut = true
    else lines.push(text)
  }
  const consoleShim = { log: print, info: print, warn: print, error: print, debug: print, table: (x: unknown) => print(x), dir: (x: unknown) => print(x) }
  const dataModule = {
    datasets: () => Object.keys(data),
    raw: (name: string) => {
      if (!(name in data))
        throw new Error(L(`数据集不存在：${name}。可用的数据集：${Object.keys(data).join(', ')}`, `No such dataset: ${name}. Available datasets: ${Object.keys(data).join(', ')}`))
      return data[name]
    },
    load: (name: string) => parseCsv(dataModule.raw(name)),
  }
  try {
    // 用同一行的前缀遮蔽全局 console，不改变用户代码的行号
    const modules = createModuleSystem({ 'analysis.ts': `const console = require('@console'); ${code}` }, { data: dataModule, '@console': consoleShim })
    modules.require('analysis.ts')
  } catch (e) {
    lines.push(`${L('错误：', 'Error: ')}${errorText(e)}`)
  }
  let out = lines.join('\n')
  if (out.length > MAX_OUTPUT || cut)
    out = `${out.slice(0, MAX_OUTPUT)}\n${L('……（输出过长，已截断。只打印需要的汇总结果，不要打印整张表）', '... (output too long, truncated. Print only the summary you need, not whole tables)')}`
  return out || L('（代码运行完毕，没有任何输出。用 console.log 打印结果）', '(The code ran but printed nothing. Use console.log to print the result)')
}
