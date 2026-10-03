import { create } from 'zustand'
import { PRESETS, type ProviderConfig } from '../engine/llm/providers/config'

export interface Settings {
  preset: string
  provider: ProviderConfig
  /** true：Key 保存在本机 localStorage；false：只在本次会话内存里 */
  rememberKey: boolean
  useProxy: boolean
  proxyUrl: string
  /** 自由模式：不按顺序解锁关卡 */
  freeMode: boolean
}

const STORAGE = 'agent-quest:settings'

function defaults(): Settings {
  const p = PRESETS.anthropic
  return {
    preset: 'anthropic',
    provider: { kind: p.kind, apiKey: '', baseURL: p.baseURL, models: { ...p.models } },
    rememberKey: false,
    useProxy: false,
    proxyUrl: 'http://127.0.0.1:8787',
    freeMode: false,
  }
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (raw) return { ...defaults(), ...JSON.parse(raw) }
  } catch {
    /* 隐私模式等情况下 localStorage 不可用 */
  }
  return defaults()
}

function save(s: Settings) {
  try {
    const copy = { ...s, provider: { ...s.provider, apiKey: s.rememberKey ? s.provider.apiKey : '' } }
    localStorage.setItem(STORAGE, JSON.stringify(copy))
  } catch {
    /* ignore */
  }
}

interface SettingsStore extends Settings {
  update(patch: Partial<Settings>): void
  updateProvider(patch: Partial<ProviderConfig>): void
  applyPreset(id: string): void
  /** 实际用于请求的配置（叠加代理） */
  effectiveProvider(): ProviderConfig | undefined
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  update(patch) {
    set(patch)
    save(get())
  },
  updateProvider(patch) {
    set({ provider: { ...get().provider, ...patch } })
    save(get())
  },
  applyPreset(id) {
    const p = PRESETS[id]
    if (!p) return
    set({
      preset: id,
      provider: { kind: p.kind, apiKey: get().provider.apiKey, baseURL: p.baseURL, models: { ...p.models } },
      useProxy: !p.cors,
    })
    save(get())
  },
  effectiveProvider() {
    const s = get()
    if (!s.provider.apiKey && s.preset !== 'ollama') return undefined
    return { ...s.provider, proxy: s.useProxy ? s.proxyUrl : undefined }
  },
}))
