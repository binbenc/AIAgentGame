/**
 * 时钟抽象。模拟模式下用虚拟时钟：sleep 不真的等待，但会按“到期时间”顺序唤醒，
 * 这样退避、超时、并行耗时都可测，而且跑得飞快。
 */
export interface Clock {
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

const macrotask: (fn: () => void) => void =
  typeof setImmediate === 'function' ? (fn) => setImmediate(fn) : (fn) => setTimeout(fn, 0)

interface Timer {
  due: number
  seq: number
  resolve: () => void
}

export class VirtualClock implements Clock {
  private t = 0
  private seq = 0
  private timers: Timer[] = []
  private scheduled = false

  now(): number {
    return this.t
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))
    return new Promise((resolve, reject) => {
      const timer: Timer = { due: this.t + Math.max(0, ms), seq: ++this.seq, resolve }
      this.timers.push(timer)
      signal?.addEventListener('abort', () => {
        this.timers = this.timers.filter((x) => x !== timer)
        reject(signal.reason ?? new Error('aborted'))
      })
      this.schedule()
    })
  }

  /** 等当前所有微任务跑完（系统“空闲”）后，唤醒最早到期的定时器 */
  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    macrotask(() => {
      this.scheduled = false
      if (this.timers.length === 0) return
      this.timers.sort((a, b) => a.due - b.due || a.seq - b.seq)
      const next = this.timers.shift()!
      this.t = Math.max(this.t, next.due)
      next.resolve()
      if (this.timers.length) this.schedule()
    })
  }
}

export class RealClock implements Clock {
  private start = Date.now()
  now(): number {
    return Date.now() - this.start
  }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
      const timer = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('aborted'))
      })
    })
  }
}
