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
  id: 'l02',
  number: 2,
  chapter: 1,
  title: L('结构化输出', 'Structured Output'),
  tagline: L('模型输出是不可信输入：解析、校验、带着错误重试', 'Model output is untrusted input: parse, validate, retry with the error'),
  concepts: L(['JSON 输出', 'zod 校验', '自我修正', '重试上限'], ['JSON output', 'zod validation', 'Self-correction', 'Retry cap']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '代码块：`text.match(/```(?:json)?\\s*([\\s\\S]*?)```/)`；再找第一个 `{` 和最后一个 `}`。',
      'zod 错误：`parsed.error.issues.map(i => i.path.join(".") + ": " + i.message)`，路径里包含字段名，模型才知道该改哪儿。',
      '重试时要 push 两条消息：`{ role: "assistant", content: res.content }` 和 `{ role: "user", content: "错误：..." }`。',
    ],
    [
      'Fences: `text.match(/```(?:json)?\\s*([\\s\\S]*?)```/)`, then find the first `{` and the last `}`.',
      'zod errors: `parsed.error.issues.map(i => i.path.join(".") + ": " + i.message)`. The path names the field, so the model knows what to fix.',
      'On retry, push two messages: `{ role: "assistant", content: res.content }` and `{ role: "user", content: "Error: ..." }`.',
    ],
  ),
  files: [{ path: 'structured.ts', starter: STARTER['structured.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
