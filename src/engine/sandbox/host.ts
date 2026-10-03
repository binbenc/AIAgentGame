/**
 * 宿主侧：创建沙箱 Worker、代理真实模型调用（Key 只存在于宿主）、设置总超时。
 */
import type { RunMode, ScenarioResult, SuiteResult } from '../judge/types'
import { AnthropicProvider } from '../llm/providers/anthropic'
import type { ProviderConfig, WireListener } from '../llm/providers/config'
import { OpenAIProvider } from '../llm/providers/openai'
import type { Provider } from '../llm/types'
import type { TraceEvent } from '../trace'
import type { HostMessage, SerializedError, WorkerMessage } from './protocol'

export interface SandboxRun {
  promise: Promise<SuiteResult>
  cancel(): void
}

export interface SandboxOptions {
  levelId: string
  files: Record<string, string>
  mode: RunMode
  provider?: ProviderConfig
  only?: string[]
  timeoutMs?: number
  onScenarioStart?: (id: string) => void
  onEvent?: (scenario: string, e: TraceEvent) => void
  onScenarioEnd?: (r: ScenarioResult) => void
}

export function createProvider(cfg: ProviderConfig, onWire?: WireListener): Provider {
  return cfg.kind === 'anthropic' ? new AnthropicProvider(cfg, onWire) : new OpenAIProvider(cfg, onWire)
}

function serialize(e: unknown): SerializedError {
  const err = e as { name?: string; message?: string; status?: number; retryable?: boolean }
  return { name: err?.name ?? 'Error', message: err?.message ?? String(e), status: err?.status, retryable: err?.retryable }
}

export function runInSandbox(opts: SandboxOptions): SandboxRun {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const aborts = new Map<number, AbortController>()
  let finish: (r: SuiteResult) => void
  let fail: (e: Error) => void
  const promise = new Promise<SuiteResult>((res, rej) => {
    finish = res
    fail = rej
  })
  const send = (m: HostMessage) => worker.postMessage(m)
  const stop = () => {
    worker.terminate()
    for (const a of aborts.values()) a.abort()
    clearTimeout(timer)
  }
  const timer = setTimeout(
    () => {
      stop()
      fail(new Error(`运行超时（${Math.round((opts.timeoutMs ?? 20000) / 1000)} 秒）。是不是有死循环，或者某个 Promise 永远不会结束？`))
    },
    opts.timeoutMs ?? (opts.mode === 'mock' ? 20_000 : 600_000),
  )

  async function handleLLM(id: number, req: Parameters<Provider['chat']>[0], stream: boolean) {
    if (!opts.provider) return send({ type: 'llm-error', id, error: { name: 'Error', message: '未配置真实模型，请先到设置页填写' } })
    const ac = new AbortController()
    aborts.set(id, ac)
    const provider = createProvider(opts.provider, (wire) => send({ type: 'llm-wire', id, wire: redact(wire) }))
    try {
      if (stream) {
        for await (const event of provider.stream(req, { signal: ac.signal })) send({ type: 'llm-event', id, event })
        send({ type: 'llm-end', id })
      } else {
        send({ type: 'llm-result', id, res: await provider.chat(req, { signal: ac.signal }) })
      }
    } catch (e) {
      send({ type: 'llm-error', id, error: serialize(e) })
    } finally {
      aborts.delete(id)
    }
  }

  worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
    const m = ev.data
    switch (m.type) {
      case 'llm':
        void handleLLM(m.id, m.req, m.stream)
        break
      case 'llm-abort':
        aborts.get(m.id)?.abort()
        break
      case 'scenario-start':
        opts.onScenarioStart?.(m.id)
        break
      case 'event':
        opts.onEvent?.(m.scenario, m.event)
        break
      case 'scenario-end':
        opts.onScenarioEnd?.(m.result)
        break
      case 'done':
        stop()
        finish(m.result)
        break
      case 'fatal':
        stop()
        fail(new Error(m.error.message))
        break
    }
  }
  worker.onerror = (e) => {
    stop()
    fail(new Error(`沙箱错误：${e.message}`))
  }
  send({ type: 'run', levelId: opts.levelId, files: opts.files, mode: opts.mode, only: opts.only })
  return {
    promise,
    cancel() {
      stop()
      fail(new Error('已手动停止'))
    },
  }
}

/** 报文里不保留任何可能的密钥 */
function redact(wire: { url: string; body: unknown }) {
  return { url: wire.url, body: wire.body }
}
