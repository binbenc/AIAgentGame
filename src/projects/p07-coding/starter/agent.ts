import { chat, textOf } from 'agent-quest'
// 提示：前面关卡写好的 Agent 循环和工具接口可以直接复用
// import { runAgent } from '../../agent'
// import type { Tool } from '../../tools'

/** 环境提供的仓库操作（原始 API）。怎么包装成给模型用的工具，由你决定。 */
export interface RepoApi {
  /** 仓库里的全部文件路径（含测试和 README） */
  listFiles(): Promise<string[]>
  /** 读文件全文；文件不存在时抛错 */
  readFile(path: string): Promise<string>
  /** 覆盖写入（文件不存在则新建） */
  writeFile(path: string, content: string): Promise<void>
  /** 类似 grep -rn：每行一个匹配 "path:行号: 内容"；pattern 是正则 */
  search(pattern: string): Promise<string>
  /** 运行仓库里的 *.test.ts，返回文本报告；filter 按 "文件 › 测试名" 子串过滤 */
  runTests(filter?: string): Promise<string>
}

/**
 * 编码 Agent 的入口：读懂 issue，修改 repo 里的代码，让 issue 得到解决。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function solve(issue: string, repo: RepoApi): Promise<void> {
  // 最朴素的版本：把整个仓库塞进一个 prompt，让模型直接给出修改后的文件，原样写回。
  // 不看代码结构、不跑测试、只能改一个文件——试试看它能拿几分。
  const paths = await repo.listFiles()
  const dump = await Promise.all(paths.map(async (p) => `### ${p}\n${await repo.readFile(p)}`))
  const res = await chat({
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `${issue}\n\n${dump.join('\n\n')}\n\n请修复这个 issue。输出修改后的完整文件：先写一行 FILE: 路径，然后是代码块。`,
      },
    ],
  })
  const text = textOf(res.content)
  const path = /FILE:\s*(\S+)/.exec(text)?.[1]
  const code = /```\w*\n([\s\S]*?)```/.exec(text)?.[1]
  if (path && code) await repo.writeFile(path, code)
}
