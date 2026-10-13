import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: true },
  // dev 下 Vite 默认把 worker 打成 classic 脚本（以 importScripts 开头），AudioWorkletGlobalScope 没有它，addModule 会失败
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
