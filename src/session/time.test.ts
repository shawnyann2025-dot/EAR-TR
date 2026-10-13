import { describe, expect, it } from 'vitest'
import { dayIndex, localDateString, sessionSeed } from './time'

describe('localDateString', () => {
  it('按本地年月日格式化，补零', () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localDateString(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })
})

describe('dayIndex', () => {
  it('同一天为 0，次日为 1', () => {
    expect(dayIndex('2026-10-13', '2026-10-13')).toBe(0)
    expect(dayIndex('2026-10-13', '2026-10-14')).toBe(1)
  })
  it('跨月、跨年、跨夏令时都按日历日计', () => {
    expect(dayIndex('2026-01-31', '2026-03-01')).toBe(29)
    expect(dayIndex('2025-12-31', '2026-01-01')).toBe(1)
    expect(dayIndex('2026-03-28', '2026-03-30')).toBe(2)
  })
  it('格式不对时抛错', () => {
    expect(() => dayIndex('2026/10/13', '2026-10-14')).toThrow()
  })
})

describe('sessionSeed', () => {
  it('确定性、非负整数，且随 profile、day、场次变化', () => {
    const s = sessionSeed('p1', 3, 0)
    expect(s).toBe(sessionSeed('p1', 3, 0))
    expect(Number.isInteger(s)).toBe(true)
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThan(2 ** 32)
    const others = [sessionSeed('p2', 3, 0), sessionSeed('p1', 4, 0), sessionSeed('p1', 3, 1)]
    for (const o of others) expect(o).not.toBe(s)
  })
})
