/**
 * 单个项目的导出：环境 + 任务集 + 判定器 + 玩家的实现（含依赖的关卡代码库）+ 引擎 + 测试 / 基准脚本。
 * 导出后：npm test 跑模拟核心集；npm run bench 用真实模型跑完整基准并生成报告。
 */
import JSZip from 'jszip'
import { engineFiles, nodeRuntime } from '../export/buildZip'
import type { SaveData } from '../state/progress'
import type { ProjectDef } from './types'

const sources = import.meta.glob(['./*.ts', './p*/**/*', '!./registry.ts', '!./exportProject.ts', '!./p*/starter/**', '!./p*/solution/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const contentTypes = import.meta.glob('../content/types.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function slugOf(p: ProjectDef) {
  return p.entry.split('/')[1]
}

export function projectFileList(project: ProjectDef, save: Pick<SaveData, 'files' | 'borrowed'>): Record<string, string> {
  const slug = slugOf(project)
  const dir = Object.keys(sources).find((k) => k.startsWith(`./${project.id}-`))!.split('/')[1]
  const out: Record<string, string> = { ...engineFiles(), 'aq/node-runtime.ts': nodeRuntime }
  out['aq/content/types.ts'] = Object.values(contentTypes)[0]
  for (const [k, v] of Object.entries(sources)) {
    const rel = k.slice(2)
    if (!rel.includes('/') || rel.startsWith(`${dir}/`)) out[`aq/projects/${rel}`] = v
  }
  // 玩家的代码：关卡代码库（项目会 import 它）+ 本项目目录；其它项目的文件不导出
  for (const [p, c] of Object.entries(save.files)) if (!p.startsWith('projects/') || p.startsWith(`projects/${slug}/`)) out[`src/${p}`] = c

  out['package.json'] = JSON.stringify(
    {
      name: `${slug}-agent`,
      private: true,
      version: '1.0.0',
      type: 'module',
      description: `${project.title}（原型：${project.prototype.name}）`,
      scripts: { test: 'vitest run tests', bench: 'AQ_BENCH=1 vitest run bench', typecheck: 'tsc --noEmit' },
      dependencies: { '@anthropic-ai/sdk': '^0.131.0', sucrase: '^3.35.1', zod: '^4.6.5' },
      devDependencies: { '@types/node': '^24.19.1', typescript: '^5.9.3', vitest: '^5.0.3' },
      engines: { node: '>=20' },
    },
    null,
    2,
  )
  out['tsconfig.json'] = JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2023', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noImplicitAny: false,
        skipLibCheck: true,
        noEmit: true,
        types: ['node', 'vite/client'],
        paths: { 'agent-quest': ['./aq/engine/runtime/api.ts'] },
      },
      include: ['src', 'tests', 'bench', 'aq'],
    },
    null,
    2,
  )
  out['vitest.config.ts'] = `import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { 'agent-quest': fileURLToPath(new URL('./aq/engine/runtime/api.ts', import.meta.url)) } },
  test: { include: process.env.AQ_BENCH ? ['bench/**/*.test.ts'] : ['tests/**/*.test.ts'], testTimeout: 3_600_000 },
})
`
  out['.gitignore'] = 'node_modules\n.env\nreports\n'
  out['.env.example'] = `LLM_PROVIDER=anthropic
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL_DEFAULT=claude-opus-5-5
LLM_MODEL_FAST=claude-haiku-4-5
# 基准参数
BENCH_K=1
BENCH_CONCURRENCY=2
# 只跑部分任务（逗号分隔的任务 id），留空跑完整集
BENCH_TASKS=
`
  out['tests/workspace.ts'] = `import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

/** 把 src/ 读成 { 工作区路径: 内容 }，和游戏里的虚拟文件系统一致 */
export function readWorkspace(dir = SRC, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) readWorkspace(p, out)
    else if (p.endsWith('.ts')) out[relative(SRC, p).split('\\\\').join('/')] = readFileSync(p, 'utf8')
  }
  return out
}
`
  out['tests/project.test.ts'] = `/** 模拟模型核心集：确定性、免费，适合放进 CI 做回归 */
import { expect, it } from 'vitest'
import { project } from '../aq/projects/${dir}/index'
import { runProject } from '../aq/projects/runner'
import { readWorkspace } from './workspace'

it('核心任务集全部通过', async () => {
  const r = await runProject({ project, files: readWorkspace(), mode: 'mock' })
  const failed = r.results.filter((x) => x.status !== 'passed').map((x) => \`[\${x.taskId}] \${x.reason}\`)
  expect(failed.join('\\n')).toBe('')
})
`
  out['bench/bench.test.ts'] = `/**
 * 真实模型基准：npm run bench（参数见 .env 里的 BENCH_*）。
 * 报告写到 reports/，包含逐题结果、pass@1、pass^k、token 和费用估算。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { configFromEnv, providerFromEnv } from '../aq/node-runtime'
import { project } from '../aq/projects/${dir}/index'
import { runProject } from '../aq/projects/runner'
import { readWorkspace } from '../tests/workspace'

if (existsSync('.env'))
  for (const line of readFileSync('.env', 'utf8').split('\\n')) {
    const m = line.match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*)\\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }

it('benchmark', async () => {
  const cfg = configFromEnv()
  const trials = Number(process.env.BENCH_K || 1)
  const taskIds = process.env.BENCH_TASKS ? process.env.BENCH_TASKS.split(',').map((s) => s.trim()) : undefined
  const r = await runProject({
    project,
    files: readWorkspace(),
    mode: 'real',
    trials,
    concurrency: Number(process.env.BENCH_CONCURRENCY || 2),
    taskIds,
    realProvider: providerFromEnv,
    onTaskEnd: (t) => console.log(\`\${t.status === 'passed' ? '✓' : '✗'} \${t.taskId}#\${t.trial} \${t.reason.slice(0, 100)}\`),
  })
  const s = r.summary
  const lines = [
    \`# \${project.title} · 基准报告\`,
    '',
    \`- 时间：\${new Date().toISOString()}\`,
    \`- 模型：\${cfg.models.default}（fast：\${cfg.models.fast}）\`,
    \`- 任务：\${s.tasks} 题 × \${s.trials} 次\`,
    \`- pass@1：\${(s.passAt1 * 100).toFixed(1)}%\${s.trials > 1 ? \` · pass^\${s.trials}：\${(s.passHatK * 100).toFixed(1)}%\` : ''}\`,
    \`- Token：\${s.totalTokens}（平均每题 \${s.avgTokensPerTask}）· 费用估算：\${s.costUsd === null ? '未知模型价格' : '$' + s.costUsd.toFixed(4)}\`,
    \`- 延迟：p50 \${Math.round(s.p50Ms)}ms · p95 \${Math.round(s.p95Ms)}ms\`,
    '',
    '| 任务 | 试验 | 结果 | Token | 原因 |',
    '|---|---|---|---|---|',
    ...r.results.map((t) => \`| \${t.taskId} | \${t.trial} | \${t.status} | \${t.inputTokens + t.outputTokens} | \${t.reason.replace(/\\|/g, '/').slice(0, 120)} |\`),
  ]
  mkdirSync('reports', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeFileSync(\`reports/bench-\${stamp}.md\`, lines.join('\\n'))
  writeFileSync(\`reports/bench-\${stamp}.json\`, JSON.stringify({ ...r, results: r.results.map(({ events, ...x }) => x) }, null, 2))
  console.log(lines.slice(0, 8).join('\\n'))
})
`
  out['README.md'] = `# ${project.title}

> 甲方：${project.client} · 原型：[${project.prototype.name}](${project.prototype.url})

这是我在 **Agent Quest** 实战项目里完成的作品。${project.tagline}。

\`\`\`bash
npm install
npm test               # 模拟模型核心集（确定性，适合 CI）
cp .env.example .env   # 填上 API Key
npm run bench          # 真实模型跑完整基准，报告写到 reports/
\`\`\`

## 目录

| 路径 | 内容 |
|---|---|
| \`${'src/' + project.entry}\` | 入口：\`${project.contract.replace(/\n/g, ' ')}\` |
| \`src/\` 其它文件 | 我在关卡里写的 Agent 代码库（项目复用了它） |
| \`aq/projects/${dir}/\` | 环境、任务集、判定器、需求文档（brief.md）和生产要点（guide.md） |
| \`aq/engine/\` | agent-quest 运行时：统一消息格式、Anthropic / OpenAI 适配器、网关、模拟模型 |
| \`tests/\` · \`bench/\` | 回归测试 · 基准脚本 |

## 如何把它变成生产服务

1. 把 \`aq/projects/${dir}/\` 里的环境 API 换成你们真实系统的接口（保持函数签名不变）。
2. 把真实流量里的失败案例补进任务集（\`tasks.ts\`），持续跑基准，看 pass@1 / pass^k / 成本的趋势。
3. 参考 \`aq/projects/${dir}/guide.md\` 的生产要点逐项检查。
${save.borrowed.length ? `\n> 注意：以下关卡模块来自参考实现（跳关自动补齐）：${save.borrowed.map((b) => '`src/' + b + '`').join('、')}\n` : ''}`
  return out
}

export async function buildProjectZip(project: ProjectDef, save: Pick<SaveData, 'files' | 'borrowed'>): Promise<Blob> {
  const zip = new JSZip()
  const root = zip.folder(`${slugOf(project)}-agent`)!
  for (const [p, c] of Object.entries(projectFileList(project, save))) root.file(p, c)
  return zip.generateAsync({ type: 'blob' })
}
