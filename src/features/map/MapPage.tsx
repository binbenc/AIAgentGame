import { Link } from 'react-router'
import { CHAPTERS, LEVELS } from '../../content/levels'
import { isUnlocked, useProgress } from '../../state/progress'
import { useSettings } from '../../state/settings'
import { Stars } from '../../ui/Stars'

export function MapPage() {
  const levels = useProgress((s) => s.levels)
  const freeMode = useSettings((s) => s.freeMode)
  const totalStars = Object.values(levels).reduce((n, l) => n + l.stars, 0)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">关卡地图</h1>
            <p className="mt-1 text-sm text-slate-400">按顺序解锁。想跳关？到设置里开启自由模式。</p>
          </div>
          <div className="text-right text-sm text-slate-400">
            <div className="text-2xl font-bold text-amber-400">
              {totalStars} <span className="text-base text-slate-500">/ {LEVELS.length * 3} ★</span>
            </div>
            已通关 {Object.values(levels).filter((l) => l.passed).length} / {LEVELS.length}
          </div>
        </div>
        {CHAPTERS.map((ch) => {
          const list = LEVELS.filter((l) => l.chapter === ch.number)
          if (!list.length) return null
          return (
            <section key={ch.number} className="mb-10">
              <h2 className="text-lg font-semibold text-white">{ch.title}</h2>
              <p className="mb-4 text-sm text-slate-500">{ch.subtitle}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((l) => {
                  const p = levels[l.id]
                  const open = isUnlocked(l, levels, freeMode)
                  const card = (
                    <div
                      className={`h-full rounded-xl border p-4 transition ${
                        open ? 'border-slate-700 bg-slate-900/60 hover:border-violet-500' : 'border-slate-800 bg-slate-900/20 opacity-50'
                      } ${p?.passed ? 'border-emerald-700/60' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">第 {l.number} 关</span>
                        {open ? <Stars n={p?.stars ?? 0} size="text-sm" /> : <span className="text-xs text-slate-600">🔒</span>}
                      </div>
                      <h3 className="mt-1 font-semibold text-white">{l.title}</h3>
                      <p className="mt-1 text-sm leading-snug text-slate-400">{l.tagline}</p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {l.concepts.slice(0, 4).map((c) => (
                          <span key={c} className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                            {c}
                          </span>
                        ))}
                        {p?.realBadge && <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[11px] text-emerald-300">实战徽章</span>}
                      </div>
                    </div>
                  )
                  return open ? (
                    <Link key={l.id} to={`/level/${l.id}`}>
                      {card}
                    </Link>
                  ) : (
                    <div key={l.id}>{card}</div>
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
