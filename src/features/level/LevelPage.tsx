import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useParams } from 'react-router'
import { LEVELS, levelById } from '../../content/levels'
import { solutionThrough } from '../../content/workspace'
import type { LevelDef } from '../../content/types'
import { isUnlocked, useProgress } from '../../state/progress'
import { useSettings } from '../../state/settings'
import { Button } from '../../ui/Button'
import { Collapsible } from '../../ui/Collapsible'
import { Markdown } from '../../ui/Markdown'
import { Stars } from '../../ui/Stars'
import { CodeEditor } from '../editor/CodeEditor'
import { CompareView } from '../editor/CompareView'
import { TracePanel } from '../trace/TracePanel'
import { useRunner, type LiveScenario } from './useRunner'

type Tab = 'story' | 'task' | 'knowledge' | 'hints'

const STATUS: Record<LiveScenario['status'], { icon: string; tone: string }> = {
  pending: { icon: '○', tone: 'text-slate-500' },
  running: { icon: '◌', tone: 'text-sky-400 animate-pulse' },
  passed: { icon: '✓', tone: 'text-emerald-400' },
  failed: { icon: '✗', tone: 'text-rose-400' },
  error: { icon: '!', tone: 'text-rose-400' },
  skipped: { icon: '–', tone: 'text-slate-500' },
}

function Brief({ level }: { level: LevelDef }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('story')
  const progress = useProgress((s) => s.levels[level.id])
  const record = useProgress((s) => s.record)
  const shown = progress?.hintsShown ?? 0
  useEffect(() => setTab('story'), [level.id])
  const tabs: Tab[] = ['story', 'task', 'knowledge', 'hints']
  return (
    <aside className="flex min-h-0 w-[min(420px,36vw)] shrink-0 flex-col border-r border-slate-800">
      <div className="border-b border-slate-800 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            第 {level.number} 关 · 第 {level.chapter <= 5 ? level.chapter : '终'} 章
          </span>
          <Stars n={progress?.stars ?? 0} size="text-sm" />
        </div>
        <h1 className="mt-1 text-lg font-bold text-white">{level.title}</h1>
        <p className="text-xs text-slate-400">{level.tagline}</p>
      </div>
      <div className="flex gap-1 border-b border-slate-800 px-3 py-1.5">
        {tabs.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded px-2.5 py-1 text-xs ${tab === k ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {t(`level.${k}`)}
            {k === 'hints' && ` ${shown}/${level.hints.length}`}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'story' && (
          <>
            <Markdown>{level.story}</Markdown>
            <Button variant="primary" className="mt-4" onClick={() => setTab('task')}>
              查看任务 →
            </Button>
          </>
        )}
        {tab === 'task' && <Markdown>{level.task}</Markdown>}
        {tab === 'knowledge' && <Markdown>{level.knowledge}</Markdown>}
        {tab === 'hints' && (
          <div className="space-y-3">
            {level.hints.slice(0, shown).map((h, i) => (
              <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="mb-1 text-[11px] font-semibold text-amber-400">提示 {i + 1}</div>
                <Markdown>{h}</Markdown>
              </div>
            ))}
            {shown < level.hints.length ? (
              <Button onClick={() => record(level.id, { hintsShown: shown + 1 })}>{t('level.showHint')}</Button>
            ) : (
              <p className="text-xs text-slate-500">{t('level.noMoreHints')}</p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

function Results({ level, runner }: { level: LevelDef; runner: ReturnType<typeof useRunner> }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string>()
  const { scenarios, result, error, running } = runner
  const ids = level.suite.scenarios.map((s) => s.id)
  const sel = selected && scenarios[selected] ? selected : (ids.find((id) => ['failed', 'error', 'running'].includes(scenarios[id]?.status)) ?? ids[0])
  const current = scenarios[sel]
  const next = LEVELS.find((l) => l.number === level.number + 1)

  if (!Object.keys(scenarios).length)
    return <div className="grid h-full place-items-center text-sm text-slate-500">{t('level.noRun')}</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(result || error) && (
        <div className={`flex items-center gap-3 border-b px-4 py-2 text-sm ${result?.passed ? 'border-emerald-900 bg-emerald-950/40' : 'border-rose-900/60 bg-rose-950/30'}`}>
          {result?.passed ? (
            <>
              <span className="font-semibold text-emerald-300">
                {t('level.passed')}
                {result.mode === 'real' && ` · 🏅 ${t('level.realBadge')}`}
              </span>
              {result.mode === 'mock' && <Stars n={result.stars} />}
            </>
          ) : (
            <span className="font-semibold text-rose-300">{error ?? t('level.failed')}</span>
          )}
          {result && (
            <span className="text-xs text-slate-400">
              {t('level.calls')} {result.totals.calls}
              <span className="text-slate-600"> / ★★ ≤{result.budgets.calls}</span> · {t('level.tokens')} {result.totals.tokens}
              <span className="text-slate-600"> / ★★★ ≤{result.budgets.tokens}</span>
            </span>
          )}
          <div className="flex-1" />
          {result?.passed && next && (
            <Link to={`/level/${next.id}`} className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500">
              {t('level.next')} →
            </Link>
          )}
          {result?.passed && !next && (
            <Link to="/graduate" className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500">
              去毕业 →
            </Link>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ul className="w-56 shrink-0 overflow-y-auto border-r border-slate-800 py-1">
          {level.suite.scenarios.map((s) => {
            const st = scenarios[s.id]?.status ?? 'pending'
            return (
              <li key={s.id}>
                <button
                  onClick={() => setSelected(s.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${sel === s.id ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/50'}`}
                >
                  <span className={`w-3 text-center font-bold ${STATUS[st].tone}`}>{STATUS[st].icon}</span>
                  <span className="truncate">{s.title}</span>
                  {s.mockOnly && <span className="ml-auto text-[10px] text-slate-600">mock</span>}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {current?.result?.message && (
            <div className={`m-2 whitespace-pre-wrap rounded-md p-2.5 font-mono text-xs ${current.status === 'skipped' ? 'bg-slate-800 text-slate-400' : 'bg-rose-950/50 text-rose-200'}`}>
              {current.result.message}
            </div>
          )}
          {current && (current.status !== 'pending' || running) && <TracePanel events={current.events} />}
        </div>
      </div>
    </div>
  )
}

export function LevelPage() {
  const { id = '' } = useParams()
  const level = levelById(id)
  const { t } = useTranslation()
  const files = useProgress((s) => s.files)
  const borrowed = useProgress((s) => s.borrowed)
  const levelsProgress = useProgress((s) => s.levels)
  const enterLevel = useProgress((s) => s.enterLevel)
  const setFile = useProgress((s) => s.setFile)
  const resetFile = useProgress((s) => s.resetFile)
  const record = useProgress((s) => s.record)
  const freeMode = useSettings((s) => s.freeMode)
  const provider = useSettings((s) => s.effectiveProvider)
  const runner = useRunner()
  const [active, setActive] = useState('')
  const [compare, setCompare] = useState(false)
  const [briefOpen, setBriefOpen] = useState(true)

  useEffect(() => {
    if (!level) return
    enterLevel(level)
    setActive(level.files[0].path)
    setCompare(false)
    setBriefOpen(true)
  }, [level, enterLevel])

  // 参考工作区 = 截至本关的全部参考实现，保证参考代码里 import 的前面关卡模块也能解析
  const reference = useMemo(() => (level ? solutionThrough(LEVELS, level.number) : {}), [level])

  const focus = useMemo(() => new Set(level?.files.map((f) => f.path)), [level])
  const paths = useMemo(() => {
    const all = Object.keys(files)
    return [...all.filter((p) => focus.has(p)), ...all.filter((p) => !focus.has(p)).sort()]
  }, [files, focus])

  const toggleCompare = () => {
    if (compare) {
      setCompare(false)
      setBriefOpen(true)
    } else {
      setCompare(true)
      setBriefOpen(false)
    }
  }

  if (!level) return <Navigate to="/map" replace />
  if (!isUnlocked(level, levelsProgress, freeMode)) return <Navigate to="/map" replace />

  const start = async (mode: 'mock' | 'real') => {
    const cfg = provider()
    if (mode === 'real' && !cfg) return alert(t('level.needKey'))
    const res = await runner.run({ levelId: level.id, files, mode, provider: cfg, scenarioIds: level.suite.scenarios.map((s) => s.id) })
    const prev = useProgress.getState().levels[level.id]
    record(level.id, { attempts: (prev?.attempts ?? 0) + 1 })
    if (res?.passed) record(level.id, mode === 'mock' ? { passed: true, stars: res.stars, bestTokens: Math.min(prev?.bestTokens ?? Infinity, res.totals.tokens) } : { realBadge: true })
  }

  return (
    <div className="flex h-full min-h-0">
      <Collapsible open={briefOpen} onToggle={() => setBriefOpen(true)} label="剧情与任务">
        <Brief level={level} />
      </Collapsible>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 px-2 py-1">
          {paths.map((p) => (
            <button
              key={p}
              onClick={() => setActive(p)}
              title={borrowed.includes(p) ? t('level.borrowed') : undefined}
              className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 font-mono text-xs ${active === p ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {focus.has(p) && <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />}
              {p}
              {borrowed.includes(p) && <span className="text-[10px] text-amber-500">参考</span>}
            </button>
          ))}
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
                highlight={Object.keys(level.solution)}
                onClose={toggleCompare}
              />
            ) : (
              <CodeEditor files={files} active={active} onChange={setFile} />
            ))}
        </div>
        <div className="flex items-center gap-2 border-y border-slate-800 bg-slate-900/60 px-3 py-1.5">
          {runner.running ? (
            <Button variant="danger" onClick={runner.stop}>
              ■ {t('level.stop')}
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => start('mock')}>
                ▶ {t('level.run')}
              </Button>
              <Button onClick={() => start('real')} title="用你在设置页配置的真实模型运行（不含依赖模拟故障的场景）">
                ⚡ {t('level.runReal')}
              </Button>
            </>
          )}
          {runner.running && <span className="text-xs text-slate-400">{t('level.running')}</span>}
          <div className="flex-1" />
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm(t('level.resetConfirm', { path: active }))) resetFile(level, active)
            }}
          >
            ↺ {t('level.resetFile')}
          </Button>
          <Button variant={compare ? 'secondary' : 'ghost'} onClick={toggleCompare}>
            {compare ? t('level.closeSolution') : t('level.showSolution')}
          </Button>
        </div>
        <div className="min-h-0 flex-[2]">
          <Results level={level} runner={runner} />
        </div>
      </section>
    </div>
  )
}
