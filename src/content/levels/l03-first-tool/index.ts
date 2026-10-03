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
  id: 'l03',
  number: 3,
  chapter: 1,
  title: L('第一个工具', 'Your First Tool'),
  tagline: L('模型只“请求”调用工具，执行的永远是你的代码', 'The model only asks to call a tool; your code always does the work'),
  concepts: L(['tool schema', 'tool_use', 'tool_result', 'tool_use_id 配对'], ['tool schema', 'tool_use', 'tool_result', 'tool_use_id pairing']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      'schema：`{ type: "object", properties: { city: { type: "string", description: "城市中文名" } }, required: ["city"] }`',
      '找工具调用块：`first.content.filter(b => b.type === "tool_use")`，每个块有 `id`、`name`、`input`。',
      '第二次请求的 assistant 消息要用 `first.content`（完整数组），不是文本。',
    ],
    [
      'Schema: `{ type: "object", properties: { city: { type: "string", description: "City name, e.g. Shanghai" } }, required: ["city"] }`',
      'Find the tool calls with `first.content.filter(b => b.type === "tool_use")`; each block has an `id`, `name` and `input`.',
      'In the second request, the assistant message must be `first.content` (the whole array), not the text.',
    ],
  ),
  files: [{ path: 'tools.ts', starter: STARTER['tools.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
