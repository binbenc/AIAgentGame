import { useCallback, useRef, useState } from 'react'
import type { RunMode, ScenarioResult, SuiteResult } from '../../engine/judge/types'
import type { ProviderConfig } from '../../engine/llm/providers/config'
import { runInSandbox, type SandboxRun } from '../../engine/sandbox/host'
import type { TraceEvent } from '../../engine/trace'

export interface LiveScenario {
  id: string
  status: ScenarioResult['status'] | 'running' | 'pending'
  events: TraceEvent[]
  result?: ScenarioResult
}

export function useRunner() {
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<RunMode>('mock')
  const [scenarios, setScenarios] = useState<Record<string, LiveScenario>>({})
  const [result, setResult] = useState<SuiteResult>()
  const [error, setError] = useState<string>()
  const runRef = useRef<SandboxRun>(null)

  const run = useCallback(
    async (opts: { levelId: string; files: Record<string, string>; mode: RunMode; provider?: ProviderConfig; scenarioIds: string[] }) => {
      runRef.current?.cancel()
      setRunning(true)
      setMode(opts.mode)
      setResult(undefined)
      setError(undefined)
      setScenarios(Object.fromEntries(opts.scenarioIds.map((id) => [id, { id, status: 'pending', events: [] }])))
      const r = runInSandbox({
        levelId: opts.levelId,
        files: opts.files,
        mode: opts.mode,
        provider: opts.provider,
        onScenarioStart: (id) => setScenarios((s) => ({ ...s, [id]: { id, status: 'running', events: [] } })),
        onEvent: (id, e) => setScenarios((s) => ({ ...s, [id]: { ...s[id], events: [...(s[id]?.events ?? []), e] } })),
        onScenarioEnd: (res) => setScenarios((s) => ({ ...s, [res.id]: { id: res.id, status: res.status, events: res.events, result: res } })),
      })
      runRef.current = r
      try {
        const res = await r.promise
        setResult(res)
        return res
      } catch (e) {
        setError((e as Error).message)
        setScenarios((s) =>
          Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.status === 'running' || v.status === 'pending' ? { ...v, status: 'error' as const } : v])),
        )
        return undefined
      } finally {
        if (runRef.current === r) runRef.current = null
        setRunning(false)
      }
    },
    [],
  )

  const stop = useCallback(() => runRef.current?.cancel(), [])

  return { running, mode, scenarios, result, error, run, stop }
}
