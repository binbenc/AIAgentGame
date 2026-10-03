import { LLMError, sleep } from 'agent-quest'

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export function isRetryable(e: unknown): boolean {
  // TODO: retry only when it is an LLMError with retryable === true
  return false
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  // TODO: exponential backoff + jitter; throw non-retryable errors immediately; once retries run out, throw the last error
  return fn()
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Operation'): Promise<T> {
  // TODO: build it with sleep(ms, signal) and Promise.race; abort the timer when done
  return promise
}
