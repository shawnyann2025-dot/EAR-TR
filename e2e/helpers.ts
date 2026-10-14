import { expect, type Page } from '@playwright/test'

export const startToday = (page: Page) => page.getByRole('button', { name: '开始今天的练习', exact: true })

/** 首次使用：跳过分级 → 开始练习 → 跳过音域 → 首页；随后把唱题判定改成自评，避免 e2e 里请求麦克风 */
export async function firstRun(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '跳过，从头开始', exact: true }).click()
  await page.getByRole('button', { name: '开始练习', exact: true }).click()
  await page.getByRole('button', { name: '跳过，以后再测', exact: true }).click()
  await expect(startToday(page)).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('自评', { exact: true }).check()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(startToday(page)).toBeVisible()
}
