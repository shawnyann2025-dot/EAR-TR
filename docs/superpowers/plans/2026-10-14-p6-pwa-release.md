# P-6 PWA 化与发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 应用可安装、可离线、首页提示更新；GitHub Actions 跑单元测试、构建、包体积与 Playwright 手机视口 e2e，master 自动、任意分支手动部署到 GitHub Pages。

**Architecture:** `vite-plugin-pwa`（`registerType: 'prompt'`）生成 Service Worker 与 manifest；更新状态封装成纯接口 `UpdatePort`（`src/ui/pwa.tsx`），只有 `main.tsx` 接触虚拟模块 `virtual:pwa-register`；首页订阅它显示横幅。持久化请求与版本号是设置页的小改动。CI/部署是两份 workflow；e2e 在 `e2e/` 用 Playwright 跑生产构建的本地预览。

**Tech Stack:** React 19、TypeScript、Vite 8、vitest、vite-plugin-pwa 2.x、@playwright/test、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-10-14-p6-pwa-release-design.md`

## Global Constraints

- 网址 `https://shawnyann2025-dot.github.io/EAR-TR/`；`base` 读环境变量 `BASE_PATH`，默认 `'/'`；部署时 `BASE_PATH=/EAR-TR/`。
- `registerType: 'prompt'`；开发模式不启用 Service Worker；不缓存外部请求。
- 更新横幅文案「有新版本，点此更新」，**只在首页**显示；练习、实战关、音域测试、设置页不显示。
- 定期检查新版本：每 60 分钟一次 + 回到前台时一次。
- manifest：`name`/`short_name`「练耳」、`lang: 'zh-CN'`、`display: 'standalone'`、`orientation: 'portrait'`、`theme_color: '#2f6fde'`、`background_color: '#fafaf7'`、`start_url: './'`、`scope: './'`。
- 设置页显示「版本 {__APP_VERSION__} · 数据格式 v{SCHEMA_VERSION}」与持久化状态三种文案之一：「存储：已持久化」/「存储：未持久化（系统空间紧张时可能被清理，请定期导出备份）」/「浏览器不支持持久化，请定期导出备份」。
- 首屏入口 JS gzip ≤ **150 KB**。
- e2e：两个项目 `iphone`（WebKit，`devices['iPhone 13']`）与 `pixel`（Chromium，`devices['Pixel 7']`）；预览端口 4173；四条流程见 Task 5。
- 不加 `data-testid`，除非控件没有可读名称；唱歌部分不进 e2e。
- 依赖：只新增 `vite-plugin-pwa`、`workbox-window`（插件 peer）、`@vite-pwa/assets-generator`（仅生成图标时用）、`@playwright/test`；不新增运行时依赖以外的东西。
- 测试命令：`npx vitest run`、`npx tsc --noEmit`、`npm run build`；组件测试首行 `// @vitest-environment jsdom`。
- 每个任务结束提交一次，提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾；不提交 `.superpowers/`，不 `git add -f`；不推送（推送由控制者在用户授权后做）。

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `vite.config.ts`（改）、`src/vite-env.d.ts`（改） | 版本号注入、base、PWA 插件 | 1、2 |
| `src/ui/persistence.ts` | 请求与查询持久化存储 | 1 |
| `src/ui/pages/Settings.tsx`、`src/ui/App.tsx`（改） | 版本与持久化显示；启动后请求持久化 | 1 |
| `public/icon.svg`、`public/*.png`、`public/favicon.ico`、`pwa-assets.config.ts`、`index.html`（改） | 图标与 iOS meta | 2 |
| `src/build/pwaBuild.test.ts` | 构建产物检查（manifest、sw 预缓存） | 2 |
| `src/ui/pwa.tsx`、`src/main.tsx`（改）、`src/ui/pages/Home.tsx`、`src/ui/App.tsx`（改） | 更新端口与首页横幅 | 3 |
| `scripts/check-size.mjs`、`scripts/sizeCheck.mjs` | 包体积检查 | 4 |
| `playwright.config.ts`、`e2e/*.spec.ts`、`e2e/helpers.ts`、`e2e/tsconfig.json` | 端到端测试 | 5 |
| `.github/workflows/ci.yml`、`.github/workflows/deploy.yml` | CI 与部署 | 6 |
| 文档 | 验收清单、写回、部署说明 | 7 |

---

### Task 1: 版本号与持久化存储

**Files:**
- Modify: `vite.config.ts`、`src/vite-env.d.ts`、`src/ui/pages/Settings.tsx`、`src/ui/App.tsx`
- Create: `src/ui/persistence.ts`
- Test: `src/ui/persistence.test.ts`、`src/ui/pages/settingsInfo.test.tsx`

**Interfaces:**
- Produces:
  - 全局常量 `__APP_VERSION__: string`（构建与 vitest 都 define）
  - `type PersistState = 'persisted' | 'notPersisted' | 'unsupported'`
  - `requestPersistence(storage?: Pick<StorageManager, 'persist'>): Promise<void>`——不抛错
  - `persistenceState(storage?: Pick<StorageManager, 'persisted'>): Promise<PersistState>`——不抛错
  - `PERSIST_TEXT: Record<PersistState, string>`

- [ ] **Step 1: 写失败的测试**

`src/ui/persistence.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { PERSIST_TEXT, persistenceState, requestPersistence } from './persistence'

describe('持久化存储（P-6 spec §3.4）', () => {
  it('请求一次；失败不抛错；API 不存在时静默', async () => {
    const persist = vi.fn(async () => true)
    await requestPersistence({ persist })
    expect(persist).toHaveBeenCalledTimes(1)
    await expect(requestPersistence({ persist: async () => { throw new Error('x') } })).resolves.toBeUndefined()
    await expect(requestPersistence(undefined)).resolves.toBeUndefined()
  })
  it('三种状态', async () => {
    expect(await persistenceState({ persisted: async () => true })).toBe('persisted')
    expect(await persistenceState({ persisted: async () => false })).toBe('notPersisted')
    expect(await persistenceState(undefined)).toBe('unsupported')
    expect(await persistenceState({ persisted: async () => { throw new Error('x') } })).toBe('unsupported')
  })
  it('文案', () => {
    expect(PERSIST_TEXT).toEqual({
      persisted: '存储：已持久化',
      notPersisted: '存储：未持久化（系统空间紧张时可能被清理，请定期导出备份）',
      unsupported: '浏览器不支持持久化，请定期导出备份',
    })
  })
})
```

`src/ui/pages/settingsInfo.test.tsx`：沿用 `src/ui/pages/pages.test.tsx` 里搭 `boot` + `MemoryRepository` + 假音频 + 假 mic 并渲染 `Shell` 的写法（复制它的 setup，不要 import 测试文件），进入设置页后断言：

```tsx
expect(await screen.findByText(`版本 ${__APP_VERSION__} · 数据格式 v2`)).toBeTruthy()
expect(await screen.findByText(/存储：|浏览器不支持持久化/)).toBeTruthy()
```

（jsdom 没有 `navigator.storage`，所以实际显示「浏览器不支持持久化，请定期导出备份」；直接断言这一条。）

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/ui/persistence.test.ts src/ui/pages/settingsInfo.test.tsx`
Expected: FAIL —— 模块不存在 / `__APP_VERSION__` 未定义

- [ ] **Step 3: 写实现**

`vite.config.ts`（保留现有内容，增加 define 与 base）：

```ts
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

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
```

（`vite.config.ts` 在 tsconfig 的 include 里；项目没装 `@types/node`，但 `src/storage/fixtures.node.d.ts` 已在同一个 TS 程序里声明了全局 `process` 与 `node:fs` 的 `readFileSync(path, 'utf8')`，所以上面的写法能通过类型检查。若 `new URL(...)` 作为参数类型不符，改为 `readFileSync('./package.json', 'utf8')`（Vite 以项目根为 cwd 加载配置）。）

`src/vite-env.d.ts` 追加：

```ts
declare const __APP_VERSION__: string
```

`src/ui/persistence.ts`：

```ts
export type PersistState = 'persisted' | 'notPersisted' | 'unsupported'

export const PERSIST_TEXT: Record<PersistState, string> = {
  persisted: '存储：已持久化',
  notPersisted: '存储：未持久化（系统空间紧张时可能被清理，请定期导出备份）',
  unsupported: '浏览器不支持持久化，请定期导出备份',
}

const browserStorage = (): StorageManager | undefined => (typeof navigator === 'undefined' ? undefined : navigator.storage)

/** 请系统别清理本站数据（iOS 尤其需要）；结果不影响启动 */
export async function requestPersistence(storage: Pick<StorageManager, 'persist'> | undefined = browserStorage()): Promise<void> {
  try {
    await storage?.persist?.()
  } catch {
    // 忽略：持久化只是降低被清理的概率
  }
}

export async function persistenceState(storage: Pick<StorageManager, 'persisted'> | undefined = browserStorage()): Promise<PersistState> {
  try {
    if (!storage?.persisted) return 'unsupported'
    return (await storage.persisted()) ? 'persisted' : 'notPersisted'
  } catch {
    return 'unsupported'
  }
}
```

注意：测试里显式传 `undefined` 时，默认参数会生效、读 `navigator.storage`——jsdom 与 node 环境下它不存在，结果仍是 `unsupported` / 静默，测试成立。

`src/ui/App.tsx`：boot 成功（`result.kind === 'ready'`）后请求一次：

```tsx
  useEffect(() => {
    if (result?.kind === 'ready') void requestPersistence()
  }, [result])
```

`src/ui/pages/Settings.tsx`：

```tsx
import { SCHEMA_VERSION } from '../../storage/types'
import { PERSIST_TEXT, persistenceState, type PersistState } from '../persistence'
// 组件内：
  const [persist, setPersist] = useState<PersistState | null>(null)
  useEffect(() => {
    let alive = true
    void persistenceState().then((s) => { if (alive) setPersist(s) })
    return () => { alive = false }
  }, [])
// 在备份 section 之后：
      <section className="about">
        {persist && <p className="small">{PERSIST_TEXT[persist]}</p>}
        <p className="small">版本 {__APP_VERSION__} · 数据格式 v{SCHEMA_VERSION}</p>
      </section>
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 全部 PASS；构建成功

- [ ] **Step 5: 提交**

```bash
git add vite.config.ts src/vite-env.d.ts src/ui/persistence.ts src/ui/persistence.test.ts src/ui/pages/Settings.tsx src/ui/pages/settingsInfo.test.tsx src/ui/App.tsx
git commit -m "feat(ui): 设置页显示版本与数据格式；启动后请求持久化存储" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: PWA 插件、manifest 与图标

**Files:**
- Modify: `package.json`、`vite.config.ts`、`index.html`
- Create: `public/icon.svg`、`pwa-assets.config.ts`、生成的 `public/pwa-192x192.png`、`public/pwa-512x512.png`、`public/maskable-icon-512x512.png`、`public/apple-touch-icon-180x180.png`、`public/favicon.ico`
- Test: `src/build/pwaBuild.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `vite.config.ts`（`base` 与 define）
- Produces: 构建产物 `dist/sw.js`、`dist/manifest.webmanifest`、`dist/registerSW.js` 不生成（`injectRegister: false`）；虚拟模块 `virtual:pwa-register` 可被 `main.tsx` 使用（Task 3）

- [ ] **Step 1: 安装依赖**

```bash
npm install -D vite-plugin-pwa@^2 workbox-window@^7 @vite-pwa/assets-generator
```

若 `@vite-pwa/assets-generator` 因 `sharp` 原生模块装不上：先不装它，继续后续步骤，图标改走 Step 3 的退路，并在报告里写明。

- [ ] **Step 2: 写失败的测试**

`src/build/pwaBuild.test.ts`——对 `dist/` 做断言（测试运行前需 `npm run build`；测试自己不构建）。为了不让 `npx vitest run` 在没有 dist 时失败，dist 不存在时整组 `skip`，并在 CI 里先构建再跑（Task 6 的 CI 顺序已保证：先 build 再跑一遍这个文件）：

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const has = existsSync('dist/index.html')

describe.skipIf(!has)('PWA 构建产物（P-6 spec §3）', () => {
  it('manifest：名称、相对 start_url/scope、standalone、竖屏、主题色、四个图标', () => {
    const m = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'))
    expect(m).toMatchObject({ name: '练耳', short_name: '练耳', lang: 'zh-CN', display: 'standalone', orientation: 'portrait', theme_color: '#2f6fde', background_color: '#fafaf7', start_url: './', scope: './' })
    expect(m.icons.map((i: { src: string }) => i.src)).toEqual(expect.arrayContaining(['pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png']))
  })
  it('sw.js 存在，预缓存包含入口、worklet、worker、图标', () => {
    const sw = readFileSync('dist/sw.js', 'utf8')
    const assets = readdirSync('dist/assets')
    for (const prefix of ['index-', 'pitchWorklet-', 'pitchWorker-', 'micPlatform-']) {
      const f = assets.find((a) => a.startsWith(prefix) && a.endsWith('.js'))
      expect(f, prefix).toBeTruthy()
      expect(sw).toContain(`assets/${f}`)
    }
    expect(sw).toContain('pwa-192x192.png')
  })
  it('index.html：manifest、apple-touch-icon、iOS meta', () => {
    const html = readFileSync('dist/index.html', 'utf8')
    expect(html).toContain('manifest.webmanifest')
    expect(html).toContain('apple-touch-icon-180x180.png')
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"')
    expect(html).toContain('name="apple-mobile-web-app-title" content="练耳"')
  })
})
```

（`node:fs` 的类型：`src/storage/fixtures.node.d.ts` 已声明 `readFileSync`、`writeFileSync`、`mkdirSync`；在该文件里追加 `existsSync(path: string): boolean` 与 `readdirSync(path: string): string[]`。）

Run: `npm run build && npx vitest run src/build/pwaBuild.test.ts`
Expected: FAIL —— 没有 manifest / sw.js

- [ ] **Step 3: 图标**

`public/icon.svg`（简单图形：圆角方块主题色底 + 白色八分音符）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#2f6fde"/>
  <path d="M300 112v214a70 70 0 1 1-40-63V160l-60 16v-48z" fill="#fff" transform="translate(16 32)"/>
</svg>
```

`pwa-assets.config.ts`：

```ts
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/icon.svg'],
})
```

生成并提交 PNG：

```bash
npx pwa-assets-generator
ls public
```

Expected: `public/` 下出现 `pwa-64x64.png`、`pwa-192x192.png`、`pwa-512x512.png`、`maskable-icon-512x512.png`、`apple-touch-icon-180x180.png`、`favicon.ico`。

**退路**（生成器装不上或运行失败）：在 Task 6 的 CI 里加一个只在手动触发时运行的 job 生成图标并上传为构件；本任务先提交 `icon.svg` 与 `pwa-assets.config.ts`，manifest 照常引用 PNG 文件名，`pwaBuild.test.ts` 的图标断言保持不变——它会在 CI 构建前缺 PNG 时失败，提醒补齐。把这一情况写进报告，控制者会裁定。

- [ ] **Step 4: 写实现**

`vite.config.ts` 增加插件（`plugins: [react(), VitePWA({...})]`）：

```ts
import { VitePWA } from 'vite-plugin-pwa'
// ...
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: '练耳',
        short_name: '练耳',
        lang: 'zh-CN',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#2f6fde',
        background_color: '#fafaf7',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
```

（`devOptions` 不写——默认开发模式不启用。）

`index.html` 的 `<head>` 增加：

```html
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="练耳" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

（以 `/` 开头的 `index.html` 资源路径由 Vite 按 `base` 自动改写；构建后检查 `BASE_PATH=/EAR-TR/ npm run build` 产出的 `dist/index.html` 里是 `/EAR-TR/favicon.ico`。manifest 链接由插件注入。）

- [ ] **Step 5: 运行，确认通过**

```bash
npm run build && npx vitest run src/build/pwaBuild.test.ts
BASE_PATH=/EAR-TR/ npm run build && grep -o '/EAR-TR/[a-z-]*\.\(ico\|png\|webmanifest\)' dist/index.html | sort -u
npx vitest run && npx tsc --noEmit
```

**类型冲突提醒**：若新装的依赖间接带来了 `@types/node`（`ls node_modules/@types/node` 存在），`src/storage/fixtures.node.d.ts` 里的全局 `process` 与 `node:fs` 声明会与之冲突——此时删除该文件、确认 `npx tsc --noEmit` 通过，并在报告里写明。

Expected: 构建检查 PASS；第二条列出 `/EAR-TR/` 前缀的 favicon、apple-touch-icon、manifest；全量 PASS。最后再跑一次 `npm run build`（不带 BASE_PATH）恢复默认产物。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json vite.config.ts index.html public pwa-assets.config.ts src/build src/storage/fixtures.node.d.ts
git commit -m "feat(pwa): Service Worker 预缓存、manifest、图标与 iOS meta" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 更新端口与首页横幅

**Files:**
- Create: `src/ui/pwa.tsx`
- Modify: `src/main.tsx`、`src/ui/App.tsx`、`src/ui/pages/Home.tsx`
- Test: `src/ui/pwa.test.ts`、`src/ui/pages/updateBanner.test.tsx`

**Interfaces:**
- Consumes: Task 2 的虚拟模块 `virtual:pwa-register`（`registerSW(opts): (reload?: boolean) => Promise<void>`）
- Produces:
  - `export interface UpdatePort { readonly needRefresh: boolean; subscribe(fn: () => void): () => void; apply(): Promise<void> }`
  - `export type RegisterSW = (opts: { onNeedRefresh?: () => void; onRegisteredSW?: (url: string, r: ServiceWorkerRegistration | undefined) => void }) => (reload?: boolean) => Promise<void>`
  - `export function createUpdatePort(register: RegisterSW, env?: { setInterval: typeof setInterval; document: Pick<Document, 'addEventListener' | 'visibilityState'> }): UpdatePort`
  - `export const NO_UPDATES: UpdatePort`（永不需要更新；测试与 `#dev` 用）
  - `export const UPDATE_CHECK_MS = 60 * 60 * 1000`
  - `UpdateProvider({ port, children })`、`useUpdatePort(): UpdatePort`（无 Provider 时返回 `NO_UPDATES`）
  - `App(props: { updates?: UpdatePort })`

- [ ] **Step 1: 写失败的测试**

`src/ui/pwa.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { createUpdatePort, NO_UPDATES, UPDATE_CHECK_MS, type RegisterSW } from './pwa'

function fakes() {
  let opts: Parameters<RegisterSW>[0] = {}
  const update = vi.fn(async () => {})
  const updateSW = vi.fn(async () => {})
  const register: RegisterSW = (o) => { opts = o; return updateSW }
  const timers: (() => void)[] = []
  const listeners: Record<string, () => void> = {}
  const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: (t: string, fn: () => void) => { listeners[t] = fn } }
  const env = { setInterval: ((fn: () => void, ms: number) => { expect(ms).toBe(UPDATE_CHECK_MS); timers.push(fn); return 0 }) as unknown as typeof setInterval, document: doc as never }
  return { register, env, fire: () => opts.onNeedRefresh?.(), registered: () => opts.onRegisteredSW?.('sw.js', { update } as never), update, updateSW, timers, listeners }
}

describe('UpdatePort（P-6 spec §3.3）', () => {
  it('收到新版本：needRefresh 变真并通知订阅者；apply 激活并刷新', async () => {
    const f = fakes()
    const port = createUpdatePort(f.register, f.env)
    const seen = vi.fn()
    port.subscribe(seen)
    expect(port.needRefresh).toBe(false)
    f.fire()
    expect(port.needRefresh).toBe(true)
    expect(seen).toHaveBeenCalledTimes(1)
    await port.apply()
    expect(f.updateSW).toHaveBeenCalledWith(true)
  })
  it('注册后每 60 分钟、回到前台时各检查一次', () => {
    const f = fakes()
    createUpdatePort(f.register, f.env)
    f.registered()
    expect(f.timers).toHaveLength(1)
    f.timers[0]()
    expect(f.update).toHaveBeenCalledTimes(1)
    f.listeners.visibilitychange()
    expect(f.update).toHaveBeenCalledTimes(2)
  })
  it('退订后不再通知；NO_UPDATES 永远为假', () => {
    const f = fakes()
    const port = createUpdatePort(f.register, f.env)
    const seen = vi.fn()
    port.subscribe(seen)()
    f.fire()
    expect(seen).not.toHaveBeenCalled()
    expect(NO_UPDATES.needRefresh).toBe(false)
  })
})
```

`src/ui/pages/updateBanner.test.tsx`：沿用 `pages.test.tsx` 的 boot setup，用一个可控的假端口：

```tsx
function fakePort() {
  let need = false
  const subs = new Set<() => void>()
  const apply = vi.fn(async () => {})
  return {
    port: { get needRefresh() { return need }, subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn) }, apply },
    fire() { need = true; subs.forEach((f) => f()) },
    apply,
  }
}
```

渲染 `<UpdateProvider port={p.port}><RuntimeProvider ...><Shell storageWarning={null} /></RuntimeProvider></UpdateProvider>`，用例：

1. 首页：`act(() => p.fire())` 后出现按钮「有新版本，点此更新」；点击后 `p.apply` 被调用一次。
2. 进入设置页后 `p.fire()`：设置页没有该按钮；返回首页后出现。
3. 开始一场练习（进入练习页）后 `p.fire()`：练习页没有该按钮。

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/ui/pwa.test.ts src/ui/pages/updateBanner.test.tsx`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/pwa.tsx`：

```tsx
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

export const UPDATE_CHECK_MS = 60 * 60 * 1000

export interface UpdatePort {
  readonly needRefresh: boolean
  subscribe(fn: () => void): () => void
  apply(): Promise<void>
}

export type RegisterSW = (opts: {
  onNeedRefresh?: () => void
  onRegisteredSW?: (url: string, r: ServiceWorkerRegistration | undefined) => void
}) => (reload?: boolean) => Promise<void>

export const NO_UPDATES: UpdatePort = { needRefresh: false, subscribe: () => () => {}, apply: async () => {} }

/** 包装 vite-plugin-pwa 的 registerSW：新版本就绪时置 needRefresh；apply 激活新 SW 并刷新（P-6 spec §3.3） */
export function createUpdatePort(
  register: RegisterSW,
  env: { setInterval: typeof setInterval; document: Pick<Document, 'addEventListener' | 'visibilityState'> } = { setInterval, document },
): UpdatePort {
  let need = false
  const subs = new Set<() => void>()
  const updateSW = register({
    onNeedRefresh() {
      need = true
      subs.forEach((f) => f())
    },
    onRegisteredSW(_url, r) {
      if (!r) return
      const check = () => void r.update().catch(() => {})
      env.setInterval(check, UPDATE_CHECK_MS)
      env.document.addEventListener('visibilitychange', () => {
        if (env.document.visibilityState === 'visible') check()
      })
    },
  })
  return {
    get needRefresh() {
      return need
    },
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    apply: () => updateSW(true),
  }
}

const UpdateCtx = createContext<UpdatePort>(NO_UPDATES)

export function UpdateProvider(props: { port: UpdatePort; children: ReactNode }) {
  return <UpdateCtx.Provider value={props.port}>{props.children}</UpdateCtx.Provider>
}

export function useUpdatePort(): UpdatePort {
  return useContext(UpdateCtx)
}

export function useNeedRefresh(): boolean {
  const port = useUpdatePort()
  return useSyncExternalStore((fn) => port.subscribe(fn), () => port.needRefresh)
}
```

（文件含 JSX，所以是 `.tsx`；测试的 import 路径 `./pwa` 照常解析。）

`src/main.tsx`：

```tsx
import './ui/styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './ui/App'
import { createUpdatePort, NO_UPDATES } from './ui/pwa'

// #dev 是音色调试页，不注册 Service Worker，避免调试时被旧缓存困住
const updates = location.hash === '#dev' ? NO_UPDATES : createUpdatePort(registerSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App updates={updates} />
  </StrictMode>,
)
```

`src/vite-env.d.ts` 追加 `/// <reference types="vite-plugin-pwa/client" />`（提供 `virtual:pwa-register` 类型）。

`src/ui/App.tsx`：`export function App(props: { updates?: UpdatePort })`；把 ready 分支包进 `<UpdateProvider port={props.updates ?? NO_UPDATES}>`。

`src/ui/pages/Home.tsx`：

```tsx
import { useNeedRefresh, useUpdatePort } from '../pwa'
// 组件内：
  const updates = useUpdatePort()
  const needRefresh = useNeedRefresh()
// 在 topbar 之后、error 之前：
      {needRefresh && (!snap.session || snap.session.phase === 'done') && (
        <button type="button" className="banner update" onClick={() => void updates.apply()}>有新版本，点此更新</button>
      )}
```

（会话条件是 spec §3.3 的防御性检查：Shell 只在没有进行中会话、或总结已关闭时渲染首页；已结束（`phase === 'done'`）的会话不算进行中。）

`src/ui/styles.css` 追加：

```css
.banner.update { width: 100%; background: var(--accent); color: #fff; border-color: transparent; }
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 全部 PASS；构建成功（`virtual:pwa-register` 能解析）

- [ ] **Step 5: 提交**

```bash
git add src/ui/pwa.tsx src/ui/pwa.test.ts src/ui/pages/updateBanner.test.tsx src/main.tsx src/ui/App.tsx src/ui/pages/Home.tsx src/ui/styles.css src/vite-env.d.ts
git commit -m "feat(pwa): 新版本只在首页提示，点了才更新；每小时与回到前台时检查" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 包体积检查

**Files:**
- Create: `scripts/sizeCheck.mjs`（纯函数）、`scripts/check-size.mjs`（命令行入口）
- Modify: `package.json`（`"size"` 脚本）
- Test: `src/build/sizeCheck.test.ts`

**Interfaces:**
- Produces:
  - `export const LIMIT_GZIP_BYTES = 150 * 1024`
  - `export function entryScripts(indexHtml: string): string[]`——`<script type="module" ... src="...">` 的 src（去掉开头的 base 路径，返回相对 dist 的路径，如 `assets/index-abc.js`）
  - `export function checkSize(distDir: string, limit?: number): { file: string; gzipBytes: number; ok: boolean }[]`
  - `npm run size`：打印每个入口的 gzip 大小，任一超限退出码 1

- [ ] **Step 1: 写失败的测试**

`src/build/sizeCheck.test.ts`：

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error 纯 JS 模块，无类型声明
import { checkSize, entryScripts, LIMIT_GZIP_BYTES } from '../../scripts/sizeCheck.mjs'

describe('包体积检查（P-6 spec §4.3）', () => {
  it('从 index.html 找入口脚本，去掉 base 前缀', () => {
    const html = '<script type="module" crossorigin src="/EAR-TR/assets/index-abc.js"></script><link rel="modulepreload" href="/x.js">'
    expect(entryScripts(html)).toEqual(['assets/index-abc.js'])
    expect(entryScripts('<script type="module" src="/assets/a.js"></script>')).toEqual(['assets/a.js'])
  })
  it('阈值 150 KB；超限与不超限', () => {
    expect(LIMIT_GZIP_BYTES).toBe(150 * 1024)
    const dir = 'node_modules/.tmp-size-test'
    mkdirSync(`${dir}/assets`, { recursive: true })
    writeFileSync(`${dir}/index.html`, '<script type="module" src="/assets/a.js"></script>')
    writeFileSync(`${dir}/assets/a.js`, 'x'.repeat(10_000))
    const [r] = checkSize(dir, 1000)
    expect(r.file).toBe('assets/a.js')
    expect(r.ok).toBe(r.gzipBytes <= 1000)
    expect(checkSize(dir, 10)[0].ok).toBe(false)
  })
})
```

（`node:fs` 类型由 `src/storage/fixtures.node.d.ts` 提供；Task 2 已补 `existsSync`、`readdirSync`。）

Run: `npx vitest run src/build/sizeCheck.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 2: 写实现**

`scripts/sizeCheck.mjs`：

```js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

export const LIMIT_GZIP_BYTES = 150 * 1024

/** index.html 里直接执行的入口脚本（相对 dist 的路径）；按需加载的 chunk、worker、worklet 不算首屏 */
export function entryScripts(indexHtml) {
  const out = []
  for (const m of indexHtml.matchAll(/<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/g)) {
    out.push(m[1].replace(/^.*?(assets\/)/, '$1'))
  }
  return out
}

export function checkSize(distDir, limit = LIMIT_GZIP_BYTES) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8')
  return entryScripts(html).map((file) => {
    const gzipBytes = gzipSync(readFileSync(join(distDir, file))).length
    return { file, gzipBytes, ok: gzipBytes <= limit }
  })
}
```

`scripts/check-size.mjs`：

```js
import { checkSize, LIMIT_GZIP_BYTES } from './sizeCheck.mjs'

const results = checkSize('dist')
for (const r of results) console.log(`${r.ok ? 'OK ' : 'TOO BIG'} ${r.file} ${(r.gzipBytes / 1024).toFixed(1)} KB gzip (limit ${LIMIT_GZIP_BYTES / 1024} KB)`)
if (results.length === 0 || results.some((r) => !r.ok)) process.exit(1)
```

`package.json` 的 `scripts` 增加 `"size": "node scripts/check-size.mjs"`。

- [ ] **Step 3: 运行，确认通过**

```bash
npx vitest run src/build/sizeCheck.test.ts
npm run build && npm run size
npx vitest run && npx tsc --noEmit
```

Expected: PASS；`npm run size` 打印一行 `OK  assets/index-*.js ~106 KB gzip`，退出码 0。

- [ ] **Step 4: 提交**

```bash
git add scripts src/build/sizeCheck.test.ts package.json
git commit -m "build: 首屏入口 JS gzip 体积检查（≤ 150 KB）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Playwright 端到端测试

**Files:**
- Modify: `package.json`（`@playwright/test`、`"e2e"` 脚本）、`.gitignore`
- Create: `playwright.config.ts`、`e2e/tsconfig.json`、`e2e/helpers.ts`、`e2e/first-run.spec.ts`、`e2e/session.spec.ts`、`e2e/backup-boss.spec.ts`、`e2e/offline.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 Service Worker；`docs/fixtures/boss-ready-P1.json`（已存在）
- Produces: `npm run e2e`；Task 6 的 CI 调用 `npx playwright test`

**本地运行说明**：Playwright 浏览器要下载（数百 MB），本任务的实现者**可以**在本机运行 `npx playwright install chromium webkit` 来验证（这是开发依赖的正常安装，不是用户数据）。若下载被拒绝或失败，写完代码后只做 `npx tsc -p e2e` 类型检查并在报告里写明「e2e 未在本地运行，待 CI 验证」。

- [ ] **Step 1: 安装与配置**

```bash
npm install -D @playwright/test
```

`package.json` 的 `scripts` 增加 `"e2e": "playwright test"`。`.gitignore` 增加：

```
/test-results/
/playwright-report/
```

`playwright.config.ts`：

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
```

（`playwright.config.ts` 不在主 tsconfig 的 include 里，由 `e2e/tsconfig.json` 覆盖。）

`e2e/tsconfig.json`：

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "types": ["node"], "noEmit": true },
  "include": ["./**/*.ts", "../playwright.config.ts"]
}
```

（`@playwright/test` 自带 `@types/node` 依赖；若 `types: ["node"]` 找不到，去掉该行，Playwright 的类型已足够。）

- [ ] **Step 2: 公共步骤**

`e2e/helpers.ts`：

```ts
import { expect, type Page } from '@playwright/test'

/** 首次使用：跳过分级 → 开始练习 → 跳过音域 → 首页；随后把唱题判定改成自评，避免 e2e 里请求麦克风 */
export async function firstRun(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '跳过，从头开始' }).click()
  await page.getByRole('button', { name: '开始练习' }).click()
  await page.getByRole('button', { name: '跳过，以后再测' }).click()
  await expect(page.getByRole('button', { name: '开始今天的练习' })).toBeVisible()
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByLabel('自评').check()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始今天的练习' })).toBeVisible()
}
```

- [ ] **Step 3: 四条流程**

`e2e/first-run.spec.ts`：

```ts
import { test } from '@playwright/test'
import { firstRun } from './helpers'

test('首次使用：引导 → 跳过音域 → 首页', async ({ page }) => {
  await firstRun(page)
})
```

`e2e/session.spec.ts`：

```ts
import { expect, test } from '@playwright/test'
import { firstRun } from './helpers'

test('一场练习：开始 → 作答 → 提前结束 → 总结 → 首页', async ({ page }) => {
  await firstRun(page)
  await page.getByRole('button', { name: '开始今天的练习' }).click()
  const end = page.getByRole('button', { name: '结束本场' })
  await expect(end).toBeVisible()
  // 任意作答：最多点 3 次可用的答案按钮（不判对错，只验证流程不卡死）
  for (let i = 0; i < 3; i++) {
    const answer = page.locator('.answer-btn:enabled').first()
    if (await answer.isVisible({ timeout: 10_000 }).catch(() => false)) await answer.click()
  }
  await page.getByRole('button', { name: '结束本场' }).click()
  await page.getByRole('button', { name: '确定结束本场？' }).click()
  await expect(page.getByRole('heading', { name: '今日总结' })).toBeVisible()
  await page.getByRole('button', { name: '回到首页' }).click()
  await expect(page.getByRole('button', { name: /练习/ })).toBeVisible()
})
```

`e2e/backup-boss.spec.ts`：

```ts
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { firstRun } from './helpers'

test('导出备份 → 导入实战关测试数据 → 完成一关', async ({ page }) => {
  await firstRun(page)
  await page.getByRole('button', { name: '设置' }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份' }).click()
  const file = await (await dl).path()
  expect(JSON.parse(readFileSync(file!, 'utf8')).schemaVersion).toBe(2)

  await page.locator('input[type=file]').setInputFiles('docs/fixtures/boss-ready-P1.json')
  await expect(page.getByText('导入成功')).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()

  await page.getByRole('button', { name: '挑战实战关' }).click()
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await page.getByRole('button', { name: '播放整曲' }).click()
  await page.getByRole('button', { name: '开始作答' }).click()
  // P1：拍号题，任选第一个
  await page.locator('.answer-btn').first().click()
  // 逐句：填满第一个作答组再提交，直到出现结果页
  for (let guard = 0; guard < 20; guard++) {
    if (await page.getByText(/换一段再试|通过！|今天的次数用完了/).isVisible().catch(() => false)) break
    const seq = page.locator('.sequence').first()
    if (await seq.isVisible().catch(() => false)) {
      const btn = seq.locator('.answer-btn').first()
      while (await btn.isEnabled()) await btn.click()
      await seq.getByRole('button', { name: '提交', exact: true }).click()
      continue
    }
    await page.getByRole('button', { name: /下一句|提交关卡/ }).click()
  }
  await expect(page.getByText(/换一段再试|通过！|今天的次数用完了/)).toBeVisible()
})
```

`e2e/offline.spec.ts`：

```ts
import { expect, test } from '@playwright/test'
import { firstRun } from './helpers'

test('离线：Service Worker 接管后断网刷新仍能打开，数据还在', async ({ page, context }) => {
  await firstRun(page)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  // 首次安装后页面未必被控制；刷新一次让 SW 接管
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const phase = await page.locator('.topbar span').first().textContent()
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.topbar span').first()).toHaveText(phase!)
  await expect(page.getByRole('button', { name: '开始今天的练习' })).toBeVisible()
})
```

- [ ] **Step 4: 运行**

```bash
npx tsc -p e2e --noEmit
npx playwright install chromium webkit
npm run e2e
```

Expected: 类型检查通过；8 个测试（4 流程 × 2 视口）通过。选择器与实际页面不符时按页面实际文字/结构修正选择器（不改应用代码，除非某控件没有可读名称——那时加 `aria-label` 并在报告里列出）。若无法在本地下载浏览器，只做类型检查并在报告里说明。

- [ ] **Step 5: 提交**

```bash
git add package.json package-lock.json .gitignore playwright.config.ts e2e
git commit -m "test(e2e): Playwright 手机视口——首次使用、一场练习、备份与实战关、离线" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: CI 与部署工作流

**Files:**
- Create: `.github/workflows/ci.yml`、`.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `npm run build`、`npm run size`、`npm run e2e`、`src/build/pwaBuild.test.ts`
- Produces: CI 在每次推送与 PR 运行；部署在 master 推送或手动触发时运行

- [ ] **Step 1: CI**

`.github/workflows/ci.yml`：

```yaml
name: ci
on:
  push:
  pull_request:
  workflow_call:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx tsc -p e2e --noEmit
      - run: npx vitest run
      - run: npm run build
      - run: npx vitest run src/build
      - run: npm run size
      - run: npx playwright install --with-deps chromium webkit
      - run: npx playwright test
        env:
          CI: 'true'
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            playwright-report
            test-results
          retention-days: 7
```

- [ ] **Step 2: 部署**

`.github/workflows/deploy.yml`：

```yaml
name: deploy
on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  checks:
    uses: ./.github/workflows/ci.yml

  build:
    needs: checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
        env:
          BASE_PATH: /EAR-TR/
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

（master 推送会同时触发 `ci` 与 `deploy`；`deploy` 内部再跑一遍 CI 作为门禁，这是有意的重复——部署绝不跳过检查。）

- [ ] **Step 3: 本地校验**

```bash
npx --yes yaml-lint .github/workflows/*.yml 2>/dev/null || node -e "for (const f of ['ci','deploy']) { const s = require('fs').readFileSync('.github/workflows/'+f+'.yml','utf8'); if (/\t/.test(s)) throw new Error(f+': tab'); console.log(f, 'ok', s.split('\n').length, 'lines') }"
```

Expected: 两个文件 ok（无 tab）。真正的验证在控制者推送分支后的 GitHub Actions 运行结果里。

- [ ] **Step 4: 提交**

```bash
git add .github
git commit -m "ci: GitHub Actions 测试、构建、体积、e2e；Pages 部署（master 自动、任意分支手动）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 验收清单、部署说明与写回

**Files:**
- Modify: `docs/superpowers/plans/2026-10-13-p3b-device-acceptance.md`、`docs/superpowers/specs/2026-08-24-ear-training-design.md`、`docs/superpowers/specs/2026-10-14-p6-pwa-release-design.md`、`docs/superpowers/plans/2026-10-12-roadmap.md`
- Create: `docs/deploy.md`

- [ ] **Step 1: 部署说明 `docs/deploy.md`**

```markdown
# 部署与发布

网址：https://shawnyann2025-dot.github.io/EAR-TR/

## 一次性设置（仓库所有者）

1. GitHub 仓库 → Settings → Pages → Build and deployment → Source 选「GitHub Actions」。
2. Settings → Environments → github-pages：若「Deployment branches」有限制，加入要手动部署的分支（如 `p6-pwa-release`），或改为「No restriction」。

## 自动发布

master 每次推送：先跑完 CI（类型、单元测试、构建、体积、e2e），通过后部署。

## 手动部署某个分支（真机验收用）

GitHub 仓库 → Actions → deploy → Run workflow → 选择分支 → Run。完成后网址即为该分支的版本。验收完记得重新部署 master（或下次 master 推送时自动覆盖）。

## 发布新版本

1. 改 `package.json` 的 `version`（语义化版本）。
2. 合入 master。已安装的用户回到首页时会看到「有新版本，点此更新」。

## 本地

- 开发：`npm run dev`（不启用离线缓存）。
- 生产预览：`npm run build && npx vite preview`。
- e2e（可选）：`npx playwright install chromium webkit` 后 `npm run e2e`。
```

- [ ] **Step 2: 真机验收清单**

第 0 节「准备」整节替换为：

```markdown
## 0. 准备

1. 手机浏览器打开 **https://shawnyann2025-dot.github.io/EAR-TR/** （开发者交付时会说明当前部署的是哪个版本；设置页底部能看到版本号）。请至少测一种：iPhone 的 Safari，或安卓的 Chrome（两种都测更好）。把手机型号和系统版本记在「结果」里。
2. **iPhone 请先把侧边的静音键拨到「关闭静音」（看不到橙色）**。静音键打开时网页声音会被整个静音，会误以为没声音。
3. 尽量用有线耳机。蓝牙耳机有延迟，会影响打拍题的判定；如果只能用蓝牙，请在「结果」里注明。
4. 第 1 节的音色调试页地址是 `https://shawnyann2025-dot.github.io/EAR-TR/#dev`。

> 开发者本地调试仍可用 `npm run dev` + 局域网地址，但局域网 http 下手机不给麦克风、不启用离线缓存，不能用于验收。
```

（第 1 节里的 `<地址>/#dev` 保持不变——第 0 节第 4 条已给出完整地址。）

第 8 节导入测试数据的说明改为：在电脑或手机上打开 `https://github.com/shawnyann2025-dot/EAR-TR/blob/<分支>/docs/fixtures/boss-ready-P1.json` → 右上角「Download raw file」下载，再到「设置 → 导入备份」选择它（其余照旧：先导出自己的备份，验收完再导入恢复）。

在「结果」之前插入第 9 节（编号按文件现有顺序接续）：

```markdown
## 9. 安装与离线（P-6）

iPhone 与安卓各做一遍：

- [ ] 添加到主屏幕（iPhone：Safari 分享 →「添加到主屏幕」；安卓：Chrome 菜单 →「安装应用」或「添加到主屏幕」），图标与名称「练耳」正确
- [ ] 从主屏幕打开：全屏，没有浏览器地址栏
- [ ] 开飞行模式，从主屏幕打开：能进首页、能开始练习、有声音
- [ ] 设置页底部显示「版本 …· 数据格式 v2」，以及存储是否已持久化
- [ ] 开发者发布一个新版本后（会通知你），回到首页出现「有新版本，点此更新」；练习进行中不出现；点了之后更新，之前的数据还在
- [ ] 关掉应用，隔一两天再打开，数据还在
- [ ] 从主屏幕打开时，唱的部分仍能收音（第 7 节任选两项重做）
- [ ] 点「播放」到听见声音，没有明显延迟（大约半秒以内）
```

- [ ] **Step 3: 写回**

主 spec 开头「目标平台」一行之后加：`**状态（P-6）**：已实现离线 PWA（vite-plugin-pwa，首页提示更新）、GitHub Pages 部署与 Playwright 手机视口 e2e；见 docs/superpowers/specs/2026-10-14-p6-pwa-release-design.md 与 docs/deploy.md。`

P-6 spec 末尾追加 `## 10. 状态`：已实现；列出与 spec 的偏差（若有，例如图标是否走了退路、e2e 是否已在 CI 跑通——留给控制者在执行后填写实际情况：本步骤只写「已实现，偏差见 SDD 账本裁定」）。

路线图 §1 表格 P-6 行之后不改；§2「P-6 PWA 化与发布」段末追加：`**状态**：已实现（分支 p6-pwa-release，待真机验收后与 P-3b–P-5b 一并合入）。`

- [ ] **Step 4: 完成检查**

```bash
npx vitest run
npx tsc --noEmit
npx tsc -p e2e --noEmit
npm run build && npx vitest run src/build && npm run size
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add docs
git commit -m "docs: 部署说明、真机验收改用 HTTPS 网址并新增安装与离线一节、写回" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 完成标准

1. `npx vitest run`、`npx tsc --noEmit`、`npx tsc -p e2e --noEmit`、`npm run build`、`npm run size` 全部通过
2. 构建产物有 `sw.js` 与 manifest，预缓存含 worklet、worker；`BASE_PATH=/EAR-TR/` 构建的资源路径正确
3. 首页更新横幅、设置页版本与持久化有组件测试
4. 分支推送后 GitHub Actions 的 CI（含 e2e 两视口）通过——由控制者在用户授权推送后确认
5. 手动部署 `p6-pwa-release` 成功，网址可打开——由用户在设置好 Pages 来源后触发或授权控制者确认
6. 文档：部署说明、验收清单第 0、8、9 节、写回

## 下一步

用户用 HTTPS 网址完成真机验收第 0–9 节 → 修复失败项 → `p6-pwa-release`（含 P-3b–P-6）合入 master，自动发布正式版。
