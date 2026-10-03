import { lazy, Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, NavLink, Route, Routes } from 'react-router'
import { GraduatePage } from './features/graduate/GraduatePage'
import { HomePage } from './features/home/HomePage'
import { MapPage } from './features/map/MapPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { useProgress } from './state/progress'

// 编辑器（Monaco）体积较大，按需加载
const LevelPage = lazy(() => import('./features/level/LevelPage').then((m) => ({ default: m.LevelPage })))

function Nav() {
  const { t } = useTranslation()
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur">
      <NavLink to="/" className="mr-4 flex items-center gap-2 font-semibold text-white">
        <span className="grid h-6 w-6 place-items-center rounded bg-gradient-to-br from-violet-500 to-emerald-500 text-xs">AQ</span>
        {t('app.name')}
        <span className="hidden text-xs font-normal text-slate-500 sm:inline">{t('app.tagline')}</span>
      </NavLink>
      <NavLink to="/map" className={link}>
        {t('nav.map')}
      </NavLink>
      <NavLink to="/graduate" className={link}>
        {t('nav.graduate')}
      </NavLink>
      <div className="flex-1" />
      <NavLink to="/settings" className={link}>
        {t('nav.settings')}
      </NavLink>
    </header>
  )
}

export function App() {
  const loaded = useProgress((s) => s.loaded)
  const load = useProgress((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])
  if (!loaded) return <div className="grid h-full place-items-center text-slate-500">加载存档…</div>
  return (
    <HashRouter>
      <div className="flex h-full flex-col">
        <Nav />
        <main className="min-h-0 flex-1">
          <Suspense fallback={<div className="grid h-full place-items-center text-slate-500">加载编辑器…</div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/level/:id" element={<LevelPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/graduate" element={<GraduatePage />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </HashRouter>
  )
}
