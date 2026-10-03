import { LLMError, sleep } from 'agent-quest'

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export function isRetryable(e: unknown): boolean {
  // TODO：只有 LLMError 且 retryable === true 时可重试
  return false
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  // TODO：指数退避 + 抖动；不可重试的错误立即抛出；重试耗尽后抛出最后一个错误
  return fn()
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label = '操作'): Promise<T> {
  // TODO：用 sleep(ms, signal) 和 Promise.race 实现；结束后记得 abort 掉计时器
  return promise
}
