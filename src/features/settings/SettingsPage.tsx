import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PRESETS } from '../../engine/llm/providers/config'
import { createProvider } from '../../engine/sandbox/host'
import { useProgress, type SaveData } from '../../state/progress'
import { useSettings } from '../../state/settings'
import { Button } from '../../ui/Button'

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-slate-500">{help}</span>}
    </label>
  )
}

const input = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-violet-500'

export function SettingsPage() {
  const { t } = useTranslation()
  const s = useSettings()
  const progress = useProgress()
  const [test, setTest] = useState<{ ok: boolean; msg: string }>()
  const [testing, setTesting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const preset = PRESETS[s.preset]

  async function testConnection() {
    const cfg = s.effectiveProvider()
    if (!cfg) return setTest({ ok: false, msg: '请先填写 API Key' })
    setTesting(true)
    setTest(undefined)
    try {
      const res = await createProvider(cfg).chat({ messages: [{ role: 'user', content: '只回复两个字：你好' }], max_tokens: 1024, model: 'fast' })
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      setTest({ ok: true, msg: `连接成功（${res.model}）：${text.slice(0, 60)} · ${res.usage.input_tokens}+${res.usage.output_tokens} tokens` })
    } catch (e) {
      setTest({ ok: false, msg: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  function exportSave() {
    const { version, files, levels, borrowed } = useProgress.getState()
    const blob = new Blob([JSON.stringify({ version, files, levels, borrowed }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `agent-quest-save-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importSave(file: File) {
    try {
      const data = JSON.parse(await file.text()) as SaveData
      if (data.version !== 1 || typeof data.files !== 'object') throw new Error('不是有效的存档文件')
      progress.importSave(data)
      alert('导入成功')
    } catch (e) {
      alert(`导入失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 px-6 py-10">
        <h1 className="text-2xl font-bold text-white">{t('settings.title')}</h1>

        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <div>
            <h2 className="font-semibold text-white">真实模型</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              判题默认使用确定性的模拟模型，免费且结果稳定。配置真实模型后，可以用「真实模型运行」拿实战徽章。
              Key 只保存在你的浏览器里：请求从页面直接发往厂商（或者你自己的本地代理），玩家代码所在的沙箱拿不到 Key。
            </p>
          </div>
          <Field label={t('settings.provider')}>
            <select className={input} value={s.preset} onChange={(e) => s.applyPreset(e.target.value)}>
              {Object.entries(PRESETS).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                  {p.cors ? '' : '（需要代理）'}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.apiKey')}>
            <input
              className={input}
              type="password"
              autoComplete="off"
              value={s.provider.apiKey}
              placeholder={preset?.kind === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
              onChange={(e) => s.updateProvider({ apiKey: e.target.value.trim() })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={s.rememberKey} onChange={(e) => s.update({ rememberKey: e.target.checked })} />
            {t('settings.remember')}
          </label>
          {s.provider.kind === 'openai' && (
            <Field label={t('settings.baseURL')}>
              <input className={input} value={s.provider.baseURL ?? ''} onChange={(e) => s.updateProvider({ baseURL: e.target.value.trim() })} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.modelDefault')}>
              <input className={input} value={s.provider.models.default} onChange={(e) => s.updateProvider({ models: { ...s.provider.models, default: e.target.value.trim() } })} />
            </Field>
            <Field label={t('settings.modelFast')}>
              <input className={input} value={s.provider.models.fast} onChange={(e) => s.updateProvider({ models: { ...s.provider.models, fast: e.target.value.trim() } })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={s.useProxy} onChange={(e) => s.update({ useProxy: e.target.checked })} />
            {t('settings.proxy')}
          </label>
          {s.useProxy && (
            <Field label={t('settings.proxyUrl')} help={<>{t('settings.proxyHelp')}</>}>
              <input className={input} value={s.proxyUrl} onChange={(e) => s.update({ proxyUrl: e.target.value.trim() })} />
            </Field>
          )}
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={testConnection} disabled={testing}>
              {testing ? '测试中…' : t('settings.test')}
            </Button>
            {test && <span className={`text-xs ${test.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{test.msg}</span>}
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="font-semibold text-white">游戏</h2>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={s.freeMode} onChange={(e) => s.update({ freeMode: e.target.checked })} />
            {t('settings.freeMode')}
          </label>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="font-semibold text-white">{t('settings.data')}</h2>
          <p className="text-xs text-slate-400">进度和代码保存在浏览器的 IndexedDB 里。换电脑或清理浏览器数据前，请先导出存档。</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportSave}>{t('settings.export')}</Button>
            <Button onClick={() => fileRef.current?.click()}>{t('settings.import')}</Button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importSave(e.target.files[0])} />
            <Button variant="danger" onClick={() => confirm(t('settings.resetConfirm')) && progress.resetAll()}>
              {t('settings.reset')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
