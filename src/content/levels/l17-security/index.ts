import { L } from '../../../engine/locale'
import { localizedFiles, rawFiles, type LevelDef } from '../../types'
import knowledgeEn from './knowledge.en.md?raw'
import knowledge from './knowledge.md?raw'
import storyEn from './story.en.md?raw'
import story from './story.md?raw'
import taskEn from './task.en.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = localizedFiles(
  rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/'),
  rawFiles(import.meta.glob('./starter.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter.en/'),
)


export const level: LevelDef = {
  id: 'l17',
  number: 17,
  chapter: 5,
  title: L('安全', 'Security'),
  tagline: L('模型不是安全边界：外部内容是数据，高风险操作要过闸门', 'The model is not a security boundary: external content is data, and risky actions go through a gate'),
  concepts: L(
    ['间接提示注入', '最小权限', '策略闸门', '输出过滤', '纵深防御'],
    ['Indirect prompt injection', 'Least privilege', 'Policy gates', 'Output filtering', 'Defense in depth'],
  ),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '包裹：`content.replace(/<\\s*\\/\\s*untrusted\\s*>/gi, "[/untrusted]")` 先中和伪造的结束标签，再拼成 `<untrusted source="${source}">\\n...\\n</untrusted>`。',
      '最小权限就是一行过滤：`tools.filter(t => allowedNames.includes(t.spec.name))`。策略闸门是一个包装器：`{ spec: tool.spec, run: async (input) => { const reason = policy(input, state); if (reason) { log(...); throw new Error("安全策略拦截：" + reason) } return tool.run(input) } }`。',
      '手机号正则 `/(?<!\\d)1[3-9]\\d{9}(?!\\d)/g`，替换成 `m.slice(0, 3) + "****" + m.slice(-4)`；身份证号 `/(?<![0-9A-Za-z])\\d{17}[\\dXx](?![0-9A-Za-z])/g` 要在手机号之前处理。',
      'secureAgent：`scopeTools` → 对 untrustedTools 用 `untrustedTool(t, state)`、对有策略的用 `guardTool(t, policy, state)` → `runAgent(task, tools, { ...opts, system: [opts.system, UNTRUSTED_POLICY].filter(Boolean).join("\\n\\n") })` → `redactSecrets(result.output)`。',
    ],
    [
      'Wrapping: neutralize forged closing tags first with `content.replace(/<\\s*\\/\\s*untrusted\\s*>/gi, "[/untrusted]")`, then build `<untrusted source="${source}">\\n...\\n</untrusted>`.',
      'Least privilege is a one-line filter: `tools.filter(t => allowedNames.includes(t.spec.name))`. A policy gate is a wrapper: `{ spec: tool.spec, run: async (input) => { const reason = policy(input, state); if (reason) { log(...); throw new Error("Blocked by security policy: " + reason) } return tool.run(input) } }`.',
      'Phone regex `/(?<!\\d)1[3-9]\\d{9}(?!\\d)/g`, replaced with `m.slice(0, 3) + "****" + m.slice(-4)`; handle ID numbers `/(?<![0-9A-Za-z])\\d{17}[\\dXx](?![0-9A-Za-z])/g` before phone numbers.',
      'secureAgent: `scopeTools` → wrap untrustedTools with `untrustedTool(t, state)` and tools with a policy with `guardTool(t, policy, state)` → `runAgent(task, tools, { ...opts, system: [opts.system, UNTRUSTED_POLICY].filter(Boolean).join("\\n\\n") })` → `redactSecrets(result.output)`.',
    ],
  ),
  files: [{ path: 'guardrails.ts', starter: starter['guardrails.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
