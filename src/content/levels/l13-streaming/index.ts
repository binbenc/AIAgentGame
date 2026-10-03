import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l13',
  number: 13,
  chapter: 3,
  title: '流式与取消',
  tagline: '让用户立刻看到字，也能随时喊停',
  concepts: ['流式输出', 'AbortController', '首字超时', '进度提示'],
  story,
  task,
  knowledge,
  hints: [
    '流式：`for await (const e of chatStream(req, { signal })) { if (e.type === "text_delta") { text += e.text; onText(e.text) } }`。',
    '取消：`const ac = new AbortController(); opts.signal?.addEventListener("abort", () => ac.abort())`；`catch (e) { if (e instanceof AbortError) return { text, cancelled: true } }`。',
    '首字超时：`sleep(ms, timer.signal).then(() => { timedOut = true; ac.abort() }, () => {})`，收到第一个 text_delta 时 `timer.abort()`。',
    '流式 Agent：迭代完事件后 `const res = await stream.finalResponse()`，后面的逻辑和 runAgent 完全一样；`tool_use_start` 事件里有 `name`。',
  ],
  files: [{ path: 'streaming.ts', starter: starter['streaming.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
