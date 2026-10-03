/// <reference lib="webworker" />
/**
 * 沙箱 Worker：玩家代码只在这里运行。它拿不到 API Key——真实模型调用通过 RPC 交给宿主页面。
 */
import { LEVELS } from '../../content/levels'
import { runSuite } from '../judge/runner'
import { AbortError, LLMError, type ChatOptions, type ChatRequest, type ChatResponse, type Provider, type StreamEvent } from '../llm/types'
import type { WireListener } from '../llm/providers/config'
import type { HostMessage, SerializedError, WorkerMessage } from './protocol'

declare const self: DedicatedWorkerGlobalScope

const post = (m: WorkerMessage) => self.postMessage(m)

function reviveError(e: SerializedError): Error {
  if (e.name === 'LLMError') return new LLMError(e.message, e.status ?? 0, !!e.retryable)
  if (e.name === 'AbortError') return new AbortError(e.message)
  const err = new Error(e.message)
  err.name = e.name
  return err
}

type Pending = {
  resolve?: (r: ChatResponse) => void
  reject: (e: Error) => void
  push?: (e: StreamEvent) => void
  end?: () => void
  onWire: WireListener
}
const pending = new Map<number, Pending>()
let nextId = 0

class RemoteProvider implements Provider {
  readonly name = 'remote'
  constructor(private onWire: WireListener) {}

  chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse> {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      if (opts?.signal?.aborted) return reject(new AbortError())
      pending.set(id, { resolve, reject, onWire: this.onWire })
      opts?.signal?.addEventListener('abort', () => post({ type: 'llm-abort', id }))
      post({ type: 'llm', id, req, stream: false })
    })
  }

  async *stream(req: ChatRequest, opts?: ChatOptions): AsyncIterable<StreamEvent> {
    const id = ++nextId
    const queue: StreamEvent[] = []
    let done = false
    let error: Error | undefined
    let wake: (() => void) | undefined
    const notify = () => {
      wake?.()
      wake = undefined
    }
    pending.set(id, {
      push: (e) => (queue.push(e), notify()),
      end: () => ((done = true), notify()),
      reject: (e) => ((error = e), notify()),
      onWire: this.onWire,
    })
    opts?.signal?.addEventListener('abort', () => post({ type: 'llm-abort', id }))
    post({ type: 'llm', id, req, stream: true })
    try {
      for (;;) {
        if (queue.length) {
          yield queue.shift()!
          continue
        }
        if (error) throw error
        if (done) return
        await new Promise<void>((r) => (wake = r))
      }
    } finally {
      pending.delete(id)
    }
  }
}

self.onmessage = async (ev: MessageEvent<HostMessage>) => {
  const m = ev.data
  if (m.type === 'run') {
    const level = LEVELS.find((l) => l.id === m.levelId)
    if (!level) return post({ type: 'fatal', error: { name: 'Error', message: `未知关卡 ${m.levelId}` } })
    try {
      const result = await runSuite({
        suite: level.suite,
        files: m.files,
        mode: m.mode,
        only: m.only,
        realProvider: (onWire) => new RemoteProvider(onWire),
        onScenarioStart: (id) => post({ type: 'scenario-start', id }),
        onEvent: (scenario, event) => post({ type: 'event', scenario, event }),
        onScenarioEnd: (result) => post({ type: 'scenario-end', result }),
      })
      post({ type: 'done', result })
    } catch (e) {
      post({ type: 'fatal', error: { name: (e as Error).name, message: (e as Error).message } })
    }
    return
  }
  const p = pending.get(m.id)
  if (!p) return
  switch (m.type) {
    case 'llm-wire':
      p.onWire(m.wire)
      break
    case 'llm-result':
      pending.delete(m.id)
      p.resolve?.(m.res)
      break
    case 'llm-event':
      p.push?.(m.event)
      break
    case 'llm-end':
      p.end?.()
      break
    case 'llm-error':
      pending.delete(m.id)
      p.reject(reviveError(m.error))
      break
  }
}
