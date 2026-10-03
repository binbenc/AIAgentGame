import { LLMError, sleep } from 'agent-quest'

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export function isRetryable(e: unknown): boolean {
  return e instanceof LLMError && e.retryable
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 500, maxDelayMs = 8000 } = opts
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!isRetryable(e) || attempt >= retries) throw e
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) + Math.random() * baseDelayMs
      await sleep(Math.round(delay))
    }
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label = '操作'): Promise<T> {
  const timer = new AbortController()
  const timeout = sleep(ms, timer.signal).then(() => {
    throw new Error(`${label}超时（${ms}ms）`)
  })
  timeout.catch(() => {}) // 计时器被取消时会 reject，这里吞掉
  try {
    return await Promise.race([promise, timeout])
  } finally {
    timer.abort()
  }
}
