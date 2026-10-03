import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l07',
  number: 7,
  chapter: 2,
  title: '上下文窗口',
  tagline: '对话越聊越长：先数 token，超了就压缩',
  concepts: ['上下文窗口', 'token 预算', '对话压缩', '摘要', '按轮切分'],
  story,
  task,
  knowledge,
  hints: [
    '先数再发：`countTokens({ system, messages, tools: tools.map(t => t.spec) })`，大于 `maxContextTokens` 才压缩，没超就什么都不做。',
    '切分：先找出所有“轮起点”的下标（`role === "user"` 且不含 `tool_result`），`cut = starts[starts.length - keepLastTurns]`，然后 `slice(0, cut)` / `slice(cut)`。',
    '摘要是一次**独立**的 `chat()`：system 写“你是对话摘要助手……必须保留姓名、订单号、时间偏好”，user 消息放 `renderTranscript(older)`。',
    '压缩后：`this.messages = [{ role: "user", content: `${SUMMARY_PREFIX} ${summary}` }, ...recent]`；如果还超，就少保留一轮再压一次。',
  ],
  files: [{ path: 'session.ts', starter: starter['session.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
