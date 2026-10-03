import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

export const level: LevelDef = {
  id: 'l01',
  number: 1,
  chapter: 1,
  title: '你好，模型',
  tagline: '一切 Agent 的地基：消息进，内容块出',
  concepts: ['messages', 'system prompt', 'content blocks', 'stop_reason', 'usage'],
  story,
  task,
  knowledge,
  hints: [
    '请求体长这样：`chat({ system, max_tokens, messages: [{ role: "user", content: question }] })`。值为 undefined 的字段会被忽略。',
    '`res.content.filter(b => b.type === "text").map(b => b.text).join("")`',
    '`truncated: res.stop_reason === "max_tokens"`',
  ],
  files: [{ path: 'llm.ts', starter: rawFiles(import.meta.glob('./starter/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')['llm.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
