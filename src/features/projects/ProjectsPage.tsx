import { Link } from 'react-router'
import { LEVELS } from '../../content/levels'
import { PROJECTS } from '../../projects/registry'
import { TIER_NAMES, type Tier } from '../../projects/types'
import { useProgress } from '../../state/progress'
import { useSettings } from '../../state/settings'
import { Stars } from '../../ui/Stars'
import { L } from '../../engine/locale'

const TIER_STYLE: Record<Tier, string> = {
  1: 'text-emerald-300 bg-emerald-950/60',
  2: 'text-sky-300 bg-sky-950/60',
  3: 'text-violet-300 bg-violet-950/60',
  4: 'text-rose-300 bg-rose-950/60',
}

export function useProjectsUnlocked(): boolean {
  const levels = useProgress((s) => s.levels)
  const freeMode = useSettings((s) => s.freeMode)
  return freeMode || LEVELS.every((l) => levels[l.id]?.passed)
}

export function ProjectsPage() {
  const projects = useProgress((s) => s.projects) ?? {}
  const levels = useProgress((s) => s.levels)
  const unlocked = useProjectsUnlocked()
  const passedLevels = LEVELS.filter((l) => levels[l.id]?.passed).length
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-white">{L('实战项目', 'Projects')}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
          {L(
            '每个项目都以业界经典的 Agent 案例或基准为原型：真实环境、一批真实任务、和模型无关的客观判定。没有 TODO 清单，架构由你决定，并复用你在关卡里写的代码库。模拟模型核心集负责评星；用真实模型跑「基准」，看 pass@1、pass^k 和成本。',
            'Each project is modeled on a classic agent case study or benchmark: a real environment, a set of real tasks, and objective, model-independent grading. No TODO list — you decide the architecture and reuse the codebase you built in the levels. The mock-model core set earns your stars; run a benchmark on a real model to see pass@1, pass^k and cost.',
          )}
        </p>
        {!unlocked && (
          <div className="mt-6 rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-200">
            {L(
              `通关全部 ${LEVELS.length} 关后解锁（当前 ${passedLevels} / ${LEVELS.length}）。也可以在设置里开启自由模式提前体验。`,
              `Unlocks after all ${LEVELS.length} levels (currently ${passedLevels} / ${LEVELS.length}). You can also turn on free mode in Settings to try them early.`,
            )}
          </div>
        )}
        {([1, 2, 3, 4] as Tier[]).map((tier) => {
          const list = PROJECTS.filter((p) => p.tier === tier)
          if (!list.length) return null
          return (
            <section key={tier} className="mt-10">
              <h2 className="mb-4 text-lg font-semibold text-white">{TIER_NAMES[tier]}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((p) => {
                  const prog = projects[p.id]
                  const card = (
                    <div className={`h-full rounded-xl border p-4 transition ${unlocked ? 'border-slate-700 bg-slate-900/60 hover:border-violet-500' : 'border-slate-800 bg-slate-900/20 opacity-50'}`}>
                      <div className="flex items-center justify-between">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TIER_STYLE[p.tier]}`}>
                          P{p.number} · {TIER_NAMES[p.tier]}
                        </span>
                        <Stars n={prog?.stars ?? 0} size="text-sm" />
                      </div>
                      <h3 className="mt-2 font-semibold text-white">{p.title}</h3>
                      <p className="mt-1 text-sm leading-snug text-slate-400">{p.tagline}</p>
                      <div className="mt-3 text-[11px] text-slate-500">{L('甲方：', 'Client: ')}{p.client}</div>
                      <div className="text-[11px] text-slate-500">{L('原型：', 'Modeled on: ')}{p.prototype.name}</div>
                      {prog?.bestPassRate ? (
                        <div className="mt-2 text-[11px] text-emerald-300">{L('真实模型最佳 pass@1：', 'Best real-model pass@1: ')}{Math.round(prog.bestPassRate * 100)}%</div>
                      ) : null}
                    </div>
                  )
                  return unlocked ? (
                    <Link key={p.id} to={`/project/${p.id}`}>
                      {card}
                    </Link>
                  ) : (
                    <div key={p.id}>{card}</div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
