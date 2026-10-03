import { L } from '../../../engine/locale'
import { localizedFiles, rawFiles, type LevelDef } from '../../types'
import knowledgeEn from './knowledge.en.md?raw'
import knowledge from './knowledge.md?raw'
import storyEn from './story.en.md?raw'
import story from './story.md?raw'
import taskEn from './task.en.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const STARTER = localizedFiles(
  rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/'),
  rawFiles(import.meta.glob('./starter.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter.en/'),
)

export const level: LevelDef = {
  id: 'l12',
  number: 12,
  chapter: 3,
  title: L('人在回路', 'Human in the Loop'),
  tagline: L('危险操作先停下来，等人拍板', 'Stop before dangerous actions and let a human decide'),
  concepts: L(['人工审批', '可暂停的 Agent', '状态序列化', '断点续跑'], ['human approval', 'pausable agent', 'state serialization', 'resume from checkpoint']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '分组：`const danger = calls.filter(c => tools.find(t => t.spec.name === c.name)?.requiresApproval)`，其余的照常 `executeToolCalls(safe, tools, opts)`。',
      '暂停时 state 里只放纯数据：`messages`、`steps`、已执行的 `results`、等待中的 `waiting`（ToolUseBlock 本身就是纯数据）。不要放工具对象或函数。',
      '拒绝：`{ type: "tool_result", tool_use_id: call.id, content: `人工审批拒绝：${note}`, is_error: true }`。模型看到这个结果，自然会去跟用户解释。',
      '恢复时先 `JSON.parse(JSON.stringify(saved))` 复制一份，再把 `results` 按上一条 assistant 消息里 tool_use 的顺序排好，`messages.push({ role: "user", content: results })`，然后接着跑 `loop`。',
    ],
    [
      'Split them: `const danger = calls.filter(c => tools.find(t => t.spec.name === c.name)?.requiresApproval)`; run the rest as usual with `executeToolCalls(safe, tools, opts)`.',
      'When pausing, put only plain data in state: `messages`, `steps`, the finished `results`, and the pending `waiting` calls (a ToolUseBlock is already plain data). No tool objects or functions.',
      'Rejecting: `{ type: "tool_result", tool_use_id: call.id, content: `Rejected by human reviewer: ${note}`, is_error: true }`. Once the model sees this result, it will explain to the user on its own.',
      'On resume, copy first with `JSON.parse(JSON.stringify(saved))`, sort `results` in the tool_use order of the last assistant message, `messages.push({ role: "user", content: results })`, then keep running `loop`.',
    ],
  ),
  files: [{ path: 'approval.ts', starter: STARTER['approval.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
