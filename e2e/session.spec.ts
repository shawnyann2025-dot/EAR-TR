import { expect, test } from '@playwright/test'
import { firstRun, startToday } from './helpers'

test('一场练习：开始 → 作答 → 提前结束 → 总结 → 首页', async ({ page }) => {
  await firstRun(page)
  await startToday(page).click()
  const end = page.getByRole('button', { name: '结束本场', exact: true })
  await expect(end).toBeVisible()
  // 任意作答：最多点 3 次可用的答案按钮（不判对错，只验证流程不卡死）；
  // 听题期间答案按钮是禁用的，所以要等它可用；等不到（如本题不是选择题）就跳过
  for (let i = 0; i < 3; i++) {
    const answer = page.locator('.answer-btn:enabled').first()
    try {
      await answer.waitFor({ state: 'visible', timeout: 15_000 })
      await answer.click({ timeout: 5_000 })
    } catch {
      break
    }
  }
  // 两步确认：首次点击变为「确定结束本场？」，4 秒内再点
  await page.getByRole('button', { name: '结束本场', exact: true }).click()
  await page.getByRole('button', { name: '确定结束本场？', exact: true }).click()
  await expect(page.getByRole('heading', { name: '今日总结' })).toBeVisible()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(page.getByRole('button', { name: /^(开始|继续)今天的练习$|^再练一场$/ })).toBeVisible()
})
