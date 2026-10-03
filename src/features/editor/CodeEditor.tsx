import Editor from '@monaco-editor/react'
import { useEffect } from 'react'
import { monaco } from './monaco'

/** 玩家的工作区在 file:///workspace/ 下；对照用的参考工作区在 file:///reference/ 下，两边的相对 import 各自解析 */
export type ModelRoot = 'workspace' | 'reference'

export const uriOf = (path: string, root: ModelRoot = 'workspace') => monaco.Uri.parse(`file:///${root}/${path}`)

/** 保证工作区里每个文件都有对应的 Monaco model，这样相对 import 的类型检查才能生效 */
export function syncModels(files: Record<string, string>, root: ModelRoot = 'workspace') {
  for (const [path, content] of Object.entries(files)) {
    const uri = uriOf(path, root)
    const model = monaco.editor.getModel(uri)
    if (!model) monaco.editor.createModel(content, 'typescript', uri)
    else if (model.getValue() !== content) model.setValue(content)
  }
}

export function CodeEditor({
  files,
  active,
  readOnly,
  onChange,
}: {
  files: Record<string, string>
  active: string
  readOnly?: boolean
  onChange(path: string, value: string): void
}) {
  useEffect(() => {
    syncModels(files)
  }, [files])

  return (
    <Editor
      theme="vs-dark"
      path={uriOf(active).toString()}
      defaultLanguage="typescript"
      value={files[active] ?? ''}
      onChange={(v) => onChange(active, v ?? '')}
      // model 由 syncModels 统一管理；编辑器卸载时不要销毁（对照模式会在两种编辑器之间切换）
      keepCurrentModel
      options={{
        readOnly,
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        fontFamily: "'JetBrains Mono', Menlo, monospace",
        padding: { top: 10 },
        // 中文注释里的全角标点不是“可疑字符”
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
      }}
    />
  )
}
