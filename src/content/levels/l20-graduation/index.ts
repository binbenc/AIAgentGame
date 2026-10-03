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
  id: 'l20',
  number: 20,
  chapter: 6,
  title: L('毕业项目：Nova 客服 Agent v1.0', 'Capstone: Nova Support Agent v1.0'),
  tagline: L('生产级 Agent = 所有零件按正确的顺序组装', 'A production agent = every part, assembled in the right order'),
  concepts: L(['组装', 'Agentic RAG', '纵深防御', '兜底', '上线'], ['Assembly', 'Agentic RAG', 'Defense in depth', 'Fallbacks', 'Launch']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '工具集：`[...createOrderTools(deps.orders).map(t => /cancel/.test(t.spec.name) ? requireApproval(t, deps.approve) : t), untrustedTool(helpCenterTool(deps.kb), state), ...createMemoryTools(deps.memory, userId)]`',
      'system：`buildSystemWithMemories(SUPPORT_SYSTEM + "\\n\\n" + UNTRUSTED_POLICY, deps.memory.recall(userId, message, 3))`',
      '调用链：`instrument(withBudget(chat, { maxUsd }), tracer, { feature: "support" })`，作为 `runAgent(message, tools, { system, model, chat: chatFn, maxSteps: 8 })` 的 `chat` 传进去。',
      '兜底：`try { ... } catch (e) { if (e instanceof BudgetExceededError) return { reply: HANDOFF_REPLY, handedOff: true, ... }; throw e }`；费用用 `tracer.spans.slice(before)` 求和。',
    ],
    [
      'Tools: `[...createOrderTools(deps.orders).map(t => /cancel/.test(t.spec.name) ? requireApproval(t, deps.approve) : t), untrustedTool(helpCenterTool(deps.kb), state), ...createMemoryTools(deps.memory, userId)]`',
      'System: `buildSystemWithMemories(SUPPORT_SYSTEM + "\\n\\n" + UNTRUSTED_POLICY, deps.memory.recall(userId, message, 3))`',
      'Call chain: `instrument(withBudget(chat, { maxUsd }), tracer, { feature: "support" })`, passed in as the `chat` of `runAgent(message, tools, { system, model, chat: chatFn, maxSteps: 8 })`.',
      'Fallback: `try { ... } catch (e) { if (e instanceof BudgetExceededError) return { reply: HANDOFF_REPLY, handedOff: true, ... }; throw e }`; sum the cost over `tracer.spans.slice(before)`.',
    ],
  ),
  files: [{ path: 'app.ts', starter: starter['app.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
