/**
 * “agent-quest” 模块：玩家代码里 `import { chat } from 'agent-quest'` 拿到的就是这里。
 * 它只是一层很薄的门面，真正的调用会转发给当前运行时（浏览器沙箱 / Node 测试 / 导出工程）。
 */
import type { Clock } from '../clock'
import type { Gateway } from '../llm/gateway'
import { estimateTokens, messageTokens, requestTokens } from '../llm/tokens'
import type { ChatOptions, ChatRequest, ChatResponse, Message, StreamEvent } from '../llm/types'
import type { Trace } from '../trace'

export type {
  ChatOptions,
  ChatRequest,
  ChatResponse,
  ContentBlock,
  JSONSchema,
  Message,
  ModelTier,
  OpaqueBlock,
  StopReason,
  StreamEvent,
  TextBlock,
  ToolResultBlock,
  ToolSpec,
  ToolUseBlock,
  Usage,
} from '../llm/types'
import { AbortError, LLMError, textOf } from '../llm/types'
export { AbortError, LLMError, textOf }

export interface Runtime {
  gateway: Gateway
  clock: Clock
  trace: Trace
}

let current: Runtime | null = null

export function __setRuntime(rt: Runtime | null): void {
  current = rt
}

function rt(): Runtime {
  if (!current) throw new Error('agent-quest 运行时未初始化')
  return current
}

export interface ChatStream extends AsyncIterable<StreamEvent> {
  /** 消费完整个流后得到完整响应；如果你没有自己迭代，它会替你迭代。 */
  finalResponse(): Promise<ChatResponse>
}

/**
 * 生成一份绑定到指定运行时的 API。判题时每个场景拿到自己的一份，
 * 这样上一个场景里“没等完”的后台任务不会串到下一个场景里。
 */
export function createApi(get: () => Runtime) {
  function chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse> {
    return get().gateway.chat(req, opts)
  }

  function chatStream(req: ChatRequest, opts?: ChatOptions): ChatStream {
    const it = get().gateway.stream(req, opts)[Symbol.asyncIterator]()
    let final: ChatResponse | undefined
    let started = false
    const iterable: ChatStream = {
      [Symbol.asyncIterator]() {
        if (started) throw new Error('一个 ChatStream 只能被迭代一次')
        started = true
        return {
          async next() {
            const r = await it.next()
            if (!r.done && r.value.type === 'message_end') final = r.value.response
            return r
          },
          // for await 里 break / return 时，通知底层结束，保证这次调用被记录
          async return() {
            await it.return?.()
            return { done: true as const, value: undefined }
          },
        }
      },
      async finalResponse() {
        if (!started) for await (const _ of iterable) void _
        if (!final) throw new Error('流未正常结束，没有完整响应')
        return final
      },
    }
    return iterable
  }

  function countTokens(input: string | Message | Message[] | ChatRequest): number {
    if (typeof input === 'string') return estimateTokens(input)
    if (Array.isArray(input)) return input.reduce((n, m) => n + messageTokens(m), 0)
    if ('messages' in input) return requestTokens(input)
    return messageTokens(input)
  }

  async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    const r = get()
    const t = r.clock.now()
    await r.clock.sleep(ms, signal)
    // 只记录真正睡满的等待；被取消的计时器（例如没触发的超时）不进 trace
    r.trace.add({ kind: 'sleep', t, ms })
  }

  function now(): number {
    return get().clock.now()
  }

  function log(...args: unknown[]): void {
    const r = get()
    const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    r.trace.add({ kind: 'log', t: r.clock.now(), message })
  }

  return { chat, chatStream, countTokens, sleep, now, log, textOf, LLMError, AbortError }
}

const globalApi = createApi(rt)
/** 调用一次模型（非流式）。 */
export const chat = globalApi.chat
/** 流式调用模型。用 for await 迭代事件，或者直接 await finalResponse()。 */
export const chatStream = globalApi.chatStream
/** 估算 token 数（与模拟模型的计费口径一致）。 */
export const countTokens = globalApi.countTokens
/** 等待一段时间。模拟模式下是虚拟时间：立即返回，但 now() 会前进。 */
export const sleep = globalApi.sleep
/** 当前时间（毫秒，从场景开始计）。 */
export const now = globalApi.now
/** 写一条日志到 Trace 面板。 */
export const log = globalApi.log

/** 供关卡环境使用：把一个工具实现包一层，自动记录调用到 trace。 */
export function __traced<A extends unknown[], R>(name: string, fn: (...args: A) => R | Promise<R>) {
  return async (...args: A): Promise<R> => {
    const r = rt()
    const t = r.clock.now()
    const input = args.length === 1 ? args[0] : args
    try {
      const output = await fn(...args)
      r.trace.add({ kind: 'tool', t, durationMs: r.clock.now() - t, name, input: safeClone(input), output: safeClone(output) })
      return output
    } catch (e) {
      r.trace.add({ kind: 'tool', t, durationMs: r.clock.now() - t, name, input: safeClone(input), error: (e as Error).message })
      throw e
    }
  }
}

function safeClone(v: unknown): unknown {
  try {
    return structuredClone(v)
  } catch {
    return String(v)
  }
}

/** 供关卡环境使用：模拟 I/O 延迟（不写入 trace） */
export function __delay(ms: number): Promise<void> {
  return rt().clock.sleep(ms)
}
