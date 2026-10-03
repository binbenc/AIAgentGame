import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l12',
  number: 12,
  chapter: 3,
  title: '人在回路',
  tagline: '危险操作先停下来，等人拍板',
  concepts: ['人工审批', '可暂停的 Agent', '状态序列化', '断点续跑'],
  story,
  task,
  knowledge,
  hints: [
    '分组：`const danger = calls.filter(c => tools.find(t => t.spec.name === c.name)?.requiresApproval)`，其余的照常 `executeToolCalls(safe, tools, opts)`。',
    '暂停时 state 里只放纯数据：`messages`、`steps`、已执行的 `results`、等待中的 `waiting`（ToolUseBlock 本身就是纯数据）。不要放工具对象或函数。',
    '拒绝：`{ type: "tool_result", tool_use_id: call.id, content: `人工审批拒绝：${note}`, is_error: true }`。模型看到这个结果，自然会去跟用户解释。',
    '恢复时先 `JSON.parse(JSON.stringify(saved))` 复制一份，再把 `results` 按上一条 assistant 消息里 tool_use 的顺序排好，`messages.push({ role: "user", content: results })`，然后接着跑 `loop`。',
  ],
  files: [{ path: 'approval.ts', starter: starter['approval.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
