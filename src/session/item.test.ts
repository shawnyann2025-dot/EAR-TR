import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { masteryKey } from '../curriculum/knowledgePoints'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { initialLadder } from '../scheduling/ladder'
import { getMastery, initialMastery, type MasteryState } from '../scheduling/mastery'
import { prepareItem, recordAnswer, stagnationUpdates } from './item'

const c = buildCurriculum()
const planned: ExerciseSpec = {
  kpId: 'degree:major:do', modality: 'recognize', track: 'T',
  contextLevel: 1, variationLevel: 1, difficultyStep: 0, seed: 7, segment: 'focus',
}
const key = masteryKey(planned.kpId, planned.modality)
const withWindow = (steps: number[], correct = true): MasteryState => ({
  ...initialMastery(),
  window: steps.map((s, i) => ({ correct, day: i, difficultyStep: s })),
  lastSeenDay: steps.length - 1,
})

describe('prepareItem', () => {
  it('从掌握度窗口续起阶梯，并把档位写进规格', () => {
    const p = prepareItem(planned, undefined, new Map([[key, withWindow([1, 2, 3])]]), { attempted: 0, correct: 0 })
    expect(p.key).toBe(key)
    expect(p.ladder.step).toBe(3)
    expect(p.spec.difficultyStep).toBe(3)
    expect(p.relief).toBe(false)
  })

  it('会话内已有阶梯时优先用它', () => {
    const p = prepareItem(planned, { step: 4, consecutiveCorrect: 1 }, new Map(), { attempted: 0, correct: 0 })
    expect(p.spec.difficultyStep).toBe(4)
  })

  it('回血：降档、降语境与变异，阶梯落到回血后的档位且连对清零', () => {
    const p = prepareItem(planned, { step: 3, consecutiveCorrect: 1 }, new Map(), { attempted: 20, correct: 2 })
    expect(p.relief).toBe(true)
    expect(p.spec.difficultyStep).toBe(2)
    expect(p.spec.contextLevel).toBe(0)
    expect(p.ladder).toEqual({ step: 2, consecutiveCorrect: 0 })
  })
})

describe('recordAnswer', () => {
  it('答后档位写进窗口；门控按阶段上限', () => {
    const r = recordAnswer({
      curriculum: c, phaseId: 'P1', day: 5, mastery: new Map(),
      spec: { ...planned, difficultyStep: 0 }, ladder: { step: 0, consecutiveCorrect: 1 }, correct: true,
    })
    expect(r.ladder).toEqual({ step: 1, consecutiveCorrect: 0 })
    expect(r.state.window.at(-1)).toEqual({ correct: true, day: 5, difficultyStep: 1 })
    expect(r.state.lastSeenDay).toBe(5)
  })

  it('不修改传入的掌握度表', () => {
    const mastery = new Map([[key, withWindow([1])]])
    recordAnswer({ curriculum: c, phaseId: 'P1', day: 9, mastery, spec: planned, ladder: initialLadder(), correct: false })
    expect(getMastery(mastery, key).window).toHaveLength(1)
  })
})

describe('stagnationUpdates', () => {
  it('只对停滞的已解锁 key 给出拆解后的状态', () => {
    const stagnant: MasteryState = {
      ...withWindow(Array(8).fill(0), false),
      contextLevel: 1,
      variationLevel: 1,
      window: Array.from({ length: 8 }, (_, i) => ({ correct: false, day: 10 + (i % 3), difficultyStep: 0 })),
      lastSeenDay: 12,
    }
    const healthy = withWindow([3, 3, 3])
    const mastery = new Map([[key, stagnant], [masteryKey('degree:major:mi', 'sing'), healthy]])
    const ups = stagnationUpdates(c, 'P1', 12, mastery)
    expect(ups.map((u) => u.key)).toEqual([key])
    expect(ups[0].state.contextLevel).toBe(0)
  })
})
