import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import { App } from './App'
import { useProgress } from './state/progress'
import { L, LOCALE } from './engine/locale'

document.documentElement.lang = LOCALE === 'en' ? 'en' : 'zh-CN'
document.title = L('Agent Quest · AI Agent 工程闯关', 'Agent Quest · Learn AI Agent Engineering')

// 调试/端到端测试用：在控制台里可以直接操作存档
;(window as unknown as { __agentQuest: unknown }).__agentQuest = { useProgress }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
