import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { 'agent-quest': fileURLToPath(new URL('./aq/engine/runtime/api.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 600_000 },
})
