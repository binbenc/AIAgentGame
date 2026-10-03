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
  id: 'l05',
  number: 5,
  chapter: 1,
  title: L('工具设计', 'Tool Design'),
  tagline: L('工具是给模型用的 API：描述、枚举、精简返回、错误即结果', 'Tools are an API for the model: descriptions, enums, lean results, errors as results'),
  concepts: L(['工具粒度', 'enum 约束', '返回值裁剪', 'is_error'], ['Tool granularity', 'enum constraints', 'Result trimming', 'is_error']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      'status 参数：`{ type: "string", enum: ["pending", "shipped", "delivered", "cancelled"], description: "..." }`，不要放进 required。',
      '精简返回：`orders.map(({ id, createdAt, product, amount, status }) => ({ id, createdAt, product, amount, status }))`',
      'agent.ts 里用 try/catch 包住 `tool.run()`，catch 中返回 `{ type: "tool_result", tool_use_id, content: "错误：" + e.message, is_error: true }`。',
    ],
    [
      'The status parameter: `{ type: "string", enum: ["pending", "shipped", "delivered", "cancelled"], description: "..." }`, and keep it out of required.',
      'Lean results: `orders.map(({ id, createdAt, product, amount, status }) => ({ id, createdAt, product, amount, status }))`',
      'In agent.ts, wrap `tool.run()` in try/catch and in the catch return `{ type: "tool_result", tool_use_id, content: "Error: " + e.message, is_error: true }`.',
    ],
  ),
  files: [{ path: 'toolkit.ts', starter: STARTER['toolkit.ts'] }, { path: 'agent.ts' }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
