import { describe, expect, it } from 'vitest'
import {
  LADDER_MAX_STEP,
  LADDER_MIN_STEP,
  LADDER_UP_AFTER,
  applyLadder,
  initialLadder,
} from './ladder'

describe('initialLadder', () => {
  it('默认从最低档起', () => {
    expect(initialLadder()).toEqual({ step: LADDER_MIN_STEP, consecutiveCorrect: 0 })
  })

  it('起始档被钳制在合法范围内', () => {
    expect(initialLadder(999).step).toBe(LADDER_MAX_STEP)
    expect(initialLadder(-5).step).toBe(LADDER_MIN_STEP)
  })
})

describe('applyLadder', () => {
  it('答对一次不升档，只累计', () => {
    const s = applyLadder(initialLadder(2), true)
    expect(s.step).toBe(2)
    expect(s.consecutiveCorrect).toBe(1)
  })

  it('连对 LADDER_UP_AFTER 次升一档并清零计数', () => {
    let s = initialLadder(2)
    for (let i = 0; i < LADDER_UP_AFTER; i++) s = applyLadder(s, true)
    expect(s.step).toBe(3)
    expect(s.consecutiveCorrect).toBe(0)
  })

  it('答错立即降一档并清零计数', () => {
    let s = applyLadder(initialLadder(3), true)
    s = applyLadder(s, false)
    expect(s.step).toBe(2)
    expect(s.consecutiveCorrect).toBe(0)
  })

  it('答错打断连对计数', () => {
    let s = initialLadder(2)
    s = applyLadder(s, true)
    s = applyLadder(s, false)
    s = applyLadder(s, true)
    expect(s.step).toBe(1) // 降了一次，之后只对了一次
    expect(s.consecutiveCorrect).toBe(1)
  })

  it('档位不越界', () => {
    let high = initialLadder(LADDER_MAX_STEP)
    for (let i = 0; i < 20; i++) high = applyLadder(high, true)
    expect(high.step).toBe(LADDER_MAX_STEP)

    let low = initialLadder(LADDER_MIN_STEP)
    for (let i = 0; i < 20; i++) low = applyLadder(low, false)
    expect(low.step).toBe(LADDER_MIN_STEP)
  })

  it('不修改输入状态', () => {
    const s = initialLadder(2)
    applyLadder(s, true)
    expect(s).toEqual({ step: 2, consecutiveCorrect: 0 })
  })
})
