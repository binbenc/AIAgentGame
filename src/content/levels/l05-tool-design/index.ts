import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l05',
  number: 5,
  chapter: 1,
  title: '工具设计',
  tagline: '工具是给模型用的 API：描述、枚举、精简返回、错误即结果',
  concepts: ['工具粒度', 'enum 约束', '返回值裁剪', 'is_error'],
  story,
  task,
  knowledge,
  hints: [
    'status 参数：`{ type: "string", enum: ["pending", "shipped", "delivered", "cancelled"], description: "..." }`，不要放进 required。',
    '精简返回：`orders.map(({ id, createdAt, product, amount, status }) => ({ id, createdAt, product, amount, status }))`',
    'agent.ts 里用 try/catch 包住 `tool.run()`，catch 中返回 `{ type: "tool_result", tool_use_id, content: "错误：" + e.message, is_error: true }`。',
  ],
  files: [{ path: 'toolkit.ts', starter: starter['toolkit.ts'] }, { path: 'agent.ts' }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
