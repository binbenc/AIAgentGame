import { useState } from 'react'
import { Link } from 'react-router'
import { LEVELS } from '../../content/levels'
import { useProgress } from '../../state/progress'
import { Button } from '../../ui/Button'
import { Stars } from '../../ui/Stars'

const CONTENTS = [
  ['src/', '你亲手写的全部代码：Agent 循环、工具、容错、上下文、记忆、RAG、规划、工作流、审批、流式、多 Agent、评测、安全、可观测性、MCP'],
  ['tests/', '游戏里的全部判题场景，变成你的回归测试：npm test（模拟模型，适合 CI）/ npm run test:real（真实模型）'],
  ['aq/', '游戏的运行时与判题引擎源码（agent-quest 门面、Anthropic / OpenAI 适配器、网关、模拟模型）'],
  ['bin/agent.ts', '命令行入口：npm run agent -- "你的问题"，用 .env 里配置的真实模型跑你的 Agent'],
  ['examples/', '你的代码与 Claude Tool Runner / Claude Agent SDK / OpenAI Agents SDK / LangGraph.js / MCP SDK 的对照迁移示例'],
  ['PRODUCTION_CHECKLIST.md', '上线前检查清单，每一项都对应一个关卡'],
  ['PROGRESS.md', '你的闯关记录'],
]

export function GraduatePage() {
  const { files, levels, borrowed } = useProgress()
  const [busy, setBusy] = useState(false)
  const passed = LEVELS.filter((l) => levels[l.id]?.passed).length
  const stars = Object.values(levels).reduce((n, l) => n + l.stars, 0)
  const badges = Object.values(levels).filter((l) => l.realBadge).length
  const done = passed === LEVELS.length

  async function download() {
    setBusy(true)
    try {
      const { buildZip } = await import('../../export/buildZip')
      const blob = await buildZip({ files, levels, borrowed })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'my-nova-agent.zip'
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-white">{done ? '🎓 毕业了！' : '毕业'}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          {done
            ? '你已经从零写出了一个生产级 Agent 的全部部件。把它带走吧——下面导出的是一个可以直接 npm install && npm test 的 Node 工程。'
            : '通关全部关卡后，就可以把你亲手写的 Agent 导出成一个可运行的 Node 工程。现在也可以随时导出当前进度。'}
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            ['通关', `${passed} / ${LEVELS.length}`],
            ['星数', `${stars} / ${LEVELS.length * 3}`],
            ['实战徽章', `${badges}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="text-xs text-slate-500">{k}</div>
              <div className="mt-1 text-2xl font-bold text-white">{v}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">导出工程</h2>
            <Button variant="success" onClick={download} disabled={busy || !Object.keys(files).length}>
              {busy ? '打包中…' : '⬇ 下载 my-nova-agent.zip'}
            </Button>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {CONTENTS.map(([k, v]) => (
              <li key={k} className="flex gap-3">
                <code className="w-48 shrink-0 font-mono text-xs text-violet-300">{k}</code>
                <span className="text-slate-400">{v}</span>
              </li>
            ))}
          </ul>
          <pre className="mt-4 rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-300">
            {`unzip my-nova-agent.zip && cd my-nova-agent
npm install
npm test                 # 用你通关时的全部场景做回归
cp .env.example .env     # 填上你的 API Key
npm run agent -- "我是 alice@example.com，最近那单到哪了？"`}
          </pre>
          {borrowed.length > 0 && (
            <p className="mt-3 text-xs text-amber-400">
              注意：{borrowed.join('、')} 是跳关时用参考实现补上的，不是你写的。导出的 PROGRESS.md 里也会标出来。
            </p>
          )}
        </div>

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="mb-3 font-semibold text-white">闯关记录</h2>
          <ul className="divide-y divide-slate-800">
            {LEVELS.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-10 text-xs text-slate-500">#{l.number}</span>
                <Link to={`/level/${l.id}`} className="flex-1 text-slate-200 hover:text-white">
                  {l.title}
                </Link>
                {levels[l.id]?.realBadge && <span title="实战徽章">🏅</span>}
                <Stars n={levels[l.id]?.stars ?? 0} size="text-sm" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
