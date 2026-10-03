/**
 * 宿主侧：创建沙箱 Worker、代理真实模型调用（Key 只存在于宿主）、设置总超时。
 */
import type { RunMode, ScenarioResult, SuiteResult } from '../judge/types'
import type { ProjectRunResult, TaskRunResult } from '../../projects/types'
import { AnthropicProvider } from '../llm/providers/anthropic'
import type { ProviderConfig, WireListener } from '../llm/providers/config'
import { OpenAIProvider } from '../llm/providers/openai'
import type { Provider } from '../llm/types'
import type { TraceEvent } from '../trace'
import type { HostMessage, SerializedError, WorkerMessage } from './protocol'
import { L, LOCALE } from '../locale'

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

export interface ProjectSandboxOptions {
  projectId: string
  files: Record<string, string>
  mode: RunMode
  provider?: ProviderConfig
  taskIds?: string[]
  trials?: number
  concurrency?: number
  timeoutMs?: number
  onTaskStart?: (key: string) => void
  onEvent?: (key: string, e: TraceEvent) => void
  onTaskEnd?: (r: TaskRunResult) => void
}

export function runProjectInSandbox(opts: ProjectSandboxOptions): { promise: Promise<ProjectRunResult>; cancel(): void } {
  return startWorker<ProjectRunResult>(
    { type: 'run-project', projectId: opts.projectId, files: opts.files, mode: opts.mode, taskIds: opts.taskIds, trials: opts.trials, concurrency: opts.concurrency },
    { mode: opts.mode, provider: opts.provider, timeoutMs: opts.timeoutMs, onScenarioStart: opts.onTaskStart, onEvent: opts.onEvent, onTaskEnd: opts.onTaskEnd },
  )
}

export function runInSandbox(opts: SandboxOptions): SandboxRun {
  return startWorker<SuiteResult>(
    { type: 'run', levelId: opts.levelId, files: opts.files, mode: opts.mode, only: opts.only },
    { mode: opts.mode, provider: opts.provider, timeoutMs: opts.timeoutMs, onScenarioStart: opts.onScenarioStart, onEvent: opts.onEvent, onScenarioEnd: opts.onScenarioEnd },
  )
}

interface StartOptions {
  mode: RunMode
  provider?: ProviderConfig
  timeoutMs?: number
  onScenarioStart?: (id: string) => void
  onEvent?: (scenario: string, e: TraceEvent) => void
  onScenarioEnd?: (r: ScenarioResult) => void
  onTaskEnd?: (r: TaskRunResult) => void
}

function startWorker<R>(start: HostMessage, opts: StartOptions): { promise: Promise<R>; cancel(): void } {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `aq:${LOCALE}` })
  const aborts = new Map<number, AbortController>()
  let finish: (r: R) => void
  let fail: (e: Error) => void
  const promise = new Promise<R>((res, rej) => {
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
      fail(
        new Error(
          L(
            `运行超时（${Math.round((opts.timeoutMs ?? 20000) / 1000)} 秒）。是不是有死循环，或者某个 Promise 永远不会结束？`,
            `Run timed out (${Math.round((opts.timeoutMs ?? 20000) / 1000)}s). Is there an infinite loop, or a Promise that never settles?`,
          ),
        ),
      )
    },
    opts.timeoutMs ?? (opts.mode === 'mock' ? 20_000 : 600_000),
  )

  async function handleLLM(id: number, req: Parameters<Provider['chat']>[0], stream: boolean) {
    if (!opts.provider) return send({ type: 'llm-error', id, error: { name: 'Error', message: L('未配置真实模型，请先到设置页填写', 'No real model configured — set one up in Settings first') } })
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
      case 'task-end':
        opts.onTaskEnd?.(m.result)
        break
      case 'done':
      case 'project-done':
        stop()
        finish(m.result as R)
        break
      case 'fatal':
        stop()
        fail(new Error(m.error.message))
        break
    }
  }
  worker.onerror = (e) => {
    stop()
    fail(new Error(`${L('沙箱错误：', 'Sandbox error: ')}${e.message}`))
  }
  send(start)
  return {
    promise,
    cancel() {
      stop()
      fail(new Error(L('已手动停止', 'Stopped')))
    },
  }
}

/** 报文里不保留任何可能的密钥 */
function redact(wire: { url: string; body: unknown }) {
  return { url: wire.url, body: wire.body }
}
