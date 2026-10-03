import type { ChatRequest, ContentBlock, Message } from './types'

/**
 * 确定性的 token 估算：CJK 字符按 1 token，其它字符按 4 字符 ≈ 1 token。
 * 真实 tokenizer 因模型而异，这里只用来让“上下文越长越贵”变得可量化。
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[　-鿿가-힯＀-￯]/.test(ch)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

function blockText(b: ContentBlock): string {
  switch (b.type) {
    case 'text':
      return b.text
    case 'tool_use':
      return b.name + JSON.stringify(b.input)
    case 'tool_result':
      return b.content
    case 'opaque':
      return ''
  }
}

export function messageTokens(m: Message): number {
  const text = typeof m.content === 'string' ? m.content : m.content.map(blockText).join('\n')
  return estimateTokens(text) + 4
}

export function requestTokens(req: ChatRequest): number {
  let n = req.system ? estimateTokens(req.system) : 0
  for (const m of req.messages) n += messageTokens(m)
  for (const t of req.tools ?? []) n += estimateTokens(t.name + t.description + JSON.stringify(t.input_schema))
  return n
}

export function contentTokens(content: ContentBlock[]): number {
  return estimateTokens(content.map(blockText).join('\n'))
}
