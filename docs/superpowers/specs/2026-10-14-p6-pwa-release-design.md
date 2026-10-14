# P-6 PWA 化与发布 · 设计文档

> 主 spec：`docs/superpowers/specs/2026-08-24-ear-training-design.md` 开头「目标平台：移动端优先的 PWA（纯前端、可离线、本地存储）」与技术选型表「存储：纯前端 PWA + IndexedDB」。路线图：`docs/superpowers/plans/2026-10-12-roadmap.md` §2「P-6」。
> 基于分支 `p5b-boss-ui`（P-3b、P-4b、P-5a、P-5b 尚待真机验收）。本阶段分支：`p6-pwa-release`。

## 1. 目标

把应用变成可安装、可离线、能自动发布的 PWA：GitHub Pages 用 HTTPS 提供网址，CI 在每次推送时跑单元测试、构建、包体积检查和 Playwright 手机视口端到端测试；master 有推送就自动发布。顺带解决真机验收的老问题：局域网 http 下手机不给麦克风、不启用离线缓存，所以改用部署出来的 HTTPS 网址验收。

## 2. 已确认的决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **发布到 GitHub Pages**，用 GitHub Actions 构建部署；网址 `https://shawnyann2025-dot.github.io/EAR-TR/` | 仓库已在 GitHub；免费、HTTPS |
| D2 | **首页提示，点了才更新**：新版本在后台下载好后，只在首页显示「有新版本，点此更新」；练习、实战关、音域测试进行中绝不打断 | 学习过程不能被刷新打断 |
| D3 | **端到端测试在 GitHub Actions 里跑**，本地可选 | 用户电脑不必下载浏览器内核 |
| D4 | **master 推送自动部署；另可在 Actions 页面手动部署任意分支**到同一网址 | 合入前就能用 HTTPS 网址做真机验收 |
| D5 | **用 `vite-plugin-pwa`**（2.x，支持 Vite 8），`registerType: 'prompt'` | 预缓存清单与版本切换是成熟实现；手写 Service Worker 出错时用户直接打不开 |

## 3. 离线与安装

### 3.1 Service Worker 与预缓存

- `vite.config.ts` 加 `VitePWA({ registerType: 'prompt', injectRegister: false, manifest, workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] } })`。预缓存覆盖构建产物的全部文件，包括音频 worklet（`pitchWorklet-*.js`）、音高检测 worker（`pitchWorker-*.js`）、按需加载的 `micPlatform-*.js`。
- 不缓存任何外部请求（应用没有网络依赖）。
- 开发模式（`npm run dev`）不启用 Service Worker（插件默认 `devOptions.enabled = false`），避免开发时被旧缓存困住。
- 测试环境（vitest）不加载插件的虚拟模块：注册逻辑放在 `src/ui/pwa.ts`，对 `virtual:pwa-register` 的引用只出现在 `main.tsx` 的组合根里，其余代码只依赖 `pwa.ts` 的纯接口。

### 3.2 Manifest 与图标

- `name`「练耳」、`short_name`「练耳」、`lang: 'zh-CN'`、`display: 'standalone'`、`orientation: 'portrait'`、`theme_color` 与 `background_color` 取现有主题色 `#2f6fde` 与页面背景色、`start_url: './'`、`scope: './'`。
- 图标：手写一份 `public/icon.svg`（简单的音符或耳朵图形），用 `@vite-pwa/assets-generator`（开发依赖，只在生成时用）一次性生成 `pwa-192x192.png`、`pwa-512x512.png`、`maskable-icon-512x512.png`、`apple-touch-icon-180x180.png`、`favicon.ico`，**生成的 PNG 提交进仓库**；平时构建不运行生成器。若生成器在本机装不上（它依赖 `sharp` 原生模块），改为在 CI 一次性生成后由开发者下载提交——计划里写明这条退路。
- `index.html` 加 `<link rel="icon">`、`<link rel="apple-touch-icon">`、`<meta name="apple-mobile-web-app-capable" content="yes">`、`<meta name="apple-mobile-web-app-title" content="练耳">`、`<meta name="apple-mobile-web-app-status-bar-style" content="default">`。

### 3.3 更新提示

- `src/ui/pwa.ts` 导出 `UpdatePort { needRefresh: boolean; subscribe(fn): () => void; apply(): Promise<void> }` 与 `createUpdatePort(register)`：`register` 是 `virtual:pwa-register` 的 `registerSW`，测试里传假的。`onNeedRefresh` 置 `needRefresh = true` 并通知订阅者；`apply()` 调用 `updateSW(true)`（激活新 Service Worker 并刷新页面）。
- 端口经 `RuntimeProvider` 旁的新 context（或作为 `RuntimeProvider` 的可选属性）提供给页面；**只有首页**订阅并显示横幅「有新版本，点此更新」。其他页面不显示、不刷新。
- 首页只在没有进行中的会话时渲染（Shell 现有路由保证），所以点击更新不会丢进度；仍在 `apply()` 前确认 `snapshot.session` 为空或已结束，防御性再查一次。
- 定期检查新版本：注册后每 60 分钟调用一次 `registration.update()`，以及页面回到前台（`visibilitychange`）时检查一次。

### 3.4 数据保护

- 首次启动（`boot` 成功之后）调用一次 `navigator.storage?.persist?.()`；结果不阻塞启动。
- 设置页新增一行「存储：已持久化 / 未持久化（系统空间紧张时可能被清理，请定期导出备份）」，读 `navigator.storage?.persisted?.()`；API 不存在时显示「浏览器不支持持久化，请定期导出备份」。

### 3.5 版本号

- 构建时用 Vite `define` 把 `package.json` 的 `version` 注入为常量 `__APP_VERSION__`（在 `src/vite-env.d.ts` 声明类型；vitest 配置同样 define 一个值）。
- 设置页底部显示「版本 1.0.0 · 数据格式 v2」，数据格式取 `SCHEMA_VERSION`。两个数字各自演进，只并列显示。
- 首次发布版本号为现有的 `1.0.0`；之后每次发布前按语义化版本手动升级（发布说明写在部署清单里，不做自动化）。

### 3.6 部署路径

- Pages 网址有子路径 `/EAR-TR/`。`vite.config.ts` 的 `base` 读环境变量 `BASE_PATH`，默认 `'/'`；部署工作流设 `BASE_PATH=/EAR-TR/`。
- 应用全程用 hash 路由（`#dev` 等），子路径下不会出现 404；manifest 的 `start_url` 与 `scope` 用相对路径。
- 代码里所有静态资源引用都走 Vite 的导入或 `import.meta.env.BASE_URL`，不写死以 `/` 开头的路径（计划里逐个检查 worklet、worker 的加载方式）。

## 4. CI 与部署

### 4.1 CI（`.github/workflows/ci.yml`）

- 触发：推送任何分支、任何 PR。
- 步骤：`npm ci` → `npx tsc --noEmit` → `npx vitest run` → `npm run build` → 包体积检查（§4.3） → 安装 Playwright 浏览器（`npx playwright install --with-deps chromium webkit`）→ `npx playwright test`。
- 失败时上传 Playwright 报告（trace、截图）为构件，便于排查。

### 4.2 部署（`.github/workflows/deploy.yml`）

- 触发：master 推送；`workflow_dispatch`（在 Actions 页面手动运行，可选分支）。
- 先调用（`workflow_call` 复用）CI 的全部检查；通过后以 `BASE_PATH=/EAR-TR/` 构建，用 `actions/upload-pages-artifact` + `actions/deploy-pages` 发布。
- 权限：`pages: write`、`id-token: write`；并发组 `pages`，新部署取消排队中的旧部署。
- 一次性人工设置（只有仓库所有者能做）：仓库「Settings → Pages → Build and deployment → Source」选「GitHub Actions」。写进部署清单；首次部署前完成。若 `github-pages` 环境限制了可部署分支，同时在「Settings → Environments → github-pages」允许待验收分支。

### 4.3 包体积检查

- `scripts/check-size.mjs`（纯 Node，无依赖）：读 `dist/index.html` 里直接引用的入口 JS，gzip 后不得超过 **150 KB**（当前约 106 KB）；超了退出码非 0，CI 失败。按需加载的 chunk、worker、worklet 不计入首屏。
- `package.json` 增加脚本 `"size": "node scripts/check-size.mjs"`、`"e2e": "playwright test"`。

## 5. 端到端测试（`e2e/`）

- `playwright.config.ts`：两个项目——`iphone`（WebKit，`devices['iPhone 13']`）与 `pixel`（Chromium，`devices['Pixel 7']`）；`webServer` 运行 `npm run build && npx vite preview --port 4173 --strictPort`（预览在 localhost，Service Worker 可用）；`use.baseURL` 指向它。
- `vitest` 的 `include` 只匹配 `src/**`，`e2e/` 不进单元测试；`tsconfig` 覆盖 `e2e/`（或单独的 `e2e/tsconfig.json`），保证类型检查。
- 四条流程（每条一个 spec 文件，每个测试用全新的浏览器上下文，即全新的 IndexedDB）：
  1. **首次使用**（`first-run.spec.ts`）：打开 → 开屏引导走完 → 音域测试选「自己判断」→ 首页出现「开始今天的练习」。
  2. **一场练习**（`session.spec.ts`）：完成首次使用 → 开始今天的练习 → 对出现的题目任意作答 3 题（点第一个可用的答案按钮，打拍题跳过或点按）→ 提前结束 → 看到总结页 → 回首页。不判对错，只验证流程不卡死。
  3. **导出导入与实战关**（`backup-boss.spec.ts`）：完成首次使用 → 设置 → 导出备份（捕获下载，内容能被 `JSON.parse` 且 `schemaVersion` 为 2）→ 导入 `docs/fixtures/boss-ready-P1.json` → 首页出现「挑战实战关」→ 开始 → 播放整曲 → 开始作答 → 拍号题与每句都提交任意答案 → 看到结果页与「换一段再试」。
  4. **离线**（`offline.spec.ts`）：完成首次使用 → 等 `navigator.serviceWorker.ready` 且页面被 Service Worker 控制 → `context.setOffline(true)` → 刷新 → 首页照常显示、阶段与先前一致。
- 选择器优先用可见文字与 role（与组件测试一致），不加 `data-testid`，除非某个控件没有可读名称。
- 唱歌部分不进端到端测试（WebKit 无法模拟麦克风）；音频播放在无头浏览器里照常执行，测试不断言声音。
- 本地运行（可选）：`npx playwright install chromium webkit` 后 `npm run e2e`。

## 6. 真机验收清单（`docs/superpowers/plans/2026-10-13-p3b-device-acceptance.md`）

- 第 0 节改为：打开 HTTPS 网址 `https://shawnyann2025-dot.github.io/EAR-TR/`（部署哪个分支由开发者在交付时说明）；局域网 http 的做法降为「开发者本地调试」附注。删除「http 下可能不保持亮屏」一条。
- 第 8 节（实战关）的测试数据导入，改为说明从网址下载 `docs/fixtures/` 里的文件：在仓库页面打开该文件 →「Download raw file」，或开发者在交付时附上直链。
- 新增第 9 节「安装与离线（P-6）」，iPhone 与安卓各做一遍：
  - [ ] 添加到主屏幕（iPhone：Safari 分享 →「添加到主屏幕」；安卓：Chrome 菜单 →「安装应用」），图标与名称「练耳」正确
  - [ ] 从主屏幕打开：全屏，没有浏览器地址栏
  - [ ] 开飞行模式，从主屏幕打开：能进首页、能开始练习、有声音
  - [ ] 设置页显示版本号与「数据格式 v2」，以及存储是否已持久化
  - [ ] 开发者发布一个新版本后，回到首页出现「有新版本，点此更新」；练习进行中不出现；点了之后更新，数据还在
  - [ ] 关掉应用，隔一两天再打开，数据还在
  - [ ] 从主屏幕打开时，唱的部分仍能收音（第 7 节任选两项重做）
  - [ ] 点「播放」到听见声音，没有明显延迟（大约半秒以内）

## 7. 不做的事

- 推送通知、后台同步、应用商店上架。
- 自动版本号与发布说明生成。
- Lighthouse 评分门槛（体积检查已覆盖首屏主要风险）。
- 唱歌流程的自动化测试。

## 8. 测试

- 单元/组件（vitest）：`createUpdatePort` 的状态与订阅、`apply()` 调用；首页在 `needRefresh` 时显示横幅、点击调用 `apply()`、其他页面不显示；设置页显示版本号、数据格式、持久化状态（`navigator.storage` 存在 / 不存在两种）；`boot` 后请求持久化一次且失败不影响启动；`check-size.mjs` 的阈值判定（对一个临时目录造两个假入口文件，一个超限一个不超）。
- 端到端（Playwright，CI）：§5 四条流程 × 两个视口。
- 构建：`BASE_PATH=/EAR-TR/ npm run build` 后检查 `dist/manifest.webmanifest` 的 `start_url`/`scope` 为相对路径、`dist/sw.js` 存在且预缓存清单包含 worklet 与 worker 文件（由一个 vitest 构建检查测试或 CI 脚本断言，计划里定）。

## 9. 合入与发布顺序

1. 在 `p6-pwa-release` 上实施；开发期间把分支推到 GitHub，让 CI 跑端到端测试（推送需用户逐次或一次性授权）。
2. 用户在仓库设置里把 Pages 来源设为 GitHub Actions。
3. 手动部署 `p6-pwa-release`；用户用 HTTPS 网址做真机验收第 0–9 节。
4. 失败项在 `p6-pwa-release` 上修复、重新部署、复验。
5. 全部通过后，`p6-pwa-release`（含 P-3b 至 P-6）合入 master，自动发布正式版。
