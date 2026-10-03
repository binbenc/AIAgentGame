import type { Clock } from '../../clock'
import { responseToEvents } from '../stream'
import { contentTokens, estimateTokens, requestTokens } from '../tokens'
import {
  AbortError,
  type ChatOptions,
  type ChatRequest,
  type ChatResponse,
  type ContentBlock,
  type Provider,
  type StopReason,
  type StreamEvent,
} from '../types'

export interface MockReply {
  content: ContentBlock[]
  stop_reason?: StopReason
  /** 模拟延迟（虚拟毫秒） */
  latencyMs?: number
}

export interface MockContext {
  /** 当前判题场景 id，mock 据此决定剧情走向 */
  scenario: string
  /** 本场景中第几次调用（从 0 开始） */
  call: number
  /** 确定性伪随机数 */
  rng(): number
  /** 生成确定性的 tool_use id */
  nextId(): string
  /** 本场景内可跨调用共享的状态 */
  state: Record<string, unknown>
}

/** 每关一个确定性脚本：看到玩家真实发出的请求，决定回复什么。可以抛 LLMError 模拟故障。 */
export type MockModel = (req: ChatRequest, ctx: MockContext) => MockReply

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export class MockProvider implements Provider {
  readonly name = 'mock'
  private ctx: MockContext

  constructor(
    private model: MockModel,
    scenario: string,
    private clock: Clock,
  ) {
    let id = 0
    this.ctx = {
      scenario,
      call: -1,
      rng: mulberry32(hash(scenario)),
      nextId: () => `toolu_${scenario.replace(/[^a-zA-Z0-9]/g, '')}_${++id}`,
      state: {},
    }
  }

  private modelName(req: ChatRequest): string {
    const tier = req.model ?? 'default'
    return tier === 'fast' ? 'mock-fast' : tier === 'default' ? 'mock-default' : `mock:${tier}`
  }

  private produce(req: ChatRequest): { res: ChatResponse; latency: number } {
    this.ctx.call++
    const reply = this.model(structuredClone(req), this.ctx)
    let content = reply.content
    let stop: StopReason = reply.stop_reason ?? (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn')
    let out = contentTokens(content)
    const max = req.max_tokens ?? 4096
    if (out > max) {
      // 超出 max_tokens：截断文本，丢弃未完成的工具调用
      const text = content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
      let cut = ''
      for (const ch of text) {
        if (estimateTokens(cut + ch) > max) break
        cut += ch
      }
      content = [{ type: 'text', text: cut }]
      stop = 'max_tokens'
      out = estimateTokens(cut)
    }
    const fast = req.model === 'fast'
    const latency = reply.latencyMs ?? (fast ? 150 : 400) + out * (fast ? 4 : 12)
    return {
      res: {
        content,
        stop_reason: stop,
        usage: { input_tokens: requestTokens(req), output_tokens: out },
        model: this.modelName(req),
      },
      latency,
    }
  }

  async chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse> {
    if (opts?.signal?.aborted) throw new AbortError()
    const { res, latency } = this.produce(req)
    await this.wait(latency, opts?.signal)
    return res
  }

  async *stream(req: ChatRequest, opts?: ChatOptions): AsyncIterable<StreamEvent> {
    if (opts?.signal?.aborted) throw new AbortError()
    const { res, latency } = this.produce(req)
    const events = [...responseToEvents(res)]
    const per = Math.max(1, Math.round(latency / events.length))
    for (const e of events) {
      await this.wait(per, opts?.signal)
      yield e
    }
  }

  /** 可被立即取消的等待 */
  private async wait(ms: number, signal?: AbortSignal): Promise<void> {
    try {
      await this.clock.sleep(ms, signal)
    } catch {
      throw new AbortError()
    }
    if (signal?.aborted) throw new AbortError()
  }
}
