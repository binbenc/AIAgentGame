/**
 * The agent-quest runtime for Node: reads the real model config from environment variables.
 * Your code depends only on the thin 'agent-quest' facade (chat / chatStream / sleep / log ...),
 * so moving to any SDK means replacing just this layer.
 */
import { RealClock } from './engine/clock'
import { Gateway } from './engine/llm/gateway'
import { AnthropicProvider } from './engine/llm/providers/anthropic'
import type { ProviderConfig, WireListener } from './engine/llm/providers/config'
import { OpenAIProvider } from './engine/llm/providers/openai'
import type { Provider } from './engine/llm/types'
import { __setRuntime } from './engine/runtime/api'
import { Trace, type TraceEvent } from './engine/trace'

export function configFromEnv(env = process.env): ProviderConfig {
  const kind = env.LLM_PROVIDER === 'openai' ? 'openai' : 'anthropic'
  const apiKey = env.LLM_API_KEY ?? (kind === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY) ?? ''
  if (!apiKey && !env.LLM_BASE_URL?.includes('127.0.0.1')) throw new Error('LLM_API_KEY is missing (see .env.example)')
  return {
    kind,
    apiKey,
    baseURL: env.LLM_BASE_URL || undefined,
    models: {
      default: env.LLM_MODEL_DEFAULT ?? (kind === 'anthropic' ? 'claude-opus-5-5' : 'gpt-5'),
      fast: env.LLM_MODEL_FAST ?? (kind === 'anthropic' ? 'claude-haiku-4-5' : 'gpt-5-mini'),
    },
  }
}

export function providerFromEnv(onWire?: WireListener): Provider {
  const cfg = configFromEnv()
  return cfg.kind === 'anthropic' ? new AnthropicProvider(cfg, onWire) : new OpenAIProvider(cfg, onWire)
}

/** Install the real-model runtime. Returns the trace so you can print each step. */
export function useRealModel(opts: { maxCalls?: number; onEvent?: (e: TraceEvent) => void } = {}): Trace {
  const trace = new Trace(opts.onEvent)
  const clock = new RealClock()
  __setRuntime({ gateway: new Gateway(providerFromEnv(), trace, clock, { maxCalls: opts.maxCalls ?? 50 }), clock, trace })
  return trace
}
