import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l04',
  number: 4,
  chapter: 1,
  title: 'Agent 循环',
  tagline: '把工具往返变成循环——这就是 Agent',
  concepts: ['agent loop', 'stop_reason', '并行工具调用', '最大步数'],
  story,
  task,
  knowledge,
  hints: [
    '骨架：`for (let step = 1; step <= maxSteps; step++) { const res = await chat(...); messages.push({ role: "assistant", content: res.content }); ... }`',
    '并行：`await Promise.all(calls.map(async c => ({ type: "tool_result", tool_use_id: c.id, content: toToolContent(await tool.run(c.input)) })))`',
    '循环结束还没返回，说明超过步数：`return { output: "", steps: maxSteps, messages, stopReason: "max_steps" }`',
  ],
  files: [{ path: 'agent.ts', starter: starter['agent.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
