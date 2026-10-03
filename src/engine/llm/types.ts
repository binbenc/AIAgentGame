/**
 * 统一的 LLM 消息格式（厂商中立）。
 * 刻意贴近 Anthropic Messages API 的形状：content 是“块”的数组，
 * 工具调用 / 工具结果都是块。OpenAI 兼容接口由 adapter 负责转换。
 */

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

/** 厂商私有的块（例如 thinking），必须原样回传，不能修改。 */
export interface OpaqueBlock {
  type: 'opaque'
  provider: string
  raw: unknown
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | OpaqueBlock

export interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface JSONSchema {
  type?: string
  description?: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  enum?: unknown[]
  additionalProperties?: boolean
  [k: string]: unknown
}

export interface ToolSpec {
  name: string
  description: string
  input_schema: JSONSchema
}

/** 'default' / 'fast' 是模型档位，由设置页映射到具体模型 id；也可直接写模型 id。 */
export type ModelTier = 'default' | 'fast' | (string & {})

export interface ChatRequest {
  system?: string
  messages: Message[]
  tools?: ToolSpec[]
  max_tokens?: number
  model?: ModelTier
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'

export interface Usage {
  input_tokens: number
  output_tokens: number
}

export interface ChatResponse {
  content: ContentBlock[]
  stop_reason: StopReason
  usage: Usage
  model: string
}

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_input_delta'; id: string; partial_json: string }
  | { type: 'message_end'; response: ChatResponse }

export interface ChatOptions {
  signal?: AbortSignal
}

export interface Provider {
  readonly name: string
  chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse>
  stream(req: ChatRequest, opts?: ChatOptions): AsyncIterable<StreamEvent>
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

export class AbortError extends Error {
  constructor(message = '请求已取消') {
    super(message)
    this.name = 'AbortError'
  }
}

export function textOf(content: Message['content']): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

export function blocksOf(content: Message['content']): ContentBlock[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}
