import { L } from '../../engine/locale'

/** 注入 Monaco 的类型声明，让玩家写代码时有补全和类型检查。与 src/engine/runtime/api.ts 保持一致。 */
const ZH = `
declare module 'agent-quest' {
  export interface TextBlock { type: 'text'; text: string }
  export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
  export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  /** 厂商私有的块（例如 thinking），必须原样回传 */
  export interface OpaqueBlock { type: 'opaque'; provider: string; raw: unknown }
  export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | OpaqueBlock
  export interface Message { role: 'user' | 'assistant'; content: string | ContentBlock[] }
  export interface JSONSchema {
    type?: string; description?: string; properties?: Record<string, JSONSchema>; required?: string[]
    items?: JSONSchema; enum?: unknown[]; additionalProperties?: boolean; [k: string]: unknown
  }
  export interface ToolSpec { name: string; description: string; input_schema: JSONSchema }
  /** 'default' / 'fast' 是模型档位，在设置页映射到具体模型 */
  export type ModelTier = 'default' | 'fast' | (string & {})
  export interface ChatRequest { system?: string; messages: Message[]; tools?: ToolSpec[]; max_tokens?: number; model?: ModelTier }
  export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'
  export interface Usage { input_tokens: number; output_tokens: number }
  export interface ChatResponse { content: ContentBlock[]; stop_reason: StopReason; usage: Usage; model: string }
  export type StreamEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'tool_use_start'; id: string; name: string }
    | { type: 'tool_input_delta'; id: string; partial_json: string }
    | { type: 'message_end'; response: ChatResponse }
  export interface ChatOptions { signal?: AbortSignal }
  export interface ChatStream extends AsyncIterable<StreamEvent> { finalResponse(): Promise<ChatResponse> }

  /** 调用一次模型（非流式） */
  export function chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse>
  /** 流式调用：for await 迭代事件，或 await finalResponse() */
  export function chatStream(req: ChatRequest, opts?: ChatOptions): ChatStream
  /** 估算 token 数 */
  export function countTokens(input: string | Message | Message[] | ChatRequest): number
  /** 等待（模拟模式下是虚拟时间） */
  export function sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** 当前时间（毫秒，从场景开始计） */
  export function now(): number
  /** 写日志到 Trace 面板 */
  export function log(...args: unknown[]): void
  export function textOf(content: Message['content']): string
  export class LLMError extends Error {
    constructor(message: string, status: number, retryable: boolean)
    readonly status: number
    readonly retryable: boolean
  }
  export class AbortError extends Error { constructor(message?: string) }
}

declare module 'zod' {
  type Any = any
  interface ZodLike { [k: string]: Any; (...args: Any[]): Any }
  export const z: ZodLike
  export namespace z {
    type infer<T> = T extends { _output: infer O } ? O : Any
    type ZodType = Any
    type ZodTypeAny = Any
  }
  export default z
}
`

const EN = `
declare module 'agent-quest' {
  export interface TextBlock { type: 'text'; text: string }
  export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
  export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  /** Provider-specific blocks (e.g. thinking) — pass them back unchanged */
  export interface OpaqueBlock { type: 'opaque'; provider: string; raw: unknown }
  export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | OpaqueBlock
  export interface Message { role: 'user' | 'assistant'; content: string | ContentBlock[] }
  export interface JSONSchema {
    type?: string; description?: string; properties?: Record<string, JSONSchema>; required?: string[]
    items?: JSONSchema; enum?: unknown[]; additionalProperties?: boolean; [k: string]: unknown
  }
  export interface ToolSpec { name: string; description: string; input_schema: JSONSchema }
  /** 'default' / 'fast' are model tiers, mapped to concrete models in Settings */
  export type ModelTier = 'default' | 'fast' | (string & {})
  export interface ChatRequest { system?: string; messages: Message[]; tools?: ToolSpec[]; max_tokens?: number; model?: ModelTier }
  export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'
  export interface Usage { input_tokens: number; output_tokens: number }
  export interface ChatResponse { content: ContentBlock[]; stop_reason: StopReason; usage: Usage; model: string }
  export type StreamEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'tool_use_start'; id: string; name: string }
    | { type: 'tool_input_delta'; id: string; partial_json: string }
    | { type: 'message_end'; response: ChatResponse }
  export interface ChatOptions { signal?: AbortSignal }
  export interface ChatStream extends AsyncIterable<StreamEvent> { finalResponse(): Promise<ChatResponse> }

  /** Call the model once (non-streaming) */
  export function chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse>
  /** Streaming call: iterate events with for await, or await finalResponse() */
  export function chatStream(req: ChatRequest, opts?: ChatOptions): ChatStream
  /** Estimate the token count */
  export function countTokens(input: string | Message | Message[] | ChatRequest): number
  /** Wait (virtual time in mock mode) */
  export function sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** Current time (ms since the scenario started) */
  export function now(): number
  /** Write a log line to the Trace panel */
  export function log(...args: unknown[]): void
  export function textOf(content: Message['content']): string
  export class LLMError extends Error {
    constructor(message: string, status: number, retryable: boolean)
    readonly status: number
    readonly retryable: boolean
  }
  export class AbortError extends Error { constructor(message?: string) }
}

declare module 'zod' {
  type Any = any
  interface ZodLike { [k: string]: Any; (...args: Any[]): Any }
  export const z: ZodLike
  export namespace z {
    type infer<T> = T extends { _output: infer O } ? O : Any
    type ZodType = Any
    type ZodTypeAny = Any
  }
  export default z
}
`

export const AGENT_QUEST_DTS = L(ZH, EN)
