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
  id: 'l07',
  number: 7,
  chapter: 2,
  title: L('上下文窗口', 'Context Window'),
  tagline: L('对话越聊越长：先数 token，超了就压缩', 'Chats keep growing: count tokens, compact when over'),
  concepts: L(['上下文窗口', 'token 预算', '对话压缩', '摘要', '按轮切分'], ['context window', 'token budget', 'compaction', 'summarization', 'turn boundaries']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '先数再发：`countTokens({ system, messages, tools: tools.map(t => t.spec) })`，大于 `maxContextTokens` 才压缩，没超就什么都不做。',
      '切分：先找出所有“轮起点”的下标（`role === "user"` 且不含 `tool_result`），`cut = starts[starts.length - keepLastTurns]`，然后 `slice(0, cut)` / `slice(cut)`。',
      '摘要是一次**独立**的 `chat()`：system 写“你是对话摘要助手……必须保留姓名、订单号、时间偏好”，user 消息放 `renderTranscript(older)`。',
      '压缩后：`this.messages = [{ role: "user", content: `${SUMMARY_PREFIX} ${summary}` }, ...recent]`；如果还超，就少保留一轮再压一次。',
    ],
    [
      'Count before you send: `countTokens({ system, messages, tools: tools.map(t => t.spec) })`. Only compact when it exceeds `maxContextTokens`; otherwise do nothing.',
      'Splitting: collect the index of every turn start (`role === "user"` with no `tool_result`), `cut = starts[starts.length - keepLastTurns]`, then `slice(0, cut)` / `slice(cut)`.',
      'The summary is a **separate** `chat()`: the system prompt says "You summarize conversations... keep names, order numbers and time preferences", the user message holds `renderTranscript(older)`.',
      'After compacting: `this.messages = [{ role: "user", content: SUMMARY_PREFIX + " " + summary }, ...recent]`; if it is still over, keep one turn fewer and compact again.',
    ],
  ),
  files: [{ path: 'session.ts', starter: STARTER['session.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
