import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: true },
  // dev 下 Vite 默认把 worker 打成 classic 脚本（以 importScripts 开头），AudioWorkletGlobalScope 没有它，addModule 会失败
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
