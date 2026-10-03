/**
 * Node 环境下的 agent-quest 运行时：从环境变量读取真实模型配置。
 * 你的代码只依赖 'agent-quest' 这个很薄的门面（chat / chatStream / sleep / log ...），
 * 迁移到任何 SDK 时，只需要替换这一层。
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
  if (!apiKey && !env.LLM_BASE_URL?.includes('127.0.0.1')) throw new Error('缺少 LLM_API_KEY（参考 .env.example）')
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

/** 安装真实模型运行时。返回 trace，便于打印每一步。 */
export function useRealModel(opts: { maxCalls?: number; onEvent?: (e: TraceEvent) => void } = {}): Trace {
  const trace = new Trace(opts.onEvent)
  const clock = new RealClock()
  __setRuntime({ gateway: new Gateway(providerFromEnv(), trace, clock, { maxCalls: opts.maxCalls ?? 50 }), clock, trace })
  return trace
}
