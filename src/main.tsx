import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import { App } from './App'
import { useProgress } from './state/progress'

// 调试/端到端测试用：在控制台里可以直接操作存档
;(window as unknown as { __agentQuest: unknown }).__agentQuest = { useProgress }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
