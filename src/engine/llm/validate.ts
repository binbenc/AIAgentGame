import { LLMError, type ChatRequest, type ContentBlock } from './types'
import { L } from '../locale'

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

function fail(msg: string): never {
  throw new LLMError(`400 invalid_request_error: ${msg}`, 400, false)
}

/**
 * 模拟真实 API 的请求校验。真实厂商会对这些错误返回 400，
 * 在这里提前、用中文报出来，帮助玩家理解协议约束。
 */
export function validateRequest(req: ChatRequest): void {
  if (!req || typeof req !== 'object') fail(L('请求必须是对象', 'The request must be an object'))
  if (!Array.isArray(req.messages) || req.messages.length === 0) fail(L('messages 不能为空', 'messages must not be empty'))
  if (req.system !== undefined && typeof req.system !== 'string') fail(L('system 必须是字符串', 'system must be a string'))
  if (req.max_tokens !== undefined && (!Number.isInteger(req.max_tokens) || req.max_tokens <= 0))
    fail(L('max_tokens 必须是正整数', 'max_tokens must be a positive integer'))

  const names = new Set<string>()
  for (const t of req.tools ?? []) {
    if (!t || typeof t.name !== 'string' || !TOOL_NAME.test(t.name))
      fail(L(`工具名 "${t?.name}" 不合法，只允许字母数字、下划线和连字符，最长 64`, `Invalid tool name "${t?.name}": only letters, digits, underscores and hyphens, up to 64 characters`))
    if (names.has(t.name)) fail(L(`工具名 "${t.name}" 重复`, `Duplicate tool name "${t.name}"`))
    names.add(t.name)
    if (typeof t.description !== 'string') fail(L(`工具 ${t.name} 缺少 description`, `Tool ${t.name} is missing a description`))
    if (!t.input_schema || t.input_schema.type !== 'object')
      fail(L(`工具 ${t.name} 的 input_schema 必须是 {"type":"object", ...}`, `The input_schema of tool ${t.name} must be {"type":"object", ...}`))
  }

  if (req.messages[0].role !== 'user') fail(L('第一条消息必须是 user', 'The first message must be from user'))

  let pendingToolUse: string[] = []
  req.messages.forEach((m, i) => {
    if (m.role !== 'user' && m.role !== 'assistant') fail(L(`messages[${i}].role 只能是 user 或 assistant`, `messages[${i}].role must be user or assistant`))
    if (typeof m.content !== 'string' && !Array.isArray(m.content))
      fail(L(`messages[${i}].content 必须是字符串或内容块数组`, `messages[${i}].content must be a string or an array of content blocks`))
    if (typeof m.content === 'string' && m.content.length === 0) fail(L(`messages[${i}].content 不能是空字符串`, `messages[${i}].content must not be an empty string`))
    const blocks: ContentBlock[] = typeof m.content === 'string' ? [] : m.content
    if (Array.isArray(m.content) && m.content.length === 0) fail(L(`messages[${i}].content 不能是空数组`, `messages[${i}].content must not be an empty array`))

    if (pendingToolUse.length > 0) {
      if (m.role !== 'user')
        fail(L(`messages[${i}]：assistant 发起了工具调用后，下一条必须是 user 消息并带上 tool_result`, `messages[${i}]: after an assistant tool call, the next message must be a user message with the tool_result`))
      const ids = new Set(blocks.filter((b) => b.type === 'tool_result').map((b) => (b as { tool_use_id: string }).tool_use_id))
      const missing = pendingToolUse.filter((id) => !ids.has(id))
      if (missing.length) fail(L(`messages[${i}] 缺少这些 tool_use 的 tool_result：${missing.join(', ')}`, `messages[${i}] is missing tool_result for these tool_use ids: ${missing.join(', ')}`))
    }
    pendingToolUse = []

    for (const b of blocks) {
      if (!b || typeof b !== 'object' || typeof (b as { type?: unknown }).type !== 'string')
        fail(L(`messages[${i}] 含有非法内容块`, `messages[${i}] contains an invalid content block`))
      if (b.type === 'tool_use') {
        if (m.role !== 'assistant') fail(L(`messages[${i}]：tool_use 块只能出现在 assistant 消息里`, `messages[${i}]: tool_use blocks may only appear in assistant messages`))
        pendingToolUse.push(b.id)
      } else if (b.type === 'tool_result') {
        if (m.role !== 'user') fail(L(`messages[${i}]：tool_result 块只能出现在 user 消息里`, `messages[${i}]: tool_result blocks may only appear in user messages`))
        if (typeof b.content !== 'string') fail(L(`messages[${i}]：tool_result.content 必须是字符串（对象请先 JSON.stringify）`, `messages[${i}]: tool_result.content must be a string (JSON.stringify objects first)`))
        const prev = req.messages[i - 1]
        const prevIds =
          prev && Array.isArray(prev.content)
            ? prev.content.filter((x) => x.type === 'tool_use').map((x) => (x as { id: string }).id)
            : []
        if (!prevIds.includes(b.tool_use_id))
          fail(
          L(
            `messages[${i}]：tool_result 引用了未知的 tool_use_id "${b.tool_use_id}"（必须对应上一条 assistant 消息里的 tool_use）`,
            `messages[${i}]: tool_result references an unknown tool_use_id "${b.tool_use_id}" (it must match a tool_use in the previous assistant message)`,
          ),
        )
      } else if (b.type === 'text') {
        if (typeof b.text !== 'string') fail(L(`messages[${i}]：text 块的 text 必须是字符串`, `messages[${i}]: the text of a text block must be a string`))
      } else if (b.type !== 'opaque') {
        fail(L(`messages[${i}]：未知的内容块类型 "${(b as { type: string }).type}"`, `messages[${i}]: unknown content block type "${(b as { type: string }).type}"`))
      }
    }
  })
  const last = req.messages[req.messages.length - 1]
  if (last.role !== 'user') fail(L('最后一条消息必须是 user（新模型不支持 assistant 预填充）', 'The last message must be from user (newer models do not support assistant prefill)'))
}
