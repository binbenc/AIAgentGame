import { useCallback, useRef, useState } from 'react'
import type { RunMode } from '../../engine/judge/types'
import type { ProviderConfig } from '../../engine/llm/providers/config'
import { runProjectInSandbox } from '../../engine/sandbox/host'
import type { TraceEvent } from '../../engine/trace'
import type { ProjectRunResult, TaskRunResult } from '../../projects/types'

export interface LiveTask {
  key: string
  status: TaskRunResult['status'] | 'running' | 'pending'
  events: TraceEvent[]
  result?: TaskRunResult
}

export function useProjectRunner() {
  const [running, setRunning] = useState(false)
  const [tasks, setTasks] = useState<Record<string, LiveTask>>({})
  const [result, setResult] = useState<ProjectRunResult>()
  const [error, setError] = useState<string>()
  const ref = useRef<{ cancel(): void }>(null)

  const run = useCallback(
    async (opts: {
      projectId: string
      files: Record<string, string>
      mode: RunMode
      provider?: ProviderConfig
      keys: string[]
      taskIds?: string[]
      trials?: number
      concurrency?: number
    }) => {
      ref.current?.cancel()
      setRunning(true)
      setResult(undefined)
      setError(undefined)
      setTasks(Object.fromEntries(opts.keys.map((k) => [k, { key: k, status: 'pending', events: [] }])))
      const r = runProjectInSandbox({
        ...opts,
        timeoutMs: opts.mode === 'mock' ? 60_000 : 60 * 60_000,
        onTaskStart: (k) => setTasks((s) => ({ ...s, [k]: { key: k, status: 'running', events: [] } })),
        onEvent: (k, e) => setTasks((s) => ({ ...s, [k]: { ...s[k], events: [...(s[k]?.events ?? []), e] } })),
        onTaskEnd: (res) => {
          const k = res.trial > 1 ? `${res.taskId}#${res.trial}` : res.taskId
          setTasks((s) => ({ ...s, [k]: { key: k, status: res.status, events: res.events, result: res } }))
        },
      })
      ref.current = r
      try {
        const res = await r.promise
        setResult(res)
        return res
      } catch (e) {
        setError((e as Error).message)
        return undefined
      } finally {
        if (ref.current === r) ref.current = null
        setRunning(false)
      }
    },
    [],
  )
  const stop = useCallback(() => ref.current?.cancel(), [])
  return { running, tasks, result, error, run, stop }
}
