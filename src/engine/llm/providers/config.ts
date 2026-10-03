export type ProviderKind = 'anthropic' | 'openai'

export interface ProviderConfig {
  kind: ProviderKind
  apiKey: string
  /** OpenAI 兼容接口必填，例如 https://api.deepseek.com/v1；Anthropic 可留空 */
  baseURL?: string
  /** 模型档位到具体模型 id 的映射 */
  models: { default: string; fast: string }
  /** 可选的本地 CORS 代理地址，例如 http://127.0.0.1:8787 */
  proxy?: string
}

/** 记录发出的原始 HTTP 请求（不含密钥），用于 Trace 面板教学展示 */
export type WireListener = (wire: { url: string; body: unknown }) => void

export function resolveModel(cfg: ProviderConfig, tier: string | undefined): string {
  if (!tier || tier === 'default') return cfg.models.default
  if (tier === 'fast') return cfg.models.fast
  return tier
}

/** 经代理时把 https://host/path 改写成 http://proxy/https/host/path */
export function viaProxy(url: string, proxy?: string): string {
  if (!proxy) return url
  return proxy.replace(/\/+$/, '') + '/' + url.replace('://', '/')
}

export const PRESETS: Record<string, Omit<ProviderConfig, 'apiKey'> & { label: string; cors: boolean }> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    models: { default: 'claude-opus-5-5', fast: 'claude-haiku-4-5' },
    cors: true,
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseURL: 'https://api.openai.com/v1',
    models: { default: 'gpt-5', fast: 'gpt-5-mini' },
    cors: true,
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    models: { default: 'deepseek-chat', fast: 'deepseek-chat' },
    cors: false,
  },
  qwen: {
    label: '通义千问 (DashScope 兼容模式)',
    kind: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: { default: 'qwen-plus', fast: 'qwen-turbo' },
    cors: false,
  },
  moonshot: {
    label: 'Kimi (Moonshot)',
    kind: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    models: { default: 'kimi-latest', fast: 'kimi-latest' },
    cors: false,
  },
  ollama: {
    label: 'Ollama（本地）',
    kind: 'openai',
    baseURL: 'http://127.0.0.1:11434/v1',
    models: { default: 'qwen3:8b', fast: 'qwen3:8b' },
    cors: true,
  },
}
