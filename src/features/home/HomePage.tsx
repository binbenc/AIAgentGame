import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LEVELS } from '../../content/levels'
import { useProgress } from '../../state/progress'

const PILLARS = [
  { title: '真实代码', body: '在浏览器里写 TypeScript，代码跑在沙箱里。没有拖拽积木，写的就是生产环境里的 Agent 内核。' },
  { title: '真实失败', body: '模拟模型会按剧情制造线上事故：限流、幻觉工具、坏 JSON、prompt 注入……你得亲手修好。' },
  { title: '可量化', body: '每关自动判题：通过拿 ★，调用次数达标拿 ★★，token 达标拿 ★★★。Trace 面板逐步展示 Agent 做了什么。' },
  { title: '实战项目', body: '通关后进入实战：帮助中心问答、τ-bench 式零售客服、SWE-bench 式编码 Agent……用和模型无关的客观判定跑你自己的基准，看 pass@1、pass^k 和成本。' },
  { title: '能落地', body: '随时切换到真实模型（Claude / GPT / DeepSeek / 通义 / Ollama）。毕业时把你自己写的代码导出成 Node 工程。' },
]

export function HomePage() {
  const { t } = useTranslation()
  const levels = useProgress((s) => s.levels)
  const next = LEVELS.find((l) => !levels[l.id]?.passed) ?? LEVELS[LEVELS.length - 1]
  const started = Object.keys(levels).length > 0
  return (
    <div className="h-full overflow-y-auto">
      <section className="mx-auto max-w-5xl px-6 pb-10 pt-16">
        <p className="mb-3 text-sm font-medium text-violet-400">Nova 科技 · AI 工程部 · 入职第一天</p>
        <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl">
          从一次模型调用，
          <br />
          写到一个<span className="bg-gradient-to-r from-violet-400 to-emerald-400 bg-clip-text text-transparent">生产级 AI Agent</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-400">{t('home.pitch')}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to={next ? `/level/${next.id}` : '/map'} className="rounded-lg bg-violet-600 px-5 py-2.5 font-medium text-white hover:bg-violet-500">
            {started ? `${t('home.continue')}：第 ${next?.number} 关` : t('home.start')}
          </Link>
          <Link to="/map" className="rounded-lg border border-slate-700 px-5 py-2.5 font-medium text-slate-200 hover:bg-slate-800">
            {t('nav.map')}
          </Link>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-16 sm:grid-cols-2">
        {PILLARS.map((p) => (
          <div key={p.title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h3 className="font-semibold text-white">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{p.body}</p>
          </div>
        ))}
      </section>
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 font-mono text-sm leading-relaxed text-slate-300">
          <div className="text-slate-500">// 所有 Agent 剥到最底层，都是这个循环</div>
          <div>
            <span className="text-violet-400">while</span> (未完成) {'{'}
          </div>
          <div className="pl-6">回复 = 模型(上下文, 工具)</div>
          <div className="pl-6">
            <span className="text-violet-400">if</span> (不需要工具) <span className="text-violet-400">return</span> 回复
          </div>
          <div className="pl-6">结果 = 执行工具(回复.工具调用)</div>
          <div className="pl-6">上下文.追加(回复, 结果)</div>
          <div>{'}'}</div>
          <div className="mt-2 text-slate-500">// 剩下的都是工程：工具设计、上下文、失败处理、评测、安全、成本……</div>
        </div>
      </section>
    </div>
  )
}
