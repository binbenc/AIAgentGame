import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { LEVELS } from '../../content/levels'
import { baselineBefore } from '../../content/workspace'
import { projectById } from '../../projects/registry'
import { selectTasks, taskKey } from '../../projects/runner'
import { TIER_NAMES, type ProjectDef } from '../../projects/types'
import { useProgress, type ProjectRunRecord } from '../../state/progress'
import { useSettings } from '../../state/settings'
import { Button } from '../../ui/Button'
import { Collapsible } from '../../ui/Collapsible'
import { Markdown } from '../../ui/Markdown'
import { Stars } from '../../ui/Stars'
import { CodeEditor } from '../editor/CodeEditor'
import { CompareView } from '../editor/CompareView'
import { TracePanel } from '../trace/TracePanel'
import { useProjectsUnlocked } from './ProjectsPage'
import { useProjectRunner, type LiveTask } from './useProjectRunner'

const NO_HISTORY: ProjectRunRecord[] = []

type Tab = 'brief' | 'tasks' | 'guide' | 'history'

const DOT: Record<LiveTask['status'], string> = {
  pending: 'bg-slate-700',
  running: 'bg-sky-400 animate-pulse',
  passed: 'bg-emerald-400',
  failed: 'bg-rose-500',
  error: 'bg-amber-500',
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const money = (x: number | null) => (x === null ? '—' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`)

function Brief({ project, history, comparing, onCompare }: { project: ProjectDef; history: ProjectRunRecord[]; comparing: boolean; onCompare(): void }) {
  const [tab, setTab] = useState<Tab>('brief')
  const tabs: [Tab, string][] = [
    ['brief', '需求'],
    ['tasks', `任务 ${project.tasks.length}`],
    ['guide', '生产要点'],
    ['history', `历史 ${history.length}`],
  ]
  return (
    <aside className="flex min-h-0 w-[min(440px,36vw)] shrink-0 flex-col border-r border-slate-800">
      <div className="border-b border-slate-800 px-4 pb-3 pt-4">
        <div className="text-xs text-slate-500">
          实战项目 P{project.number} · {TIER_NAMES[project.tier]} · 原型{' '}
          <a href={project.prototype.url} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">
            {project.prototype.name}
          </a>
        </div>
        <h1 className="mt-1 text-lg font-bold text-white">{project.title}</h1>
        <p className="text-xs text-slate-400">{project.tagline}</p>
      </div>
      <div className="flex gap-1 border-b border-slate-800 px-3 py-1.5">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded px-2.5 py-1 text-xs ${tab === k ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'brief' && (
          <>
            <Markdown>{project.brief}</Markdown>
            <h3 className="mb-1 mt-4 text-sm font-semibold text-white">接口约定（{project.entry}）</h3>
            <pre className="overflow-x-auto rounded-md bg-slate-950 p-2 font-mono text-[11px] text-slate-300">{project.contract}</pre>
          </>
        )}
        {tab === 'tasks' && (
          <ul className="space-y-1 text-xs">
            {project.tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded border border-slate-800 p-2">
                <span className={`mt-0.5 shrink-0 rounded px-1 text-[10px] ${t.core ? 'bg-violet-900 text-violet-200' : 'bg-slate-800 text-slate-400'}`}>{t.core ? '核心' : '基准'}</span>
                <div className="min-w-0">
                  <div className="font-medium text-slate-200">{t.title}</div>
                  <div className="truncate text-slate-500">{typeof t.input === 'string' ? t.input : t.id}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {tab === 'guide' && (
          <>
            <Markdown>{project.guide}</Markdown>
            <Button className="mt-4" onClick={onCompare}>
              {comparing ? '关闭对照' : '对照参考解法'}
            </Button>
          </>
        )}
        {tab === 'history' && (
          <table className="w-full text-left text-[11px] text-slate-300">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1">时间</th>
                <th>模式</th>
                <th>pass@1</th>
                <th>pass^k</th>
                <th>Token</th>
                <th>费用</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.at} className="border-t border-slate-800">
                  <td className="py-1">{new Date(h.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{h.mode === 'mock' ? '模拟' : `真实${h.model ? ` · ${h.model}` : ''}`}</td>
                  <td>{pct(h.passAt1)}</td>
                  <td>{h.trials > 1 ? `${pct(h.passHatK)} (k=${h.trials})` : '—'}</td>
                  <td>{h.totalTokens}</td>
                  <td>{money(h.costUsd)}</td>
                </tr>
              ))}
              {!history.length && (
                <tr>
                  <td colSpan={6} className="py-3 text-slate-500">
                    还没有运行记录。每次运行都会记在这里，方便对比改动前后的效果。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  )
}

function BenchDialog({ project, onClose, onStart }: { project: ProjectDef; onClose(): void; onStart(o: { scope: 'core' | 'all'; trials: number; concurrency: number }): void }) {
  const [scope, setScope] = useState<'core' | 'all'>('all')
  const [trials, setTrials] = useState(1)
  const [concurrency, setConcurrency] = useState(2)
  const n = scope === 'all' ? project.tasks.length : project.tasks.filter((t) => t.core).length
  const estTokens = n * trials * project.tokenBudget / Math.max(1, project.tasks.filter((t) => t.core).length) * 1.5
  const sel = 'rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-white">运行真实模型基准</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          用设置页配置的真实模型跑任务集。每道题跑 k 次：pass@1 是平均成功率，pass^k 是“k 次全部成功”的题目占比——它衡量的是可靠性（τ-bench 发现很多 Agent 的 pass^8 远低于 pass@1）。
        </p>
        <div className="mt-4 space-y-3 text-sm text-slate-300">
          <label className="flex items-center justify-between">
            任务范围
            <select className={sel} value={scope} onChange={(e) => setScope(e.target.value as 'core' | 'all')}>
              <option value="all">完整集（{project.tasks.length} 题）</option>
              <option value="core">核心集（{project.tasks.filter((t) => t.core).length} 题）</option>
            </select>
          </label>
          <label className="flex items-center justify-between">
            每题试验次数 k
            <select className={sel} value={trials} onChange={(e) => setTrials(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between">
            并发数
            <select className={sel} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
              {[1, 2, 3, 4, 6, 8].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-4 rounded-md bg-amber-950/40 p-2 text-xs text-amber-200">
          共 {n * trials} 次任务运行，粗略估计约 {Math.round(estTokens / 1000)}k token（按参考解法的消耗估算，你的实现可能更多）。会产生真实费用。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => onStart({ scope, trials, concurrency })}>
            开始
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ProjectPage() {
  const { id = '' } = useParams()
  const project = projectById(id)
  const unlocked = useProjectsUnlocked()
  const files = useProgress((s) => s.files)
  const borrowed = useProgress((s) => s.borrowed)
  const history = useProgress((s) => s.projects?.[id]?.history) ?? NO_HISTORY
  const enterProject = useProgress((s) => s.enterProject)
  const setFile = useProgress((s) => s.setFile)
  const recordProject = useProgress((s) => s.recordProject)
  const provider = useSettings((s) => s.effectiveProvider)
  const runner = useProjectRunner()
  const [active, setActive] = useState('')
  const [selected, setSelected] = useState<string>()
  const [bench, setBench] = useState(false)
  const [busyExport, setBusyExport] = useState(false)
  const [compare, setCompare] = useState(false)
  const [briefOpen, setBriefOpen] = useState(true)

  useEffect(() => {
    if (!project) return
    enterProject(project)
    setActive(project.entry)
    setCompare(false)
    setBriefOpen(true)
  }, [project, enterProject])

  // 参考工作区 = 全部关卡参考实现 + 项目参考解法（参考解法会 import 关卡里的模块）
  const reference = useMemo(() => (project ? { ...baselineBefore(LEVELS, Infinity), ...project.solution } : {}), [project])

  const dir = project ? project.entry.slice(0, project.entry.lastIndexOf('/') + 1) : ''
  const paths = useMemo(() => {
    const all = Object.keys(files)
    return [...all.filter((p) => p.startsWith(dir)).sort(), ...all.filter((p) => !p.startsWith('projects/')).sort()]
  }, [files, dir])

  if (!project || !unlocked) return <Navigate to="/projects" replace />

  function toggleCompare() {
    if (compare) {
      setCompare(false)
      setBriefOpen(true)
    } else {
      setCompare(true)
      setBriefOpen(false)
    }
  }

  async function start(mode: 'mock' | 'real', opts: { scope: 'core' | 'all'; trials: number; concurrency: number } = { scope: 'core', trials: 1, concurrency: 1 }) {
    const cfg = provider()
    if (mode === 'real' && !cfg) return alert('真实模型运行需要先在设置页配置 API Key')
    setBench(false)
    const taskIds = mode === 'real' ? selectTasks(project!, 'real').filter((t) => opts.scope === 'all' || t.core).map((t) => t.id) : undefined
    const list = taskIds ?? selectTasks(project!, 'mock').map((t) => t.id)
    const trials = mode === 'real' ? opts.trials : 1
    const keys = list.flatMap((t) => Array.from({ length: trials }, (_, i) => taskKey(t, i + 1)))
    setSelected(undefined)
    const res = await runner.run({ projectId: project!.id, files, mode, provider: cfg, keys, taskIds, trials, concurrency: mode === 'real' ? opts.concurrency : 1 })
    if (res)
      recordProject(
        project!.id,
        {
          at: Date.now(),
          mode,
          tasks: res.summary.tasks,
          trials: res.summary.trials,
          passAt1: res.summary.passAt1,
          passHatK: res.summary.passHatK,
          totalTokens: res.summary.totalTokens,
          costUsd: res.summary.costUsd,
          p50Ms: res.summary.p50Ms,
          model: mode === 'real' ? cfg?.models.default : undefined,
        },
        res.stars,
      )
  }

  async function exportZip() {
    setBusyExport(true)
    try {
      const { buildProjectZip } = await import('../../projects/exportProject')
      const blob = await buildProjectZip(project!, useProgress.getState())
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${project!.entry.split('/')[1]}-agent.zip`
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setBusyExport(false)
    }
  }

  const keys = Object.keys(runner.tasks)
  const sel = selected && runner.tasks[selected] ? selected : keys.find((k) => ['failed', 'error', 'running'].includes(runner.tasks[k].status)) ?? keys[0]
  const current = sel ? runner.tasks[sel] : undefined
  const r = runner.result

  return (
    <div className="flex h-full min-h-0">
      <Collapsible open={briefOpen} onToggle={() => setBriefOpen(true)} label="需求与任务">
        <Brief project={project} history={history} comparing={compare} onCompare={toggleCompare} />
      </Collapsible>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 px-2 py-1">
          {paths.map((p) => (
            <button
              key={p}
              onClick={() => setActive(p)}
              className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 font-mono text-xs ${active === p ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {p.startsWith(dir) && <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />}
              {p.startsWith(dir) ? p.slice('projects/'.length) : p}
              {borrowed.includes(p) && <span className="text-[10px] text-amber-500">参考</span>}
            </button>
          ))}
          <button
            className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:text-white"
            onClick={() => {
              const name = prompt(`在 ${dir} 下新建文件（例如 tools.ts）`)?.trim()
              if (name && /^[\w./-]+\.ts$/.test(name)) {
                setFile(dir + name, '')
                setActive(dir + name)
              }
            }}
          >
            ＋ 新文件
          </button>
        </div>
        <div className="min-h-0 flex-[3]">
          {active &&
            (compare ? (
              <CompareView
                files={files}
                active={active}
                setActive={setActive}
                onChange={setFile}
                reference={reference}
                highlight={Object.keys(project.solution)}
                onClose={toggleCompare}
              />
            ) : (
              <CodeEditor files={files} active={active} onChange={setFile} />
            ))}
        </div>
        <div className="flex items-center gap-2 border-y border-slate-800 bg-slate-900/60 px-3 py-1.5">
          {runner.running ? (
            <Button variant="danger" onClick={runner.stop}>
              ■ 停止
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => start('mock')}>
                ▶ 运行核心集
              </Button>
              <Button onClick={() => setBench(true)}>⚡ 运行基准（真实模型）</Button>
            </>
          )}
          <div className="flex-1" />
          <Button variant={compare ? 'secondary' : 'ghost'} onClick={toggleCompare}>
            {compare ? '关闭对照' : '对照参考解法'}
          </Button>
          <Button variant="ghost" onClick={exportZip} disabled={busyExport}>
            {busyExport ? '打包中…' : '⬇ 导出项目'}
          </Button>
        </div>
        <div className="flex min-h-0 flex-[2] flex-col">
          {(r || runner.error) && (
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs ${r && r.summary.passAt1 === 1 ? 'border-emerald-900 bg-emerald-950/40' : 'border-slate-800 bg-slate-900/40'}`}>
              {runner.error ? (
                <span className="font-semibold text-rose-300">{runner.error}</span>
              ) : (
                r && (
                  <>
                    <span className="text-sm font-semibold text-white">pass@1 {pct(r.summary.passAt1)}</span>
                    {r.summary.trials > 1 && <span className="text-slate-300">pass^{r.summary.trials} {pct(r.summary.passHatK)}</span>}
                    {r.mode === 'mock' && <Stars n={r.stars} />}
                    <span className="text-slate-400">
                      Token {r.summary.totalTokens}
                      {r.mode === 'mock' && <span className="text-slate-600"> / ★★★ ≤{project.tokenBudget}</span>}
                    </span>
                    <span className="text-slate-400">费用 {money(r.summary.costUsd)}</span>
                    <span className="text-slate-400">p50 {Math.round(r.summary.p50Ms)}ms · p95 {Math.round(r.summary.p95Ms)}ms</span>
                    {r.mode === 'mock' && r.stars === 0 && <span className="text-amber-300">及格线：核心通过率 ≥ {pct(project.passThreshold)}</span>}
                    <Link to="/projects" className="ml-auto text-violet-300 hover:underline">
                      返回项目墙
                    </Link>
                  </>
                )
              )}
            </div>
          )}
          {!keys.length ? (
            <div className="grid flex-1 place-items-center text-sm text-slate-500">点击「运行核心集」查看评分卡</div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <ul className="w-64 shrink-0 overflow-y-auto border-r border-slate-800 py-1">
                {keys.map((k) => {
                  const t = runner.tasks[k]
                  const def = project.tasks.find((x) => x.id === k.split('#')[0])
                  return (
                    <li key={k}>
                      <button
                        onClick={() => setSelected(k)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${sel === k ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/50'}`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[t.status]}`} />
                        <span className="truncate">{def?.title ?? k}</span>
                        {k.includes('#') && <span className="text-[10px] text-slate-500">#{k.split('#')[1]}</span>}
                        {t.result && <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">{t.result.inputTokens + t.result.outputTokens}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {current?.result && (
                  <div className={`m-2 whitespace-pre-wrap rounded-md p-2.5 font-mono text-xs ${current.status === 'passed' ? 'bg-emerald-950/50 text-emerald-200' : 'bg-rose-950/50 text-rose-200'}`}>
                    {current.result.reason}
                  </div>
                )}
                {current && <TracePanel events={current.events} />}
              </div>
            </div>
          )}
        </div>
      </section>
      {bench && <BenchDialog project={project} onClose={() => setBench(false)} onStart={(o) => start('real', o)} />}
    </div>
  )
}
