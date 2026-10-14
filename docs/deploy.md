# 部署与发布

网址：https://shawnyann2025-dot.github.io/EAR-TR/

## 一次性设置（仓库所有者）

1. GitHub 仓库 → Settings → Pages → Build and deployment → Source 选「GitHub Actions」。
2. Settings → Environments → github-pages：若「Deployment branches」有限制，加入要手动部署的分支（如 `p6-pwa-release`），或改为「No restriction」。

以上两项都必须在第一次推送 master / 第一次手动运行 deploy 之前完成，否则部署会失败。

## 自动发布

master 每次推送：先跑完 CI（类型、单元测试、构建、体积、e2e），通过后部署。

## 手动部署某个分支（真机验收用）

GitHub 仓库 → Actions → deploy → Run workflow → 选择分支 → Run。完成后网址即为该分支的版本。验收完记得重新部署 master（或下次 master 推送时自动覆盖）。

## 发布新版本

1. 改 `package.json` 的 `version`（语义化版本）。
2. 合入 master。已安装的用户回到首页时会看到「有新版本，点此更新」。
3. 验收清单里的「更新提示条」一项，需要开发者先改 `version` 并重新部署一次，测试者才能看到。

## 本地

- 开发：`npm run dev`（不启用离线缓存）。
- 生产预览：`npm run build && npx vite preview`。
- 按部署路径构建：`BASE_PATH=/EAR-TR/ npm run build`。在 Windows 的 Git Bash 里要写成 `MSYS_NO_PATHCONV=1 BASE_PATH=/EAR-TR/ npm run build`，否则 `/EAR-TR/` 会被转换成本机路径。
- e2e（可选）：`npx playwright install chromium webkit` 后 `npm run e2e`。
