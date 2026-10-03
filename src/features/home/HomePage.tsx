import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LEVELS } from '../../content/levels'
import { useProgress } from '../../state/progress'
import { L } from '../../engine/locale'

const PILLARS = [
  {
    title: L('真实代码', 'Real code'),
    body: L('在浏览器里写 TypeScript，代码跑在沙箱里。没有拖拽积木，写的就是生产环境里的 Agent 内核。', 'Write TypeScript in the browser; it runs in a sandbox. No drag-and-drop blocks — you write the same agent core that runs in production.'),
  },
  {
    title: L('真实失败', 'Real failures'),
    body: L('模拟模型会按剧情制造线上事故：限流、幻觉工具、坏 JSON、prompt 注入……你得亲手修好。', 'The mock model stages production incidents as the story unfolds — rate limits, hallucinated tools, broken JSON, prompt injection… and you fix them yourself.'),
  },
  {
    title: L('可量化', 'Measurable'),
    body: L('每关自动判题：通过拿 ★，调用次数达标拿 ★★，token 达标拿 ★★★。Trace 面板逐步展示 Agent 做了什么。', 'Every level is graded automatically: ★ for passing, ★★ within the call budget, ★★★ within the token budget. The Trace panel shows step by step what your agent did.'),
  },
  {
    title: L('实战项目', 'Projects'),
    body: L('通关后进入实战：帮助中心问答、τ-bench 式零售客服、SWE-bench 式编码 Agent……用和模型无关的客观判定跑你自己的基准，看 pass@1、pass^k 和成本。', 'After the levels come real projects: help-center Q&A, τ-bench-style retail support, a SWE-bench-style coding agent… Benchmark your own agent with model-independent grading and see pass@1, pass^k and cost.'),
  },
  {
    title: L('能落地', 'Production-ready'),
    body: L('随时切换到真实模型（Claude / GPT / DeepSeek / 通义 / Ollama）。毕业时把你自己写的代码导出成 Node 工程。', 'Switch to a real model at any time (Claude / GPT / DeepSeek / Qwen / Ollama). On graduation, export the code you wrote as a Node project.'),
  },
]

export function HomePage() {
  const { t } = useTranslation()
  const levels = useProgress((s) => s.levels)
  const next = LEVELS.find((l) => !levels[l.id]?.passed) ?? LEVELS[LEVELS.length - 1]
  const started = Object.keys(levels).length > 0
  return (
    <div className="h-full overflow-y-auto">
      <section className="mx-auto max-w-5xl px-6 pb-10 pt-16">
        <p className="mb-3 text-sm font-medium text-violet-400">{L('Nova 科技 · AI 工程部 · 入职第一天', 'Nova Tech · AI Engineering · Day one')}</p>
        <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl">
          {L('从一次模型调用，', 'From a single model call')}
          <br />
          {L('写到一个', 'to a ')}
          <span className="bg-gradient-to-r from-violet-400 to-emerald-400 bg-clip-text text-transparent">{L('生产级 AI Agent', 'production-grade AI agent')}</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-400">{t('home.pitch')}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to={next ? `/level/${next.id}` : '/map'} className="rounded-lg bg-violet-600 px-5 py-2.5 font-medium text-white hover:bg-violet-500">
            {started ? `${t('home.continue')}${L(`：第 ${next?.number} 关`, `: level ${next?.number}`)}` : t('home.start')}
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
          <div className="text-slate-500">{L('// 所有 Agent 剥到最底层，都是这个循环', '// Strip any agent down to the core and you get this loop')}</div>
          <div>
            <span className="text-violet-400">while</span> ({L('未完成', 'not done')}) {'{'}
          </div>
          <div className="pl-6">{L('回复 = 模型(上下文, 工具)', 'reply = model(context, tools)')}</div>
          <div className="pl-6">
            <span className="text-violet-400">if</span> ({L('不需要工具', 'no tool calls')}) <span className="text-violet-400">return</span> {L('回复', 'reply')}
          </div>
          <div className="pl-6">{L('结果 = 执行工具(回复.工具调用)', 'results = runTools(reply.toolCalls)')}</div>
          <div className="pl-6">{L('上下文.追加(回复, 结果)', 'context.append(reply, results)')}</div>
          <div>{'}'}</div>
          <div className="mt-2 text-slate-500">{L('// 剩下的都是工程：工具设计、上下文、失败处理、评测、安全、成本……', '// Everything else is engineering: tool design, context, failure handling, evals, safety, cost…')}</div>
        </div>
      </section>
    </div>
  )
}
