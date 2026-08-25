import { describe, expect, it } from 'vitest'
import {
  DUE_THRESHOLD,
  MIN_STABILITY,
  applyAttempt,
  getMastery,
  initialMastery,
  isDue,
  retrievability,
} from './mastery'

describe('initialMastery', () => {
  it('从未练过：lastSeenDay 为 null，两个等级都从 0 起', () => {
    const s = initialMastery()
    expect(s.lastSeenDay).toBeNull()
    expect(s.variationLevel).toBe(0)
    expect(s.contextLevel).toBe(0)
    expect(s.window).toEqual([])
    expect(s.stability).toBeGreaterThan(0)
  })
})

describe('retrievability', () => {
  it('从未练过时为 0（视为完全不可提取，必然到期）', () => {
    expect(retrievability(initialMastery(), 0)).toBe(0)
    expect(isDue(initialMastery(), 0)).toBe(true)
  })

  it('刚练过（同一天）为 1', () => {
    const s = applyAttempt(initialMastery(), true, 5, 0)
    expect(retrievability(s, 5)).toBeCloseTo(1, 10)
    expect(isDue(s, 5)).toBe(false)
  })

  it('随时间单调递减', () => {
    const s = applyAttempt(initialMastery(), true, 0, 0)
    let prev = Infinity
    for (const day of [0, 1, 2, 5, 10, 30]) {
      const r = retrievability(s, day)
      expect(r).toBeLessThanOrEqual(prev)
      prev = r
    }
  })

  it('stability 越大，同样天数后的可提取性越高', () => {
    const weak = { ...applyAttempt(initialMastery(), true, 0, 0), stability: 2 }
    const strong = { ...weak, stability: 20 }
    expect(retrievability(strong, 5)).toBeGreaterThan(retrievability(weak, 5))
  })

  it('isDue 的门槛就是 DUE_THRESHOLD', () => {
    const s = { ...applyAttempt(initialMastery(), true, 0, 0), stability: 10 }
    // R = exp(-d/10)；令 R 恰好略低于阈值
    const day = -10 * Math.log(DUE_THRESHOLD) + 0.01
    expect(retrievability(s, day)).toBeLessThan(DUE_THRESHOLD)
    expect(isDue(s, day)).toBe(true)
  })
})

describe('applyAttempt', () => {
  it('答对：stability 增长，difficulty 不上升', () => {
    const before = applyAttempt(initialMastery(), true, 0, 0)
    const after = applyAttempt(before, true, 10, 0)
    expect(after.stability).toBeGreaterThan(before.stability)
    expect(after.difficulty).toBeLessThanOrEqual(before.difficulty)
  })

  it('答错：stability 衰减但不低于下限，difficulty 上升', () => {
    let s = applyAttempt(initialMastery(), true, 0, 0)
    s = applyAttempt(s, true, 10, 0)
    const before = s
    const after = applyAttempt(before, false, 20, 0)
    expect(after.stability).toBeLessThan(before.stability)
    expect(after.stability).toBeGreaterThanOrEqual(MIN_STABILITY)
    expect(after.difficulty).toBeGreaterThan(before.difficulty)
  })

  it('连续答错时 stability 不会跌破下限', () => {
    let s = initialMastery()
    for (let day = 0; day < 30; day++) s = applyAttempt(s, false, day, 0)
    expect(s.stability).toBeGreaterThanOrEqual(MIN_STABILITY)
    expect(s.difficulty).toBeLessThanOrEqual(1)
  })

  it('同一天重复答对，stability 不再增长（间隔效应的机制）', () => {
    const first = applyAttempt(initialMastery(), true, 7, 0)
    const second = applyAttempt(first, true, 7, 0)
    const third = applyAttempt(second, true, 7, 0)
    expect(second.stability).toBeCloseTo(first.stability, 10)
    expect(third.stability).toBeCloseTo(first.stability, 10)
  })

  it('间隔越久后答对，stability 增长越多', () => {
    const base = applyAttempt(initialMastery(), true, 0, 0)
    const soon = applyAttempt(base, true, 1, 0)
    const late = applyAttempt(base, true, 20, 0)
    expect(late.stability - base.stability).toBeGreaterThan(
      soon.stability - base.stability,
    )
  })

  it('窗口保留最近 20 次，且不修改输入状态', () => {
    let s = initialMastery()
    const snapshot = { ...s, window: [...s.window] }
    for (let day = 0; day < 30; day++) s = applyAttempt(s, day % 2 === 0, day, 0)
    expect(s.window).toHaveLength(20)
    expect(s.window[s.window.length - 1].day).toBe(29)
    expect(snapshot.window).toEqual([])
  })

  it('窗口记录每次尝试所在的阶梯档位（建模决策 4 的依据）', () => {
    let s = initialMastery()
    s = applyAttempt(s, true, 0, 3)
    s = applyAttempt(s, false, 1, 4)
    expect(s.window.map((a) => a.difficultyStep)).toEqual([3, 4])
  })

  it('阶梯档位不影响 stability 的算法，只被记录', () => {
    const atZero = applyAttempt(initialMastery(), true, 0, 0)
    const atFive = applyAttempt(initialMastery(), true, 0, 5)
    expect(atFive.stability).toBeCloseTo(atZero.stability, 10)
  })

  it('lastSeenDay 更新为本次尝试日', () => {
    expect(applyAttempt(initialMastery(), true, 42, 0).lastSeenDay).toBe(42)
  })

  it('difficulty 始终落在 0–1', () => {
    let s = initialMastery()
    for (let day = 0; day < 60; day++) s = applyAttempt(s, day % 7 === 0, day, 0)
    expect(s.difficulty).toBeGreaterThanOrEqual(0)
    expect(s.difficulty).toBeLessThanOrEqual(1)
  })
})

describe('getMastery', () => {
  it('缺失的 key 返回初始状态而非 undefined', () => {
    expect(getMastery(new Map(), 'degree:major:do@recognize')).toEqual(initialMastery())
  })
})
