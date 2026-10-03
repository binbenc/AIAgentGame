import { AbortError, chatStream, sleep, type Message, type ToolUseBlock } from 'agent-quest'
import { executeToolCalls, type AgentOptions } from './agent'
import { NOVA_SYSTEM } from './llm'
import { textOf, type Tool } from './tools'

export interface StreamOptions {
  /** 用户点了“停止生成”时 abort 它 */
  signal?: AbortSignal
  /** 多久没收到第一个字就放弃（毫秒） */
  firstTokenTimeoutMs?: number
  system?: string
}

export interface StreamResult {
  text: string
  cancelled: boolean
  timedOut?: boolean
}

export async function streamAnswer(question: string, onText: (delta: string) => void, opts: StreamOptions = {}): Promise<StreamResult> {
  // 现在的写法：等模型全部生成完，再一次性交给界面——用户要盯着空白屏幕等好几秒
  const stream = chatStream({ system: opts.system ?? NOVA_SYSTEM, messages: [{ role: 'user', content: question }] })
  const res = await stream.finalResponse()
  const text = textOf(res.content)
  onText(text)
  return { text, cancelled: false }

  // TODO：
  //   1. 用 for await (const e of stream) 逐个处理事件，收到 text_delta 就立刻 onText(e.text)
  //   2. 取消：new 一个自己的 AbortController，opts.signal abort 时跟着 abort；把它的 signal 传给 chatStream(req, { signal })
  //      捕获 AbortError，返回已生成的部分 + cancelled: true
  //   3. 首字超时：sleep(firstTokenTimeoutMs, timer.signal) 到点还没收到首字就 abort 请求，返回 timedOut: true；
  //      收到首字后要取消这个计时器
}

export interface AgentStreamCallbacks {
  onText?(delta: string): void
  /** 进度提示，例如“正在调用工具 get_shipping…” */
  onStatus?(status: string): void
}

/** 流式版的 Agent 循环：文字边生成边推送，调用工具时推送进度 */
export async function streamAgent(
  task: string,
  tools: Tool[],
  cb: AgentStreamCallbacks = {},
  opts: AgentOptions & { signal?: AbortSignal } = {},
): Promise<{ output: string; messages: Message[] }> {
  // TODO：和 runAgent 一样的循环，但每一轮用 chatStream：
  //   - text_delta → cb.onText；tool_use_start → cb.onStatus(`正在调用工具 ${e.name}…`)
  //   - 迭代完后 await stream.finalResponse() 拿到完整响应，按老办法执行工具、继续循环
  throw new Error('TODO：实现 streamAgent()')
}
