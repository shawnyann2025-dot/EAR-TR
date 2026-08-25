import { describe, expect, it } from 'vitest'
import {
  MIN_ITEMS_BEFORE_RELIEF,
  STAGNATION_DAYS,
  decompose,
  isStagnant,
  needsRelief,
  relieveSpec,
  sessionAccuracy,
} from './guardrails'
import { initialMastery, type AttemptOutcome, type MasteryState } from './mastery'
import type { ExerciseSpec } from './exerciseSpec'

const SPEC: ExerciseSpec = {
  kpId: 'degree:major:mi',
  modality: 'recognize',
  track: 'T',
  contextLevel: 3,
  variationLevel: 4,
  difficultyStep: 3,
  seed: 1,
  segment: 'focus',
}

describe('sessionAccuracy / needsRelief', () => {
  it('零尝试时正确率为 1，不触发护栏（避免开局即降难度）', () => {
    expect(sessionAccuracy({ attempted: 0, correct: 0 })).toBe(1)
    expect(needsRelief({ attempted: 0, correct: 0 })).toBe(false)
  })

  it('样本不足时不触发，哪怕全错', () => {
    const n = MIN_ITEMS_BEFORE_RELIEF - 1
    expect(needsRelief({ attempted: n, correct: 0 })).toBe(false)
  })

  it('样本足够且正确率跌破下限时触发', () => {
    const n = MIN_ITEMS_BEFORE_RELIEF
    expect(needsRelief({ attempted: n, correct: 0 })).toBe(true)
  })

  it('正确率高于下限时不触发', () => {
    expect(needsRelief({ attempted: 20, correct: 18 })).toBe(false)
  })
})

describe('relieveSpec', () => {
  it('同时降低难度档、变异等级与语境等级', () => {
    const r = relieveSpec(SPEC)
    expect(r.difficultyStep).toBeLessThan(SPEC.difficultyStep)
    expect(r.variationLevel).toBeLessThan(SPEC.variationLevel)
    // 语境等级减小 = 语境增强 = 更容易
    expect(r.contextLevel).toBeLessThan(SPEC.contextLevel)
  })

  it('已在最低档时不越界', () => {
    const floor = { ...SPEC, contextLevel: 0 as const, variationLevel: 0 as const, difficultyStep: 0 }
    const r = relieveSpec(floor)
    expect(r.contextLevel).toBe(0)
    expect(r.variationLevel).toBe(0)
    expect(r.difficultyStep).toBe(0)
  })

  it('不改变知识点、模态与轨道', () => {
    const r = relieveSpec(SPEC)
    expect(r.kpId).toBe(SPEC.kpId)
    expect(r.modality).toBe(SPEC.modality)
    expect(r.track).toBe(SPEC.track)
  })

  it('不修改输入', () => {
    relieveSpec(SPEC)
    expect(SPEC.difficultyStep).toBe(3)
  })
})

describe('isStagnant', () => {
  function withWindow(window: AttemptOutcome[], lastSeenDay: number): MasteryState {
    return { ...initialMastery(), window, lastSeenDay }
  }

  function attempt(correct: boolean, day: number): AttemptOutcome {
    return { correct, day, difficultyStep: 0 }
  }

  it('从未练过不算停滞', () => {
    expect(isStagnant(initialMastery(), 10)).toBe(false)
  })

  it('近 N 天内尝试够多且正确率很低时判为停滞', () => {
    const window: AttemptOutcome[] = []
    for (let day = 8; day <= 10; day++) {
      for (let i = 0; i < 3; i++) window.push(attempt(false, day))
    }
    expect(isStagnant(withWindow(window, 10), 10)).toBe(true)
  })

  it('正确率不低时不算停滞', () => {
    const window: AttemptOutcome[] = []
    for (let day = 8; day <= 10; day++) {
      for (let i = 0; i < 3; i++) window.push(attempt(true, day))
    }
    expect(isStagnant(withWindow(window, 10), 10)).toBe(false)
  })

  it('尝试次数不足时不算停滞', () => {
    expect(isStagnant(withWindow([attempt(false, 10)], 10), 10)).toBe(false)
  })

  it('只看最近 STAGNATION_DAYS 天，更早的失败不计入', () => {
    const window: AttemptOutcome[] = []
    for (let i = 0; i < 12; i++) window.push(attempt(false, 0))
    expect(isStagnant(withWindow(window, 0), STAGNATION_DAYS + 5)).toBe(false)
  })
})

describe('decompose', () => {
  it('加强语境（contextLevel 减小）并降低变异等级', () => {
    const s: MasteryState = { ...initialMastery(), contextLevel: 3, variationLevel: 4 }
    const d = decompose(s)
    expect(d.contextLevel).toBeLessThan(s.contextLevel)
    expect(d.variationLevel).toBeLessThan(s.variationLevel)
  })

  it('已在最低时不越界', () => {
    const s: MasteryState = { ...initialMastery(), contextLevel: 0, variationLevel: 0 }
    const d = decompose(s)
    expect(d.contextLevel).toBe(0)
    expect(d.variationLevel).toBe(0)
  })

  it('清空窗口，让拆解后的表现重新积累（否则旧的失败会立刻再次触发回退）', () => {
    const s: MasteryState = {
      ...initialMastery(),
      contextLevel: 2,
      window: [
        { correct: false, day: 1, difficultyStep: 0 },
        { correct: false, day: 2, difficultyStep: 0 },
      ],
    }
    expect(decompose(s).window).toEqual([])
  })

  it('不修改输入', () => {
    const s: MasteryState = { ...initialMastery(), contextLevel: 3, variationLevel: 4 }
    decompose(s)
    expect(s.contextLevel).toBe(3)
  })
})
