import { describe, expect, it } from 'vitest'
import {
  CONTEXT_STABILITY_THRESHOLDS,
  DEMOTE_TRAILING_ERRORS,
  MIN_WINDOW_FOR_PROMOTION,
  PROMOTE_MEAN_STEP,
  VARIATION_STABILITY_THRESHOLDS,
  applyGating,
  meanLadderStep,
  trailingErrors,
  windowAccuracy,
} from './gating'
import { initialMastery, type AttemptOutcome, type MasteryState } from './mastery'
import type { LevelRequirement } from '../curriculum/curriculum'

const CAP: LevelRequirement = { contextLevel: 4, variationLevel: 6 }

/** 构造窗口：给定每次尝试的对错与阶梯档位 */
function win(pattern: boolean[], step = PROMOTE_MEAN_STEP): AttemptOutcome[] {
  return pattern.map((correct, i) => ({ correct, day: i, difficultyStep: step }))
}

function state(over: Partial<MasteryState>): MasteryState {
  return { ...initialMastery(), lastSeenDay: 0, ...over }
}

describe('windowAccuracy / meanLadderStep / trailingErrors', () => {
  it('空窗口：正确率 0、平均档位 0、尾部错误 0', () => {
    expect(windowAccuracy([])).toBe(0)
    expect(meanLadderStep([])).toBe(0)
    expect(trailingErrors([])).toBe(0)
  })

  it('正确率是窗口内正确数占比', () => {
    expect(windowAccuracy(win([true, true, true, false]))).toBeCloseTo(0.75, 10)
  })

  it('平均档位是窗口内档位的均值', () => {
    const window: AttemptOutcome[] = [
      { correct: true, day: 0, difficultyStep: 1 },
      { correct: true, day: 1, difficultyStep: 3 },
      { correct: false, day: 2, difficultyStep: 5 },
    ]
    expect(meanLadderStep(window)).toBeCloseTo(3, 10)
  })

  it('尾部错误数只数末尾连续的错误', () => {
    expect(trailingErrors(win([false, false, true, false, false]))).toBe(2)
    expect(trailingErrors(win([false, false, true]))).toBe(0)
  })
})

describe('applyGating 升级', () => {
  it('stability 与平均档位都达标时提升变异等级', () => {
    const s = state({
      stability: VARIATION_STABILITY_THRESHOLDS[0],
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true)),
    })
    expect(applyGating(s, CAP).variationLevel).toBe(1)
  })

  it('窗口太短时不升级，哪怕档位很高', () => {
    const s = state({
      stability: VARIATION_STABILITY_THRESHOLDS[0] * 10,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION - 1).fill(true), 5),
    })
    expect(applyGating(s, CAP).variationLevel).toBe(0)
  })

  it('平均档位不足时不升级，哪怕 stability 很高且全对', () => {
    // 全对但一直卡在档位 0：说明阶梯没能把难度顶上去，还不该升级
    const s = state({
      stability: 100,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true), 0),
    })
    expect(applyGating(s, CAP).variationLevel).toBe(0)
  })

  it('平均档位达标即可升级，不要求高正确率（建模决策 4）', () => {
    // 正确率约 70%——正是 2-down-1-up 的收敛点，但档位高，应当升级
    const pattern = [true, true, false, true, true, false, true, true, true, false]
    const s = state({
      stability: VARIATION_STABILITY_THRESHOLDS[0],
      window: win(pattern, PROMOTE_MEAN_STEP + 1),
    })
    expect(windowAccuracy(win(pattern))).toBeLessThan(0.9)
    expect(applyGating(s, CAP).variationLevel).toBe(1)
  })

  it('一次最多升一级', () => {
    const s = state({
      stability: 1000,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true), 5),
    })
    const next = applyGating(s, CAP)
    expect(next.variationLevel).toBe(1)
    expect(next.contextLevel).toBeLessThanOrEqual(1)
  })

  it('不得越过当前阶段的要求上限', () => {
    const s = state({
      stability: 1000,
      variationLevel: 2,
      contextLevel: 1,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true), 5),
    })
    const cap: LevelRequirement = { contextLevel: 1, variationLevel: 2 }
    const next = applyGating(s, cap)
    expect(next.variationLevel).toBe(2)
    expect(next.contextLevel).toBe(1)
  })

  it('语境等级达标时也会提升', () => {
    const s = state({
      stability: CONTEXT_STABILITY_THRESHOLDS[0],
      variationLevel: 6,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true)),
    })
    expect(applyGating(s, CAP).contextLevel).toBe(1)
  })
})

describe('applyGating 回退', () => {
  it('尾部连续错误达到阈值时回退', () => {
    const s = state({
      variationLevel: 3,
      contextLevel: 2,
      window: win([true, true, ...Array(DEMOTE_TRAILING_ERRORS).fill(false)]),
    })
    const next = applyGating(s, CAP)
    expect(next.variationLevel + next.contextLevel).toBe(
      s.variationLevel + s.contextLevel - 1,
    )
  })

  it('回退优先于升级：尾部连错时哪怕档位达标也不升级', () => {
    const s = state({
      stability: 1000,
      variationLevel: 2,
      contextLevel: 2,
      window: win(
        [...Array(MIN_WINDOW_FOR_PROMOTION).fill(true), ...Array(DEMOTE_TRAILING_ERRORS).fill(false)],
        5,
      ),
    })
    const next = applyGating(s, CAP)
    expect(next.contextLevel).toBe(1)
    expect(next.variationLevel).toBe(2)
  })

  it('两级都不为 0 时优先回退语境（语境是更硬的那条阶梯）', () => {
    const s = state({
      variationLevel: 3,
      contextLevel: 3,
      window: win(Array(DEMOTE_TRAILING_ERRORS).fill(false)),
    })
    const next = applyGating(s, CAP)
    expect(next.contextLevel).toBe(2)
    expect(next.variationLevel).toBe(3)
  })

  it('语境已在 0 时回退变异等级', () => {
    const s = state({
      variationLevel: 2,
      contextLevel: 0,
      window: win(Array(DEMOTE_TRAILING_ERRORS).fill(false)),
    })
    const next = applyGating(s, CAP)
    expect(next.variationLevel).toBe(1)
    expect(next.contextLevel).toBe(0)
  })

  it('两级都已在 0 时不再回退，也不抛错', () => {
    const s = state({
      variationLevel: 0,
      contextLevel: 0,
      window: win(Array(DEMOTE_TRAILING_ERRORS * 2).fill(false)),
    })
    const next = applyGating(s, CAP)
    expect(next.variationLevel).toBe(0)
    expect(next.contextLevel).toBe(0)
  })

  it('不修改输入状态', () => {
    const s = state({
      variationLevel: 3,
      contextLevel: 3,
      window: win(Array(DEMOTE_TRAILING_ERRORS).fill(false)),
    })
    applyGating(s, CAP)
    expect(s.variationLevel).toBe(3)
    expect(s.contextLevel).toBe(3)
  })
})
