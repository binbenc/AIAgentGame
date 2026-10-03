import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l03',
  number: 3,
  chapter: 1,
  title: '第一个工具',
  tagline: '模型只“请求”调用工具，执行的永远是你的代码',
  concepts: ['tool schema', 'tool_use', 'tool_result', 'tool_use_id 配对'],
  story,
  task,
  knowledge,
  hints: [
    'schema：`{ type: "object", properties: { city: { type: "string", description: "城市中文名" } }, required: ["city"] }`',
    '找工具调用块：`first.content.filter(b => b.type === "tool_use")`，每个块有 `id`、`name`、`input`。',
    '第二次请求的 assistant 消息要用 `first.content`（完整数组），不是文本。',
  ],
  files: [{ path: 'tools.ts', starter: starter['tools.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
