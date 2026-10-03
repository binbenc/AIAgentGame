import Editor from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/Button'
import { CodeEditor, syncModels, uriOf } from './CodeEditor'
import { monaco } from './monaco'

type Mode = 'split' | 'diff'

const PREFS_KEY = 'aq.compare'
function loadPrefs(): { mode: Mode; sync: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return { mode: p.mode === 'diff' ? 'diff' : 'split', sync: p.sync !== false }
  } catch {
    return { mode: 'split', sync: true }
  }
}
function savePrefs(p: { mode: Mode; sync: boolean }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // 无痕模式等场景存不了，下次用默认值即可
  }
}

const EDITOR_OPTIONS = {
  fontSize: 13,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2,
  automaticLayout: true,
  fontFamily: "'JetBrains Mono', Menlo, monospace",
  padding: { top: 10 },
  unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
} as const

// 延迟销毁参考 model 的定时器：重新挂载（StrictMode 双调用、快速重开）时要取消，否则会销毁正在用的 model
let disposeTimer: ReturnType<typeof setTimeout> | undefined

function ensureModel(uri: monaco.Uri, content: string) {
  return monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, 'typescript', uri)
}

/** 差异视图：左边参考（只读），右边是玩家的文件（可编辑）。差异块旁的箭头可以把参考代码逐块合并过来 */
function DiffPane({ path, reference, onChange }: { path: string; reference: string; onChange(path: string, value: string): void }) {
  const el = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneDiffEditor>(null)
  const change = useRef(onChange)
  change.current = onChange

  useEffect(() => {
    const d = monaco.editor.createDiffEditor(el.current!, {
      ...EDITOR_OPTIONS,
      theme: 'vs-dark',
      originalEditable: false,
      renderMarginRevertIcon: true,
      useInlineViewWhenSpaceIsLimited: false,
    })
    editor.current = d
    return () => d.dispose()
  }, [])

  useEffect(() => {
    const original = ensureModel(uriOf(path, 'reference'), reference)
    const modified = ensureModel(uriOf(path), '')
    editor.current!.setModel({ original, modified })
    const sub = modified.onDidChangeContent(() => change.current(path, modified.getValue()))
    return () => sub.dispose()
  }, [path, reference])

  return <div ref={el} className="h-full" />
}

/**
 * 参考实现对照：并排（左边自己的代码、右边参考）或差异视图，两种模式可切换。
 * reference 是完整的参考工作区（保证参考代码里的 import 都能解析），highlight 是本关/本项目真正要看的文件。
 */
export function CompareView({
  files,
  active,
  setActive,
  onChange,
  reference,
  highlight,
  onClose,
}: {
  files: Record<string, string>
  active: string
  setActive(path: string): void
  onChange(path: string, value: string): void
  reference: Record<string, string>
  highlight: string[]
  onClose(): void
}) {
  const [prefs, setPrefs] = useState(loadPrefs)
  const { mode, sync } = prefs
  const [refPath, setRefPath] = useState(() => (active in reference ? active : highlight[0]))
  const [copied, setCopied] = useState(false)
  const update = (p: Partial<typeof prefs>) => {
    const next = { ...prefs, ...p }
    setPrefs(next)
    savePrefs(next)
  }

  // 参考工作区的 model 只在对照期间存在，关闭后销毁，避免占用类型检查的资源
  useEffect(() => {
    clearTimeout(disposeTimer)
    syncModels(reference, 'reference')
    return () => {
      // 等编辑器先卸载再销毁 model
      disposeTimer = setTimeout(() => {
        for (const m of monaco.editor.getModels()) if (m.uri.path.startsWith('/reference/')) m.dispose()
      })
    }
  }, [reference])
  // 差异视图里没有挂载普通编辑器，由这里负责把外部改动同步进 model
  useEffect(() => syncModels(files), [files])

  // 左边切换文件时，右边跟着切到同名的参考文件（差异视图总是同步）
  useEffect(() => {
    if ((sync || mode === 'diff') && active in reference) setRefPath(active)
  }, [active, sync, mode, reference])

  const pickRef = (p: string) => {
    setRefPath(p)
    if ((sync || mode === 'diff') && p in files) setActive(p)
  }

  const tabs = highlight.includes(refPath) ? highlight : [...highlight, refPath]
  const mine = files[refPath]

  async function copy() {
    try {
      await navigator.clipboard.writeText(reference[refPath])
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      alert('浏览器不允许写入剪贴板，可以在参考代码里选中后手动复制')
    }
  }

  function replace() {
    const target = mine === undefined ? `你的工作区还没有 ${refPath}，要用参考实现创建它吗？` : `用参考实现覆盖你的 ${refPath}？覆盖后可以在编辑器里按 Ctrl/Cmd+Z 撤销。`
    if (!confirm(target)) return
    const model = monaco.editor.getModel(uriOf(refPath))
    // 通过编辑操作替换（而不是 setValue），保留撤销栈
    if (model) {
      model.pushStackElement()
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: reference[refPath] }], () => null)
      model.pushStackElement()
    }
    onChange(refPath, reference[refPath])
    setActive(refPath)
  }

  const tab = (on: boolean) => `rounded px-2 py-0.5 text-xs ${on ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`

  const toolbar = (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-800 bg-slate-900/60 px-2 py-1">
      <span className="shrink-0 text-xs font-semibold text-amber-300">参考实现</span>
      {tabs.map((p) => (
        <button key={p} onClick={() => pickRef(p)} className={`shrink-0 font-mono ${tab(refPath === p)}`}>
          {p.replace(/^projects\//, '')}
        </button>
      ))}
      <div className="flex-1" />
      <div className="flex shrink-0 rounded-md border border-slate-700 p-0.5">
        <button className={tab(mode === 'split')} onClick={() => update({ mode: 'split' })}>
          并排
        </button>
        <button className={tab(mode === 'diff')} onClick={() => update({ mode: 'diff' })}>
          差异
        </button>
      </div>
      {mode === 'split' && (
        <label className="flex shrink-0 items-center gap-1 text-xs text-slate-400" title="切换左边的文件时，右边自动切到同名的参考文件">
          <input type="checkbox" checked={sync} onChange={(e) => update({ sync: e.target.checked })} />
          同步切换
        </label>
      )}
      <Button variant="ghost" className="shrink-0 !px-2 !py-0.5 !text-xs" onClick={copy}>
        {copied ? '已复制 ✓' : '复制'}
      </Button>
      <Button variant="ghost" className="shrink-0 !px-2 !py-0.5 !text-xs" onClick={replace} title="用参考实现替换你的同名文件（可撤销）">
        用参考替换
      </Button>
      <Button variant="ghost" className="shrink-0 !px-2 !py-0.5 !text-xs" onClick={onClose}>
        ✕ 关闭对照
      </Button>
    </div>
  )

  if (mode === 'diff')
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <div className="flex shrink-0 border-b border-slate-800 text-[11px] text-slate-500">
          <span className="flex-1 px-3 py-0.5">参考实现（只读）</span>
          <span className="flex-1 px-3 py-0.5">
            我的实现（可编辑）· 点中间的箭头可以逐块采用参考代码
            {mine === undefined && <span className="text-amber-400"> · 你的工作区还没有这个文件</span>}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <DiffPane path={refPath} reference={reference[refPath]} onChange={onChange} />
        </div>
      </div>
    )

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col border-r border-slate-700">
        <div className="shrink-0 border-b border-slate-800 bg-slate-900/60 px-3 py-[7px] text-xs text-slate-400">
          我的实现 · <span className="font-mono">{active.replace(/^projects\//, '')}</span>
        </div>
        <div className="min-h-0 flex-1">
          <CodeEditor files={files} active={active} onChange={onChange} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {toolbar}
        <div className="min-h-0 flex-1">
          <Editor
            theme="vs-dark"
            path={uriOf(refPath, 'reference').toString()}
            defaultLanguage="typescript"
            value={reference[refPath]}
            keepCurrentModel
            options={{ ...EDITOR_OPTIONS, readOnly: true, domReadOnly: true }}
          />
        </div>
      </div>
    </div>
  )
}
