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
  id: 'l01',
  number: 1,
  chapter: 1,
  title: L('你好，模型', 'Hello, Model'),
  tagline: L('一切 Agent 的地基：消息进，内容块出', 'The foundation of every agent: messages in, content blocks out'),
  concepts: ['messages', 'system prompt', 'content blocks', 'stop_reason', 'usage'],
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '请求体长这样：`chat({ system, max_tokens, messages: [{ role: "user", content: question }] })`。值为 undefined 的字段会被忽略。',
      '`res.content.filter(b => b.type === "text").map(b => b.text).join("")`',
      '`truncated: res.stop_reason === "max_tokens"`',
    ],
    [
      'The request looks like `chat({ system, max_tokens, messages: [{ role: "user", content: question }] })`. Fields that are undefined are ignored.',
      '`res.content.filter(b => b.type === "text").map(b => b.text).join("")`',
      '`truncated: res.stop_reason === "max_tokens"`',
    ],
  ),
  files: [{ path: 'llm.ts', starter: STARTER['llm.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
