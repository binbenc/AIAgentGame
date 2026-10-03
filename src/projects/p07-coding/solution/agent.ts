import { log } from 'agent-quest'
import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

/** 环境提供的仓库操作（原始 API） */
export interface RepoApi {
  listFiles(): Promise<string[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  search(pattern: string): Promise<string>
  runTests(filter?: string): Promise<string>
}

const SYSTEM = `你是一名严谨的开源维护者，负责修复 TypeScript 仓库里的 issue。

工作流程：
1. 理解 issue：复现步骤和期望行为最可靠；issue 里对原因的猜测和修复建议不一定对，以 README 和现有测试为准。
2. 定位：用 search_code 搜索相关的函数名 / 关键词，再用 read_file 读完整的相关文件。bug 可能不在 issue 提到的那个文件里。
3. 修改：用 str_replace 做最小的修改；old_str 必须和文件内容逐字一致（包括缩进），并且在文件里唯一。新建文件才用 write_file。
4. 验证：改完必须调用 run_tests。如果有失败，分析失败原因，继续修改源码，直到全部通过。
5. 不要修改任何测试文件（*.test.ts），也不要靠删除功能来让问题“消失”。
6. 完成后用一两句话总结改了什么。`

const isTestFile = (path: string) => /\.test\.ts$/.test(path)

function numbered(text: string): string {
  return text
    .split('\n')
    .map((line, i) => `${i + 1}\t${line}`)
    .join('\n')
}

function count(haystack: string, needle: string): number {
  let n = 0
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) n++
  return n
}

/** Agent-计算机接口（ACI）：少而精的工具，清楚的报错，输出带行号、有上限 */
export function createRepoTools(repo: RepoApi): Tool[] {
  const guardTests = (path: string) => {
    if (isTestFile(path)) throw new Error(`${path} 是测试文件，不允许修改。请修改源码让测试通过。`)
  }
  return [
    {
      spec: {
        name: 'search_code',
        description: '在整个仓库里按正则搜索（类似 grep -rn），返回 "路径:行号: 内容"。用来定位函数定义和调用位置。',
        input_schema: { type: 'object', properties: { pattern: { type: 'string', description: '正则或关键词，例如 "function taxFor"' } }, required: ['pattern'] },
      },
      run: ({ pattern }) => repo.search(String(pattern)),
    },
    {
      spec: {
        name: 'list_files',
        description: '列出仓库里的全部文件路径。',
        input_schema: { type: 'object', properties: {} },
      },
      run: async () => (await repo.listFiles()).join('\n'),
    },
    {
      spec: {
        name: 'read_file',
        description: '读取一个文件的完整内容，每行前面带行号和制表符（行号不是文件内容的一部分）。',
        input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径，例如 "src/date.ts"' } }, required: ['path'] },
      },
      run: async ({ path }) => {
        try {
          return numbered(await repo.readFile(String(path)))
        } catch {
          const all = await repo.listFiles()
          const name = String(path).split('/').pop() ?? ''
          const similar = all.filter((p) => p.includes(name.replace(/\.ts$/, '')))
          throw new Error(`文件不存在：${path}。${similar.length ? `你是不是要找：${similar.join('、')}？` : `可以先用 list_files 看看有哪些文件。`}`)
        }
      },
    },
    {
      spec: {
        name: 'str_replace',
        description: '把文件里的一段原文替换成新内容。old_str 必须与文件内容逐字一致（含缩进、不含行号），并且在文件中只出现一次。',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            old_str: { type: 'string', description: '要替换的原文（包含足够的上下文，保证唯一）' },
            new_str: { type: 'string', description: '替换后的内容' },
          },
          required: ['path', 'old_str', 'new_str'],
        },
      },
      run: async ({ path, old_str, new_str }) => {
        const p = String(path)
        guardTests(p)
        const src = await repo.readFile(p)
        const n = count(src, String(old_str))
        if (n === 0) throw new Error(`old_str 在 ${p} 里没有找到。注意空格和缩进必须完全一致，也不要带行号；先用 read_file 看一下原文。`)
        if (n > 1) throw new Error(`old_str 在 ${p} 里出现了 ${n} 次，请多带几行上下文，让它唯一。`)
        const at = src.indexOf(String(old_str))
        await repo.writeFile(p, src.slice(0, at) + String(new_str) + src.slice(at + String(old_str).length))
        const line = src.slice(0, at).split('\n').length
        return `已修改 ${p}（第 ${line} 行附近）。`
      },
    },
    {
      spec: {
        name: 'write_file',
        description: '新建文件，或用完整内容覆盖一个文件。修改已有文件请优先用 str_replace。',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string', description: '文件路径' }, content: { type: 'string', description: '文件的完整内容' } },
          required: ['path', 'content'],
        },
      },
      run: async ({ path, content }) => {
        guardTests(String(path))
        await repo.writeFile(String(path), String(content))
        return `已写入 ${path}。`
      },
    },
    {
      spec: {
        name: 'run_tests',
        description: '运行仓库里的全部测试（*.test.ts），返回失败详情和汇总。可以用 filter 只跑名字里包含某个子串的测试。',
        input_schema: { type: 'object', properties: { filter: { type: 'string', description: '可选：按 "文件 › 测试名" 过滤' } } },
      },
      run: ({ filter }) => repo.runTests(typeof filter === 'string' ? filter : undefined),
    },
  ]
}

export async function solve(issue: string, repo: RepoApi): Promise<void> {
  const result = await runAgent(`<issue>\n${issue}\n</issue>\n\n请修复这个 issue。`, createRepoTools(repo), { system: SYSTEM, maxSteps: 25 })
  log(`编码 Agent 结束：${result.stopReason}，共 ${result.steps} 步。${result.output.slice(0, 120)}`)
}
