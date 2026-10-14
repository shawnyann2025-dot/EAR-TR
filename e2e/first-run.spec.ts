import { test } from '@playwright/test'
import { firstRun } from './helpers'

test('首次使用：引导 → 跳过音域 → 首页', async ({ page }) => {
  await firstRun(page)
})
