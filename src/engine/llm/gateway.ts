import type { Clock } from '../clock'
import type { Trace } from '../trace'
import { StreamAccumulator } from './stream'
import { validateRequest } from './validate'
import { AbortError, LLMError, type ChatOptions, type ChatRequest, type ChatResponse, type Provider, type StreamEvent } from './types'

export interface GatewayLimits {
  /** 单个场景内允许的最大 LLM 调用次数，防止死循环烧钱 */
  maxCalls: number
}

/**
 * 网关：所有 LLM 调用的唯一出口。负责校验、限额、计时和记录 trace。
 * 生产环境里这一层通常也叫 “LLM client wrapper” 或 “AI gateway”。
 */
export class Gateway {
  private calls = 0
  /** 最近一次真实 HTTP 报文（由 provider 回调写入） */
  lastWire?: { url: string; body: unknown }

  constructor(
    private provider: Provider,
    private trace: Trace,
    private clock: Clock,
    private limits: GatewayLimits = { maxCalls: 40 },
  ) {}

  private closed = false

  /** 场景结束后关闭：之后的调用（没等完的后台任务）一律拒绝 */
  close(): void {
    this.closed = true
  }

  private admit(req: ChatRequest): ChatRequest {
    if (this.closed) throw new LLMError('本场景已经结束：检测到场景结束后仍在调用模型的后台任务（是不是有 Promise 没有 await？）', 0, false)
    const snapshot = structuredClone(req)
    validateRequest(snapshot)
    if (++this.calls > this.limits.maxCalls)
      throw new LLMError(`已超过本场景的 LLM 调用上限（${this.limits.maxCalls} 次）。是不是 Agent 陷入了死循环？`, 429, false)
    this.lastWire = undefined
    return snapshot
  }

  async chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse> {
    const t = this.clock.now()
    let snapshot: ChatRequest
    try {
      snapshot = this.admit(req)
    } catch (e) {
      this.trace.add({ kind: 'llm', t, durationMs: 0, streamed: false, request: req, error: (e as Error).message })
      throw e
    }
    try {
      const res = await this.provider.chat(snapshot, opts)
      this.trace.add({ kind: 'llm', t, durationMs: this.clock.now() - t, streamed: false, request: snapshot, response: res, wire: this.lastWire })
      return structuredClone(res)
    } catch (e) {
      this.trace.add({ kind: 'llm', t, durationMs: this.clock.now() - t, streamed: false, request: snapshot, error: (e as Error).message, wire: this.lastWire })
      throw e
    }
  }

  async *stream(req: ChatRequest, opts?: ChatOptions): AsyncIterable<StreamEvent> {
    const t = this.clock.now()
    const snapshot = this.admit(req)
    const acc = new StreamAccumulator()
    let settled = false
    try {
      for await (const e of this.provider.stream(snapshot, opts)) {
        if (e.type === 'message_end') {
          settled = true
          this.trace.add({ kind: 'llm', t, durationMs: this.clock.now() - t, streamed: true, request: snapshot, response: e.response, wire: this.lastWire })
          yield structuredClone(e)
          return
        }
        acc.apply(e)
        yield e
      }
    } catch (e) {
      settled = true
      const partial = acc.partial('other', { input_tokens: 0, output_tokens: 0 }, '')
      this.trace.add({
        kind: 'llm',
        t,
        durationMs: this.clock.now() - t,
        streamed: true,
        request: snapshot,
        response: partial.content.length ? partial : undefined,
        error: e instanceof AbortError ? '已取消（AbortError）' : (e as Error).message,
        wire: this.lastWire,
      })
      throw e
    } finally {
      if (!settled) {
        // 调用方提前结束了迭代（break）：仍然记录这次调用
        const partial = acc.partial('other', { input_tokens: 0, output_tokens: 0 }, '')
        this.trace.add({
          kind: 'llm',
          t,
          durationMs: this.clock.now() - t,
          streamed: true,
          request: snapshot,
          response: partial.content.length ? partial : undefined,
          error: '调用方提前结束了流（未传 signal 取消，底层请求可能仍在继续）',
          wire: this.lastWire,
        })
      }
    }
  }
}
