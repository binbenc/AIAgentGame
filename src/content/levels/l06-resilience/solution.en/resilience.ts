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

export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Operation'): Promise<T> {
  const timer = new AbortController()
  const timeout = sleep(ms, timer.signal).then(() => {
    throw new Error(`${label} timed out after ${ms}ms`)
  })
  timeout.catch(() => {}) // the timer rejects when it is aborted; swallow that
  try {
    return await Promise.race([promise, timeout])
  } finally {
    timer.abort()
  }
}
