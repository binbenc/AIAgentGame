import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { AGENT_QUEST_DTS } from './typings'

// 使用本地打包的 monaco（不依赖 CDN，内网也能用）
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

const ts = monaco.typescript
ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  strict: true,
  noImplicitAny: false,
  allowNonTsExtensions: true,
  lib: ["es2022", "dom"],
})
ts.typescriptDefaults.addExtraLib(AGENT_QUEST_DTS, 'file:///node_modules/@types/agent-quest/index.d.ts')

loader.config({ monaco })

export { monaco }
