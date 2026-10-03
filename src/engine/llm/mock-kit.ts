/** 编写关卡 mock 模型时的小工具。 */
import type { MockContext, MockReply } from './providers/mock'
import type { ChatRequest, ContentBlock, ToolResultBlock, ToolSpec, ToolUseBlock } from './types'

export function say(text: string): MockReply {
  return { content: [{ type: 'text', text }] }
}

export function callTools(ctx: MockContext, calls: { name: string; input: unknown }[], preamble?: string): MockReply {
  const content: ContentBlock[] = []
  if (preamble) content.push({ type: 'text', text: preamble })
  for (const c of calls) content.push({ type: 'tool_use', id: ctx.nextId(), name: c.name, input: c.input })
  return { content, stop_reason: 'tool_use' }
}

export function callTool(ctx: MockContext, name: string, input: unknown, preamble?: string): MockReply {
  return callTools(ctx, [{ name, input }], preamble)
}

function blocks(content: string | ContentBlock[]): ContentBlock[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

/** 最后一条 user 消息里的纯文本 */
export function lastUserText(req: ChatRequest): string {
  const m = req.messages[req.messages.length - 1]
  return blocks(m.content)
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n')
}

/** 第一条 user 消息的纯文本（通常是任务本身） */
export function firstUserText(req: ChatRequest): string {
  return blocks(req.messages[0].content)
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n')
}

/** 最后一条 user 消息里的 tool_result（即刚执行完的工具结果） */
export function lastToolResults(req: ChatRequest): ToolResultBlock[] {
  const m = req.messages[req.messages.length - 1]
  return blocks(m.content).filter((b): b is ToolResultBlock => b.type === 'tool_result')
}

/** 整段对话里出现过的所有 tool_use */
export function allToolUses(req: ChatRequest): ToolUseBlock[] {
  return req.messages.flatMap((m) => blocks(m.content).filter((b): b is ToolUseBlock => b.type === 'tool_use'))
}

/** 整段对话里出现过的所有 tool_result */
export function allToolResults(req: ChatRequest): ToolResultBlock[] {
  return req.messages.flatMap((m) => blocks(m.content).filter((b): b is ToolResultBlock => b.type === 'tool_result'))
}

/** 整个请求里模型能“看到”的全部文本（system + 消息 + 工具结果） */
export function visibleText(req: ChatRequest): string {
  const parts = [req.system ?? '']
  for (const m of req.messages)
    for (const b of blocks(m.content)) {
      if (b.type === 'text') parts.push(b.text)
      else if (b.type === 'tool_result') parts.push(b.content)
      else if (b.type === 'tool_use') parts.push(JSON.stringify(b.input))
    }
  return parts.join('\n')
}

/** 按名字或谓词查找玩家提供的工具 */
export function findTool(req: ChatRequest, pred: string | ((t: ToolSpec) => boolean)): ToolSpec | undefined {
  const f = typeof pred === 'string' ? (t: ToolSpec) => t.name === pred : pred
  return (req.tools ?? []).find(f)
}

/** 模型“根据描述挑工具”：返回名称或描述里命中任一关键词的工具 */
export function toolMatching(req: ChatRequest, keywords: string[]): ToolSpec | undefined {
  return findTool(req, (t) => {
    const hay = `${t.name} ${t.description}`.toLowerCase()
    return keywords.some((k) => hay.includes(k.toLowerCase()))
  })
}

/** 取工具 schema 中第一个必填参数名（让 mock 尊重玩家自定义的参数名） */
export function firstRequiredParam(t: ToolSpec): string | undefined {
  return t.input_schema.required?.[0] ?? Object.keys(t.input_schema.properties ?? {})[0]
}
