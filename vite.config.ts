import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { 'agent-quest': fileURLToPath(new URL('./src/engine/runtime/api.ts', import.meta.url)) } },
  worker: { format: 'es' },
  // 沙箱 Worker 里的依赖要预先优化，否则开发模式下第一次运行会触发整页刷新
  optimizeDeps: { entries: ['index.html', 'src/engine/sandbox/worker.ts'], include: ['sucrase', 'zod', '@anthropic-ai/sdk', 'jszip', 'sql.js'] },
  test: {
    include: process.env.SCRIPT ? [`scripts/${process.env.SCRIPT}.test.ts`] : ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    // Integrity tests run once per locale (content picks its language at module load: src/engine/locale.ts).
    // Scripts (SCRIPT=...) run once, in AQ_LOCALE (default en).
    projects: process.env.SCRIPT
      ? undefined
      : (['en', 'zh'] as const).map((locale) => ({ extends: true as const, test: { name: locale, env: { AQ_LOCALE: locale } } })),
  },
})
