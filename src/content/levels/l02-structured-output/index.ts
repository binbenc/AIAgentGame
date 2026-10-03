import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l02',
  number: 2,
  chapter: 1,
  title: '结构化输出',
  tagline: '模型输出是不可信输入：解析、校验、带着错误重试',
  concepts: ['JSON 输出', 'zod 校验', '自我修正', '重试上限'],
  story,
  task,
  knowledge,
  hints: [
    '代码块：`text.match(/```(?:json)?\\s*([\\s\\S]*?)```/)`；再找第一个 `{` 和最后一个 `}`。',
    'zod 错误：`parsed.error.issues.map(i => i.path.join(".") + ": " + i.message)`，路径里包含字段名，模型才知道该改哪儿。',
    '重试时要 push 两条消息：`{ role: "assistant", content: res.content }` 和 `{ role: "user", content: "错误：..." }`。',
  ],
  files: [{ path: 'structured.ts', starter: starter['structured.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
