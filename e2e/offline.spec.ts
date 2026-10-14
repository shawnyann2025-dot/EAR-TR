import { expect, test } from '@playwright/test'
import { firstRun, startToday } from './helpers'

test('离线：Service Worker 接管后断网刷新仍能打开，数据还在', async ({ page, context }) => {
  await firstRun(page)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  // 首次安装后页面未必被控制；刷新一次让 SW 接管
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  // 首页 .topbar 的第一个 span 是阶段标签
  const phase = await page.locator('.topbar span').first().textContent()
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.topbar span').first()).toHaveText(phase!)
  await expect(startToday(page)).toBeVisible()
})
