import { LLMError, type ChatRequest, type ContentBlock } from './types'

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

function fail(msg: string): never {
  throw new LLMError(`400 invalid_request_error: ${msg}`, 400, false)
}

/**
 * 模拟真实 API 的请求校验。真实厂商会对这些错误返回 400，
 * 在这里提前、用中文报出来，帮助玩家理解协议约束。
 */
export function validateRequest(req: ChatRequest): void {
  if (!req || typeof req !== 'object') fail('请求必须是对象')
  if (!Array.isArray(req.messages) || req.messages.length === 0) fail('messages 不能为空')
  if (req.system !== undefined && typeof req.system !== 'string') fail('system 必须是字符串')
  if (req.max_tokens !== undefined && (!Number.isInteger(req.max_tokens) || req.max_tokens <= 0))
    fail('max_tokens 必须是正整数')

  const names = new Set<string>()
  for (const t of req.tools ?? []) {
    if (!t || typeof t.name !== 'string' || !TOOL_NAME.test(t.name))
      fail(`工具名 "${t?.name}" 不合法，只允许字母数字、下划线和连字符，最长 64`)
    if (names.has(t.name)) fail(`工具名 "${t.name}" 重复`)
    names.add(t.name)
    if (typeof t.description !== 'string') fail(`工具 ${t.name} 缺少 description`)
    if (!t.input_schema || t.input_schema.type !== 'object')
      fail(`工具 ${t.name} 的 input_schema 必须是 {"type":"object", ...}`)
  }

  if (req.messages[0].role !== 'user') fail('第一条消息必须是 user')

  let pendingToolUse: string[] = []
  req.messages.forEach((m, i) => {
    if (m.role !== 'user' && m.role !== 'assistant') fail(`messages[${i}].role 只能是 user 或 assistant`)
    if (typeof m.content !== 'string' && !Array.isArray(m.content))
      fail(`messages[${i}].content 必须是字符串或内容块数组`)
    if (typeof m.content === 'string' && m.content.length === 0) fail(`messages[${i}].content 不能是空字符串`)
    const blocks: ContentBlock[] = typeof m.content === 'string' ? [] : m.content
    if (Array.isArray(m.content) && m.content.length === 0) fail(`messages[${i}].content 不能是空数组`)

    if (pendingToolUse.length > 0) {
      if (m.role !== 'user')
        fail(`messages[${i}]：assistant 发起了工具调用后，下一条必须是 user 消息并带上 tool_result`)
      const ids = new Set(blocks.filter((b) => b.type === 'tool_result').map((b) => (b as { tool_use_id: string }).tool_use_id))
      const missing = pendingToolUse.filter((id) => !ids.has(id))
      if (missing.length) fail(`messages[${i}] 缺少这些 tool_use 的 tool_result：${missing.join(', ')}`)
    }
    pendingToolUse = []

    for (const b of blocks) {
      if (!b || typeof b !== 'object' || typeof (b as { type?: unknown }).type !== 'string')
        fail(`messages[${i}] 含有非法内容块`)
      if (b.type === 'tool_use') {
        if (m.role !== 'assistant') fail(`messages[${i}]：tool_use 块只能出现在 assistant 消息里`)
        pendingToolUse.push(b.id)
      } else if (b.type === 'tool_result') {
        if (m.role !== 'user') fail(`messages[${i}]：tool_result 块只能出现在 user 消息里`)
        if (typeof b.content !== 'string') fail(`messages[${i}]：tool_result.content 必须是字符串（对象请先 JSON.stringify）`)
        const prev = req.messages[i - 1]
        const prevIds =
          prev && Array.isArray(prev.content)
            ? prev.content.filter((x) => x.type === 'tool_use').map((x) => (x as { id: string }).id)
            : []
        if (!prevIds.includes(b.tool_use_id))
          fail(`messages[${i}]：tool_result 引用了未知的 tool_use_id "${b.tool_use_id}"（必须对应上一条 assistant 消息里的 tool_use）`)
      } else if (b.type === 'text') {
        if (typeof b.text !== 'string') fail(`messages[${i}]：text 块的 text 必须是字符串`)
      } else if (b.type !== 'opaque') {
        fail(`messages[${i}]：未知的内容块类型 "${(b as { type: string }).type}"`)
      }
    }
  })
  const last = req.messages[req.messages.length - 1]
  if (last.role !== 'user') fail('最后一条消息必须是 user（新模型不支持 assistant 预填充）')
}
