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
  id: 'l13',
  number: 13,
  chapter: 3,
  title: L('流式与取消', 'Streaming and Cancellation'),
  tagline: L('让用户立刻看到字，也能随时喊停', 'Show users text right away, and let them stop it anytime'),
  concepts: L(['流式输出', 'AbortController', '首字超时', '进度提示'], ['streaming', 'AbortController', 'first-token timeout', 'progress updates']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '流式：`for await (const e of chatStream(req, { signal })) { if (e.type === "text_delta") { text += e.text; onText(e.text) } }`。',
      '取消：`const ac = new AbortController(); opts.signal?.addEventListener("abort", () => ac.abort())`；`catch (e) { if (e instanceof AbortError) return { text, cancelled: true } }`。',
      '首字超时：`sleep(ms, timer.signal).then(() => { timedOut = true; ac.abort() }, () => {})`，收到第一个 text_delta 时 `timer.abort()`。',
      '流式 Agent：迭代完事件后 `const res = await stream.finalResponse()`，后面的逻辑和 runAgent 完全一样；`tool_use_start` 事件里有 `name`。',
    ],
    [
      'Streaming: `for await (const e of chatStream(req, { signal })) { if (e.type === "text_delta") { text += e.text; onText(e.text) } }`.',
      'Cancellation: `const ac = new AbortController(); opts.signal?.addEventListener("abort", () => ac.abort())`; `catch (e) { if (e instanceof AbortError) return { text, cancelled: true } }`.',
      'First-token timeout: `sleep(ms, timer.signal).then(() => { timedOut = true; ac.abort() }, () => {})`, and `timer.abort()` when the first text_delta arrives.',
      'Streaming agent: after consuming the events, `const res = await stream.finalResponse()`; the rest is exactly like runAgent. The `tool_use_start` event has a `name`.',
    ],
  ),
  files: [{ path: 'streaming.ts', starter: STARTER['streaming.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
