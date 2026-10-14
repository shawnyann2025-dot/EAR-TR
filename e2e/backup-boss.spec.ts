import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { firstRun } from './helpers'

test('导出备份 → 导入实战关测试数据 → 完成一关', async ({ page }) => {
  await firstRun(page)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  const file = await (await dl).path()
  expect(JSON.parse(readFileSync(file, 'utf8')).schemaVersion).toBe(2)

  await page.locator('input[type=file]').setInputFiles('docs/fixtures/boss-ready-P1.json')
  await expect(page.getByText('导入成功', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()

  await page.getByRole('button', { name: '挑战实战关', exact: true }).click()
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await page.getByRole('button', { name: '播放整曲', exact: true }).click()
  await page.getByRole('button', { name: '开始作答', exact: true }).click()
  // P1：先答拍号题（任选第一个，不判对错）
  await expect(page.getByText('这首曲子是几拍子？（答后不能修改）')).toBeVisible()
  await page.locator('.answer-btn').first().click()

  // 逐句：每句填满每个作答组并提交，再点「下一句」/「提交关卡」
  const counter = page.locator('.topbar span')
  await expect(counter).toHaveText(/^第 1 \/ \d+ 句$/)
  const total = Number(/\/ (\d+) 句/.exec((await counter.textContent()) ?? '')![1])
  for (let i = 1; i <= total; i++) {
    const seqs = page.locator('.sequence')
    for (let left = await seqs.count(); left > 0; left--) {
      const seq = seqs.first()
      const btn = seq.locator('.answer-btn').first()
      while (await btn.isEnabled()) await btn.click()
      await seq.getByRole('button', { name: '提交', exact: true }).click()
      await expect(seqs).toHaveCount(left - 1)
    }
    await page.getByRole('button', { name: /^(下一句|提交关卡)$/ }).click()
    if (i < total) await expect(counter).toHaveText(`第 ${i + 1} / ${total} 句`)
  }
  await expect(page.getByRole('heading', { name: /^(通过！|这次没过)$/ })).toBeVisible()
})
