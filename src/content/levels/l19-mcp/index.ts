import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l19',
  number: 19,
  chapter: 5,
  title: 'MCP',
  tagline: '工具的“USB 接口”：一次实现，任何 Agent 都能接',
  concepts: ['Model Context Protocol', 'JSON-RPC 2.0', '握手与版本协商', 'isError vs 协议错误', '工具适配'],
  story,
  task,
  knowledge,
  hints: [
    '服务端先分流：`if (!("method" in msg)) return null`；`if (!("id" in msg)) return null`（通知不回复）。然后 `switch (method)`，成功返回 `{ jsonrpc: "2.0", id, result }`，失败返回 `{ jsonrpc: "2.0", id, error: { code, message } }`。',
    'tools/call 里用 try/catch 包住 `tool.run(params.arguments)`：成功 `{ content: [{ type: "text", text: toToolContent(out) }], isError: false }`；异常时同样返回 result，只是 `isError: true`。只有“工具不存在”才返回 `error: { code: -32602 }`。',
    '客户端：`const pending = new Map()`；`request()` 里 `const id = nextId++; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); transport.send({ jsonrpc: "2.0", id, method, params }) })`；`onMessage` 里按 `m.id` 取出 pending，有 `m.error` 就 reject。',
    '适配：`name: \\`${prefix}__${t.name}\\`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)`；`run: async (input) => { const r = await client.callTool(t.name, input); const text = r.content.map(c => c.text ?? "").join("\\n"); if (r.isError) throw new Error(text); return text }`。',
  ],
  files: [{ path: 'mcp.ts', starter: starter['mcp.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
